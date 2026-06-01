/**
 * ChatbotChatApp Provider (chatbotchatapp.com)
 *
 * Endpoint : POST https://chatbotchatapp.com/api/mai  (SSE stream)
 * Auth     : Laravel session + CSRF token.
 *            1. GET /chat  →  extract <meta name="csrf-token"> + set cookies
 *            2. POST /api/get-timestamp  →  { timestamp, ipInfo }
 *            3. Compute id = MD5("timestamp"+ts+"nonce"+n+"messages"+msg+"keyTokenXXXXXXYYYvv1")
 *            4. POST /api/mai with full payload + X-CSRF-TOKEN header
 * Models   : model-chatgpt-3-5 (default/free), model-chatgpt-4,
 *            model-deepseek-r1, model-deepseek-v3-0324, model-qwen3-235b-a22b,
 *            model-gpt-oss, model-mistral-large, model-pixtral, model-codestral
 * Request  : { id, timestamp, nonce, messages, url, modal, conversationId }
 * Response : OpenAI-format SSE — choices[0].delta.{content,reasoning,reasoning_content}
 *            finish_reason:"stop" terminates stream
 *
 * Error codes (in SSE `id:` field):
 *   1006 = hash/id verification failed → refresh session and retry
 *   1002 = session/IP rate-limit or one-free-chat-per-IP guard → session refresh may help
 *
 * NOTE: This site uses a "one free chat per IP" anti-bot measure for guest access.
 *       Provider may return 1002 after the first successful request from a given IP
 *       until the cooldown expires. Session rotation is attempted automatically.
 */

import { execSync } from "child_process";
import { createHash } from "crypto";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "fs";
import { logger } from "./logger";

const BASE_URL      = "https://chatbotchatapp.com";
const CHAT_URL      = `${BASE_URL}/chat`;
const TIMESTAMP_URL = `${BASE_URL}/api/get-timestamp`;
const STREAM_URL    = `${BASE_URL}/api/mai`;
const KEY_TOKEN     = "XXXXXXYYY";
const SESSION_FILE  = "/tmp/cbca_session.txt";
const SESSION_META  = "/tmp/cbca_session_meta.json";
const SESSION_TTL   = 20 * 60 * 60 * 1000; // 20h to be safe (cookies expire ~24h)
const UA            = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// ── Model definitions ─────────────────────────────────────────────────────────

const MODEL_MAP: Record<string, string> = {
  "cbca":            "model-chatgpt-3-5",
  "cbca-gpt4":       "model-chatgpt-4",
  "cbca-deepseek-r1":"model-deepseek-r1",
  "cbca-deepseek-v3":"model-deepseek-v3-0324",
  "cbca-qwen3":      "model-qwen3-235b-a22b",
  "cbca-gpt-oss":    "model-gpt-oss",
  "cbca-mistral":    "model-mistral-large",
  "cbca-pixtral":    "model-pixtral",
  "cbca-codestral":  "model-codestral",
};

export const CBCA_MODELS = Object.keys(MODEL_MAP).map(id => ({
  id,
  object: "model" as const,
  created: 1748736000,
  owned_by: "chatbotchatapp",
}));

const CBCA_MODEL_IDS = new Set(Object.keys(MODEL_MAP));

export function isCbcaModel(model: string): boolean {
  return CBCA_MODEL_IDS.has(model);
}

// ── Session management ────────────────────────────────────────────────────────

interface SessionMeta {
  csrf: string;
  expiresAt: number;
}

let _session: SessionMeta | null = null;
let _sessionLock: Promise<SessionMeta> | null = null;

function loadCachedSession(): SessionMeta | null {
  try {
    if (existsSync(SESSION_META)) {
      const meta = JSON.parse(readFileSync(SESSION_META, "utf8")) as SessionMeta;
      if (Date.now() < meta.expiresAt && existsSync(SESSION_FILE)) return meta;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchSession(): Promise<SessionMeta> {
  logger.debug("cbca: fetching new session from /chat");

  // Remove stale cookie file
  try { if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE); } catch { /* ignore */ }

  const html = execSync(
    `curl -sL '${CHAT_URL}' \
      -H 'User-Agent: ${UA}' \
      -H 'Accept: text/html,application/xhtml+xml' \
      -H 'Accept-Language: en-US,en;q=0.9' \
      -c '${SESSION_FILE}' \
      -b '${SESSION_FILE}' \
      --max-time 20`,
    { maxBuffer: 5 * 1024 * 1024 },
  ).toString();

  const csrfMatch = html.match(/name="csrf-token"\s+content="([A-Za-z0-9]{20,80})"/);
  if (!csrfMatch) {
    throw new Error("cbca: could not extract CSRF token from /chat page");
  }
  const csrf = csrfMatch[1];

  const meta: SessionMeta = { csrf, expiresAt: Date.now() + SESSION_TTL };
  writeFileSync(SESSION_META, JSON.stringify(meta));
  logger.debug({ csrf: csrf.slice(0, 8) + "..." }, "cbca: session established");
  return meta;
}

async function getSession(): Promise<SessionMeta> {
  if (_session && Date.now() < _session.expiresAt) return _session;

  const cached = loadCachedSession();
  if (cached) { _session = cached; return cached; }

  if (!_sessionLock) {
    _sessionLock = fetchSession().then(s => {
      _session = s;
      _sessionLock = null;
      return s;
    }).catch(err => {
      _sessionLock = null;
      throw err;
    });
  }
  return _sessionLock;
}

function invalidateSession(): void {
  _session = null;
  try { if (existsSync(SESSION_META)) unlinkSync(SESSION_META); } catch { /* ignore */ }
  logger.info("cbca: session invalidated");
}

// ── Timestamp + key generation ────────────────────────────────────────────────

interface TimestampResponse {
  status: boolean;
  timestamp: number;
  ipInfo?: { id?: string };
}

function getTimestamp(csrf: string): number {
  const raw = execSync(
    `curl -s -X POST '${TIMESTAMP_URL}' \
      -H 'User-Agent: ${UA}' \
      -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
      -H 'X-CSRF-TOKEN: ${csrf}' \
      -H 'X-Requested-With: XMLHttpRequest' \
      -H 'Accept: application/json' \
      -H 'Origin: ${BASE_URL}' \
      -H 'Referer: ${CHAT_URL}' \
      -b '${SESSION_FILE}' \
      -c '${SESSION_FILE}' \
      -d 'href=${encodeURIComponent(CHAT_URL)}&ypp=' \
      --max-time 15`,
    { maxBuffer: 64 * 1024 },
  ).toString();

  let resp: TimestampResponse;
  try { resp = JSON.parse(raw); }
  catch { throw new Error(`cbca: timestamp parse failed: ${raw.slice(0, 200)}`); }

  if (!resp.status || !resp.timestamp) {
    // CSRF might be stale
    throw new Error(`cbca: timestamp failed (invalid session?): ${raw.slice(0, 200)}`);
  }
  return resp.timestamp;
}

function genNonce(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function computeId(timestamp: number, nonce: string, messages: ChatMessage[]): string {
  const msgContent = messages[timestamp % messages.length]?.content ?? "";
  const input = `timestamp${timestamp}nonce${nonce}messages${msgContent}keyToken${KEY_TOKEN}vv1`;
  return createHash("md5").update(input).digest("hex");
}

// ── Message helpers ───────────────────────────────────────────────────────────

export interface ChatMessage {
  role: string;
  content: string;
}

function buildMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return [{ role: "user", content: "Hello" }];

  let systemPrompt = "";
  const filtered: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") { systemPrompt += (systemPrompt ? "\n\n" : "") + m.content; }
    else filtered.push(m);
  }

  if (systemPrompt && filtered.length > 0 && filtered[filtered.length - 1].role === "user") {
    const last = filtered[filtered.length - 1];
    filtered[filtered.length - 1] = {
      role: "user",
      content: `${systemPrompt}\n\n${last.content}`,
    };
  }

  return filtered.length > 0 ? filtered : [{ role: "user", content: systemPrompt || "Hello" }];
}

// ── SSE parser (streaming) ────────────────────────────────────────────────────

interface CbcaDelta {
  role?: string;
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
}

interface CbcaChoice {
  delta: CbcaDelta;
  finish_reason?: string | null;
}

interface CbcaChunk {
  choices?: CbcaChoice[];
  code?: number;
  message?: string;
  conversationId?: string;
}

function* parseCbcaSSE(raw: string): Generator<string> {
  const lines = raw.split("\n");
  let finished = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Errors arrive as SSE `id:` field (e.g. id: {"code":1002,...})
    if (trimmed.startsWith("id:")) {
      const jsonStr = trimmed.slice(3).trim();
      if (!jsonStr) continue;
      try {
        const idChunk = JSON.parse(jsonStr) as CbcaChunk;
        if (idChunk.code !== undefined && idChunk.code !== 0) {
          throw new Error(`cbca:${idChunk.code}`);
        }
      } catch (e) {
        if (String(e).startsWith("Error: cbca:")) throw e;
        // Not valid JSON or no error code — ignore
      }
      continue;
    }

    if (!trimmed.startsWith("data:")) continue;
    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr || jsonStr === "[DONE]") { finished = true; continue; }

    let chunk: CbcaChunk;
    try { chunk = JSON.parse(jsonStr); }
    catch { continue; }

    if (chunk.code !== undefined && chunk.code !== 0) {
      throw new Error(`cbca:${chunk.code}`);
    }

    if (!chunk.choices || chunk.choices.length === 0) continue;
    const choice = chunk.choices[0];
    if (!choice) continue;

    if (choice.finish_reason === "stop") { finished = true; continue; }

    const delta = choice.delta;
    if (!delta) continue;

    const text = delta.content ?? delta.reasoning ?? delta.reasoning_content ?? "";
    if (text) yield text;
  }

  if (!finished) {
    logger.debug("cbca: stream ended without explicit [DONE]");
  }
}

// ── Core request ──────────────────────────────────────────────────────────────

function callCbca(
  csrf: string,
  messages: ChatMessage[],
  modal: string,
): string {
  const timestamp = getTimestamp(csrf);
  const nonce     = genNonce();
  const id        = computeId(timestamp, nonce, messages);

  const payload = JSON.stringify({
    id,
    timestamp,
    nonce,
    messages,
    url: CHAT_URL,
    modal,
    conversationId: "",
  });

  const escapedPayload = payload.replace(/'/g, "'\\''");
  const escapedCsrf    = csrf.replace(/'/g, "'\\''");

  const raw = execSync(
    `curl -sN -X POST '${STREAM_URL}' \
      -H 'User-Agent: ${UA}' \
      -H 'Content-Type: application/json' \
      -H "X-CSRF-TOKEN: ${escapedCsrf}" \
      -H 'X-Requested-With: XMLHttpRequest' \
      -H 'Accept: text/event-stream' \
      -H 'Origin: ${BASE_URL}' \
      -H 'Referer: ${CHAT_URL}' \
      -b '${SESSION_FILE}' \
      -c '${SESSION_FILE}' \
      -d '${escapedPayload}' \
      --max-time 90`,
    { maxBuffer: 20 * 1024 * 1024 },
  ).toString();

  return raw;
}

// ── Public streaming API ──────────────────────────────────────────────────────

export async function* cbcaStream(
  messages: ChatMessage[],
  model = "cbca",
): AsyncGenerator<string> {
  const modal    = MODEL_MAP[model] ?? MODEL_MAP["cbca"];
  const prepared = buildMessages(messages);

  let session = await getSession();
  logger.debug({ msgCount: prepared.length, model, modal }, "cbca: sending request");

  let raw: string;
  try {
    raw = callCbca(session.csrf, prepared, modal);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("invalid session") || msg.includes("CSRF") || msg.includes("timestamp failed")) {
      logger.warn("cbca: session error on curl, invalidating and retrying");
      invalidateSession();
      session = await getSession();
      try {
        raw = callCbca(session.csrf, prepared, modal);
      } catch (retryErr) {
        logger.error({ err: String(retryErr) }, "cbca: retry failed");
        throw new Error("ChatbotChatApp request failed after retry");
      }
    } else {
      logger.error({ err: msg }, "cbca: curl failed");
      throw new Error("ChatbotChatApp request failed");
    }
  }

  // Parse stream; auto-retry on session error codes 1002/1006
  let hasContent = false;
  try {
    for (const token of parseCbcaSSE(raw)) {
      hasContent = true;
      yield token;
    }
  } catch (streamErr) {
    const code = String(streamErr).match(/cbca:(\d+)/)?.[1];
    if (code === "1006" || code === "1002") {
      logger.warn(
        { code, snippet: raw.slice(0, 200) },
        `cbca: got error code ${code} — invalidating session and retrying`,
      );
      invalidateSession();
      session = await getSession();
      let raw2: string;
      try {
        raw2 = callCbca(session.csrf, prepared, modal);
      } catch (retryErr) {
        logger.error({ err: String(retryErr) }, "cbca: retry curl failed");
        throw new Error(`ChatbotChatApp error ${code} — retry request failed`);
      }
      try {
        for (const token of parseCbcaSSE(raw2)) {
          hasContent = true;
          yield token;
        }
      } catch (retryStreamErr) {
        const code2 = String(retryStreamErr).match(/cbca:(\d+)/)?.[1];
        logger.error({ code: code2, snippet: raw2.slice(0, 200) }, "cbca: retry also returned error");
        throw new Error(`ChatbotChatApp error ${code2 ?? "unknown"} after session refresh`);
      }
    } else {
      throw streamErr;
    }
  }

  if (!hasContent) {
    const snippet = raw.slice(0, 300);
    logger.warn({ snippet }, "cbca: empty response");
    throw new Error("ChatbotChatApp returned empty response");
  }
}

// ── Non-streaming ─────────────────────────────────────────────────────────────

export async function cbcaChat(
  messages: ChatMessage[],
  model = "cbca",
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  let content = "";
  for await (const token of cbcaStream(messages, model)) {
    content += token;
  }
  const inputEst  = Math.round(messages.map(m => m.content).join(" ").length / 4);
  const outputEst = Math.round(content.length / 4);
  return { content: content.trim(), inputTokens: inputEst, outputTokens: outputEst };
}

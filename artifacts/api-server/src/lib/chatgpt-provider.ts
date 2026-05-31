/**
 * ChatGPT Guest Mode Provider
 *
 * Recon summary (May 2026):
 *  GET  /backend-anon/models                     → 200 ✅
 *  POST /backend-anon/sentinel/chat-requirements → 200 ✅ (chatgpt-noauth persona)
 *  POST /backend-anon/f/conversation             → 403 on datacenter IPs ❌
 *
 * Blockers from Replit:
 *  1. IP reputation: OpenAI blocks datacenter IPs on /f/conversation
 *  2. Turnstile: dx XOR p → JSON VM bytecode; p only obtainable from CF challenge browser
 *
 * This provider works from residential IPs or via CHATGPT_PROXY env var.
 * Set CHATGPT_TURNSTILE_TOKEN env var to inject a pre-captured browser turnstile token.
 *
 * PoW algo: SHA3-512, prefix "gAAAAAB", brute-force counter until hash starts with difficulty.
 */

import { createHash, randomBytes } from "crypto";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { Readable } from "stream";
import { logger } from "./logger";

const BASE_ANON = "https://chatgpt.com/backend-anon";
const SENTINEL_URL = `${BASE_ANON}/sentinel/chat-requirements`;
const CONV_URL = `${BASE_ANON}/f/conversation`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";

// ── PoW Solver ────────────────────────────────────────────────────────────────

/**
 * Solve OpenAI's proof-of-work challenge.
 * seed: float string like "0.008..." from requirements
 * difficulty: hex string like "07a120" — first N bits of SHA3-512 must be 0
 */
function solvePoW(seed: string, difficulty: string): string {
  const config = ["gAAAAAB", seed, difficulty];
  const target = parseInt(difficulty, 16);

  for (let i = 0; i < 500_000; i++) {
    const candidate = Buffer.from(JSON.stringify([...config, i])).toString("base64");
    const token = `gAAAAAB${candidate}`;
    const hash = createHash("sha3-512").update(token).digest();
    const prefix = (hash[0] << 16) | (hash[1] << 8) | hash[2];
    if (prefix <= target) {
      return token;
    }
  }
  // Fallback: return a token even if not solved (rare)
  const fallback = Buffer.from(JSON.stringify([...config, 0])).toString("base64");
  return `gAAAAAB${fallback}`;
}

// ── Python/curl_cffi HTTP helper ───────────────────────────────────────────────

/**
 * Run a Python snippet via subprocess to use curl_cffi for TLS fingerprint spoofing.
 * Returns stdout as string.
 */
function runPython(code: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["-c", code], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => errChunks.push(c));

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Python subprocess timed out"));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString("utf8");
      const err = Buffer.concat(errChunks).toString("utf8");
      if (code !== 0) {
        return reject(new Error(`python3 exited ${code}: ${err.slice(0, 400)}`));
      }
      resolve(out);
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Spawn a Python subprocess for streaming (returns stdout Readable).
 */
function spawnPythonStream(code: string): Readable {
  const proc = spawn("python3", ["-c", code], { stdio: ["ignore", "pipe", "pipe"] });
  return proc.stdout as unknown as Readable;
}

// ── Sentinel: get chat requirements ──────────────────────────────────────────

interface SentinelResult {
  chatToken: string;
  proofSeed: string | null;
  proofDifficulty: string | null;
  turnstileRequired: boolean;
  turnstileDx: string | null;
  deviceId: string;
}

async function getSentinel(deviceId: string): Promise<SentinelResult> {
  const proxy = process.env.CHATGPT_PROXY ? `proxy="${process.env.CHATGPT_PROXY}"` : "";
  const code = `
import json, sys
from curl_cffi.requests import Session

did = ${JSON.stringify(deviceId)}
headers = {
  "accept": "*/*",
  "content-type": "application/json",
  "oai-device-id": did,
  "oai-language": "en-US",
  "origin": "https://chatgpt.com",
  "referer": "https://chatgpt.com/",
  "user-agent": ${JSON.stringify(UA)},
}
${proxy ? `kwargs = {${proxy}}` : "kwargs = {}"}
with Session(impersonate="chrome110", timeout=20, **kwargs) as s:
  r = s.post(${JSON.stringify(SENTINEL_URL)}, json={"p": None}, headers=headers)
  sys.stdout.write(r.text)
`.trim();

  const raw = await runPython(code, 25_000);
  const d = JSON.parse(raw) as {
    token?: string;
    proofofwork?: { required?: boolean; seed?: string; difficulty?: string };
    turnstile?: { required?: boolean; dx?: string };
  };

  return {
    chatToken: d.token ?? "",
    proofSeed: d.proofofwork?.seed ?? null,
    proofDifficulty: d.proofofwork?.difficulty ?? null,
    turnstileRequired: d.turnstile?.required === true,
    turnstileDx: d.turnstile?.dx ?? null,
    deviceId,
  };
}

// ── Build conversation request body ───────────────────────────────────────────

interface ConvMessage {
  role: string;
  content: string;
}

function buildConvBody(
  messages: ConvMessage[],
  model: string,
  parentMsgId: string,
  convId: string | null,
): Record<string, unknown> {
  const msgId = randomUUID();

  const gptMessages = messages.map((m) => ({
    id: randomUUID(),
    author: { role: m.role },
    content: { content_type: "text", parts: [m.content] },
    metadata: {},
  }));

  const body: Record<string, unknown> = {
    action: "next",
    messages: gptMessages,
    parent_message_id: parentMsgId,
    model: model === "gpt-4o" ? "gpt-4o" : model.startsWith("gpt-") ? model : "gpt-4o",
    timezone_offset_min: -480,
    timezone: "Asia/Jakarta",
    history_and_training_disabled: true,
    conversation_mode: { kind: "primary_assistant" },
    enable_message_followups: true,
    system_hints: [],
    supports_buffering: true,
    supported_encodings: ["v1"],
    client_contextual_info: {
      is_dark_mode: false,
      time_since_loaded: Math.floor(Math.random() * 300) + 50,
      page_height: 578,
      page_width: 1850,
      pixel_ratio: 1,
      screen_height: 1080,
      screen_width: 1920,
    },
    paragen_cot_summary_display_override: "allow",
    message_id: msgId,
  };

  if (convId) {
    body.conversation_id = convId;
  }

  return body;
}

// ── Parse ChatGPT SSE stream ──────────────────────────────────────────────────

export interface ChatGPTChunk {
  text: string;
  done: boolean;
  error?: string;
}

/**
 * Parse one SSE data line from ChatGPT's /f/conversation endpoint.
 * Returns extracted text or null to skip.
 */
export function parseChatGPTSSELine(line: string): string | null {
  if (!line.startsWith("data: ")) return null;
  const raw = line.slice(6).trim();
  if (raw === "[DONE]") return null;
  try {
    const j = JSON.parse(raw) as {
      error?: string;
      v?: string | object;
      message?: {
        content?: { parts?: Array<{ content_type?: string; text?: string } | string> };
        status?: string;
      };
    };

    // v-encoded format (newer ChatGPT streaming)
    if (typeof j.v === "string") return j.v;

    // legacy format
    const parts = j.message?.content?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      const part = parts[0];
      if (typeof part === "string") return part;
      if (typeof part === "object" && part && "text" in part) return (part as { text: string }).text;
    }
  } catch { /* ignore */ }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ChatGPTStreamResult {
  stream: Readable;
}

export interface ChatGPTResult {
  content: string;
  model: string;
}

/** Map OpenAI model IDs to ChatGPT guest-mode model names */
const CHATGPT_MODELS: Record<string, string> = {
  "gpt-4o":              "gpt-4o",
  "gpt-4o-mini":         "gpt-4o-mini",
  "gpt-4":               "gpt-4o",
  "gpt-4-turbo":         "gpt-4o",
  "gpt-3.5-turbo":       "gpt-4o-mini",
  "chatgpt-4o-latest":   "gpt-4o",
  "o1":                  "o1",
  "o1-mini":             "o1-mini",
  "o3":                  "o3",
  "o3-mini":             "o3-mini",
  "o4-mini":             "o4-mini",
};

export function resolveChatGPTModel(model: string): string {
  return CHATGPT_MODELS[model] ?? "gpt-4o";
}

/**
 * Non-streaming ChatGPT guest mode request.
 * Works from residential IPs. From datacenter IPs, throws with "Unusual activity".
 */
export async function chatGPTChat(
  messages: ConvMessage[],
  model = "gpt-4o",
): Promise<ChatGPTResult> {
  const deviceId = randomUUID();
  const parentMsgId = randomUUID();
  const gptModel = resolveChatGPTModel(model);

  // Step 1: sentinel
  const sentinel = await getSentinel(deviceId);
  if (!sentinel.chatToken) throw new Error("ChatGPT: failed to get sentinel token");

  // Step 2: solve PoW if required
  let proofToken: string | null = null;
  if (sentinel.proofSeed && sentinel.proofDifficulty) {
    proofToken = solvePoW(sentinel.proofSeed, sentinel.proofDifficulty);
  }

  // Step 3: turnstile token (injected from env or skipped)
  const turnstileToken = process.env.CHATGPT_TURNSTILE_TOKEN ?? null;

  // Step 4: build request
  const body = buildConvBody(messages, gptModel, parentMsgId, null);

  const extraHeaders = [
    turnstileToken ? `"openai-sentinel-turnstile-token": ${JSON.stringify(turnstileToken)},` : "",
    proofToken ? `"openai-sentinel-proof-token": ${JSON.stringify(proofToken)},` : "",
  ].filter(Boolean).join("\n");

  const proxy = process.env.CHATGPT_PROXY ? `proxy="${process.env.CHATGPT_PROXY}"` : "";

  const code = `
import json, sys
from curl_cffi.requests import Session

headers = {
  "accept": "text/event-stream",
  "content-type": "application/json",
  "oai-device-id": ${JSON.stringify(sentinel.deviceId)},
  "oai-language": "en-US",
  "openai-sentinel-chat-requirements-token": ${JSON.stringify(sentinel.chatToken)},
  ${extraHeaders}
  "origin": "https://chatgpt.com",
  "referer": "https://chatgpt.com/",
  "user-agent": ${JSON.stringify(UA)},
}
${proxy ? `kwargs = {${proxy}}` : "kwargs = {}"}
body = json.loads(${JSON.stringify(JSON.stringify(body))})
with Session(impersonate="chrome110", timeout=120, **kwargs) as s:
  r = s.post(${JSON.stringify(CONV_URL)}, json=body, headers=headers)
  sys.stdout.write(json.dumps({"status": r.status_code, "text": r.text[:50000]}))
`.trim();

  const raw = await runPython(code, 120_000);
  const resp = JSON.parse(raw) as { status: number; text: string };

  if (resp.status === 403) {
    throw new Error(`ChatGPT blocked (${resp.status}): ${resp.text.slice(0, 200)}`);
  }
  if (resp.status !== 200) {
    throw new Error(`ChatGPT error (${resp.status}): ${resp.text.slice(0, 200)}`);
  }

  // Parse SSE
  let content = "";
  let lastText = "";
  for (const line of resp.text.split("\n")) {
    const chunk = parseChatGPTSSELine(line);
    if (chunk !== null) {
      // ChatGPT sends full accumulated text each time — take the delta
      if (chunk.length > lastText.length) {
        content += chunk.slice(lastText.length);
        lastText = chunk;
      } else if (chunk.length === 0 && lastText.length > 0) {
        // new message reset
        lastText = "";
      }
    }
  }

  return { content: content || lastText, model: gptModel };
}

/**
 * Streaming ChatGPT guest mode request.
 * Returns a Readable that emits raw SSE lines from ChatGPT.
 */
export async function chatGPTChatStream(
  messages: ConvMessage[],
  model = "gpt-4o",
): Promise<{ stream: Readable; gptModel: string }> {
  const deviceId = randomUUID();
  const parentMsgId = randomUUID();
  const gptModel = resolveChatGPTModel(model);

  // Step 1: sentinel
  const sentinel = await getSentinel(deviceId);
  if (!sentinel.chatToken) throw new Error("ChatGPT: failed to get sentinel token");

  logger.info({ model: gptModel, turnstile: sentinel.turnstileRequired }, "ChatGPT: sentinel OK");

  // Step 2: PoW
  let proofToken: string | null = null;
  if (sentinel.proofSeed && sentinel.proofDifficulty) {
    proofToken = solvePoW(sentinel.proofSeed, sentinel.proofDifficulty);
    logger.debug({ prefix: proofToken.slice(0, 20) }, "ChatGPT: PoW solved");
  }

  // Step 3: turnstile
  const turnstileToken = process.env.CHATGPT_TURNSTILE_TOKEN ?? null;

  // Step 4: build conversation body
  const body = buildConvBody(messages, gptModel, parentMsgId, null);

  const extraHeaders = [
    turnstileToken ? `"openai-sentinel-turnstile-token": ${JSON.stringify(turnstileToken)},` : "",
    proofToken ? `"openai-sentinel-proof-token": ${JSON.stringify(proofToken)},` : "",
  ].filter(Boolean).join("\n");

  const proxy = process.env.CHATGPT_PROXY ? `proxy="${process.env.CHATGPT_PROXY}"` : "";

  const streamCode = `
import sys, json
from curl_cffi.requests import Session

headers = {
  "accept": "text/event-stream",
  "content-type": "application/json",
  "oai-device-id": ${JSON.stringify(sentinel.deviceId)},
  "oai-language": "en-US",
  "openai-sentinel-chat-requirements-token": ${JSON.stringify(sentinel.chatToken)},
  ${extraHeaders}
  "origin": "https://chatgpt.com",
  "referer": "https://chatgpt.com/",
  "user-agent": ${JSON.stringify(UA)},
}
${proxy ? `kwargs = {${proxy}}` : "kwargs = {}"}
body = json.loads(${JSON.stringify(JSON.stringify(body))})
with Session(impersonate="chrome110", timeout=120, **kwargs) as s:
  with s.stream("POST", ${JSON.stringify(CONV_URL)}, json=body, headers=headers) as r:
    if r.status_code != 200:
      err = r.text[:500]
      sys.stdout.write(f"data: {json.dumps({'error': f'HTTP {r.status_code}: {err}'})}\n\ndata: [DONE]\n\n")
      sys.stdout.flush()
    else:
      for chunk in r.iter_lines():
        if chunk:
          sys.stdout.write(chunk + "\n")
          sys.stdout.flush()
      sys.stdout.write("data: [DONE]\n\n")
      sys.stdout.flush()
`.trim();

  const stream = spawnPythonStream(streamCode);
  return { stream, gptModel };
}

/**
 * List ChatGPT guest-mode models in OpenAI format.
 */
export const CHATGPT_MODEL_LIST = [
  { id: "gpt-4o",            object: "model", created: 1710000000, owned_by: "openai" },
  { id: "gpt-4o-mini",       object: "model", created: 1710000000, owned_by: "openai" },
  { id: "o1",                object: "model", created: 1710000000, owned_by: "openai" },
  { id: "o1-mini",           object: "model", created: 1710000000, owned_by: "openai" },
  { id: "o3-mini",           object: "model", created: 1710000000, owned_by: "openai" },
  { id: "o4-mini",           object: "model", created: 1710000000, owned_by: "openai" },
  { id: "chatgpt-4o-latest", object: "model", created: 1710000000, owned_by: "openai" },
];

/**
 * Check if a model ID should be routed to the ChatGPT guest provider.
 */
export function isChatGPTModel(model: string): boolean {
  if (CHATGPT_MODEL_LIST.some((m) => m.id === model)) return true;
  const resolved = Object.keys(CHATGPT_MODELS);
  return resolved.includes(model);
}

import { randomBytes } from "crypto";
import { spawn } from "child_process";
import { logger } from "./logger";

const UA_BROWSER = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36 OPR/89.0.0.0";
const UA_APP     = "Mozilla 5.0 (Linux; Android 14) com.opera.browser OPR/89.5.4705.84314";

const TOKEN_EP  = "https://oauth2.opera-api.com/oauth2/v1/token/";
const SIGNUP_EP = "https://auth.opera.com/account/v2/external/anonymous/signup";
const CHAT_EP   = "https://composer.opera-api.com/api/v1/a-chat";

// ── curl helper (bypasses Node.js network stack, uses system curl) ─────────

function curlPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: { stream?: boolean } = {},
): Promise<{ json?: unknown; raw?: string; childProcess?: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      "-s",
      "-X", "POST",
      url,
      "--max-time", "25",
    ];

    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    args.push("--data-binary", body);

    if (options.stream) {
      args.push("-N"); // no-buffer for streaming
    }

    const proc = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });

    if (options.stream) {
      // Return the process so the caller can stream stdout
      resolve({ childProcess: proc });
      return;
    }

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => errChunks.push(c));
    proc.on("close", (code) => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (code !== 0) {
        const errMsg = Buffer.concat(errChunks).toString("utf8");
        return reject(new Error(`curl exited ${code}: ${errMsg.slice(0, 200)}`));
      }
      try {
        resolve({ json: JSON.parse(raw), raw });
      } catch {
        resolve({ raw });
      }
    });
    proc.on("error", reject);
  });
}

// ── Session management ─────────────────────────────────────────────────────

interface AriaSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let _session: AriaSession | null = null;

async function createSession(): Promise<AriaSession> {
  // Step 1: anonymous client_credentials
  const r1 = await curlPost(TOKEN_EP, {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": UA_BROWSER,
  }, "client_id=ofa-client&client_secret=N9OscfA3KxlJASuIe29PGZ5RpWaMTBoy&grant_type=client_credentials&scope=anonymous_account");
  const d1 = r1.json as { access_token?: string };
  if (!d1?.access_token) throw new Error(`Aria step1 failed: ${r1.raw?.slice(0, 200)}`);

  // Step 2: anonymous signup (no User-Agent — causes 503 if set)
  const r2 = await curlPost(SIGNUP_EP, {
    "Authorization": `Bearer ${d1.access_token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  }, JSON.stringify({ client_id: "ofa", service: "aria" }));
  const d2 = r2.json as { token?: string };
  if (!d2?.token) throw new Error(`Aria step2 failed: ${r2.raw?.slice(0, 200)}`);

  // Step 3: auth_token → refresh_token
  const r3 = await curlPost(TOKEN_EP, {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": UA_BROWSER,
  }, `auth_token=${encodeURIComponent(d2.token)}&client_id=ofa&device_name=GPT4FREE&grant_type=auth_token&scope=ALL`);
  const d3 = r3.json as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!d3?.refresh_token) throw new Error(`Aria step3 failed: ${r3.raw?.slice(0, 200)}`);

  return {
    accessToken: d3.access_token!,
    refreshToken: d3.refresh_token,
    expiresAt: Date.now() + ((d3.expires_in ?? 3600) - 60) * 1000,
  };
}

async function refreshSession(session: AriaSession): Promise<AriaSession> {
  const r = await curlPost(TOKEN_EP, {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": UA_BROWSER,
  }, `client_id=ofa&grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}&scope=shodan:aria+user:read`);
  const d = r.json as { access_token?: string; expires_in?: number };
  if (!d?.access_token) throw new Error(`Aria refresh failed: ${r.raw?.slice(0, 200)}`);
  return {
    accessToken: d.access_token,
    refreshToken: session.refreshToken,
    expiresAt: Date.now() + ((d.expires_in ?? 3600) - 60) * 1000,
  };
}

async function getSession(): Promise<AriaSession> {
  if (!_session) {
    logger.info("Aria: creating new anonymous session");
    _session = await createSession();
    return _session;
  }
  if (Date.now() >= _session.expiresAt) {
    logger.info("Aria: refreshing expired session");
    try {
      _session = await refreshSession(_session);
    } catch {
      logger.warn("Aria: refresh failed, creating new session");
      _session = null;
      _session = await createSession();
    }
  }
  return _session;
}

// ── Chat helpers ────────────────────────────────────────────────────────────

function buildChatBody(query: string, encKey: string): string {
  return JSON.stringify({
    query,
    stream: true,
    linkify: false,
    linkify_version: 3,
    sia: false,
    media_attachments: [],
    encryption: { key: encKey },
  });
}

function chatHeaders(token: string): Record<string, string> {
  return {
    "Accept": "text/event-stream",
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Origin": "opera-aria://ui",
    "User-Agent": UA_BROWSER,
    "X-Opera-Timezone": "+07:00",
    "X-Opera-UI-Language": "en",
  };
}

export interface AriaChatResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/** Non-streaming: collect full response via curl. */
export async function ariaChat(query: string): Promise<AriaChatResult> {
  const session = await getSession();
  const encKey = randomBytes(32).toString("base64");
  const body = buildChatBody(query, encKey);

  const r = await curlPost(CHAT_EP, chatHeaders(session.accessToken), body);
  const raw = r.raw ?? "";

  // 401 → re-auth and retry
  if (raw.includes('"error"') && raw.includes("401")) {
    logger.warn("Aria: possible 401, resetting session");
    _session = null;
    const newSession = await getSession();
    const r2 = await curlPost(CHAT_EP, chatHeaders(newSession.accessToken), body);
    return parseAriaSSEBody(r2.raw ?? "");
  }

  return parseAriaSSEBody(raw);
}

function parseAriaSSEBody(raw: string): AriaChatResult {
  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const chunk = line.slice(6).trim();
    if (chunk === "[DONE]") break;
    try {
      const j = JSON.parse(chunk) as { message?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (j.message) content += j.message;
      if (j.usage) {
        inputTokens = j.usage.prompt_tokens ?? 0;
        outputTokens = j.usage.completion_tokens ?? 0;
      }
    } catch { /* skip */ }
  }
  return { content, inputTokens, outputTokens };
}

/** Streaming: returns a curl child process whose stdout emits raw SSE bytes. */
export async function ariaChatStream(query: string): Promise<ReturnType<typeof spawn>> {
  const session = await getSession();
  const encKey = randomBytes(32).toString("base64");
  const body = buildChatBody(query, encKey);
  const r = await curlPost(CHAT_EP, chatHeaders(session.accessToken), body, { stream: true });
  return r.childProcess!;
}

export function parseAriaSSELine(line: string): string | null {
  if (!line.startsWith("data: ")) return null;
  const raw = line.slice(6).trim();
  if (raw === "[DONE]") return null;
  try {
    const j = JSON.parse(raw) as { message?: string };
    return j.message ?? null;
  } catch {
    return null;
  }
}

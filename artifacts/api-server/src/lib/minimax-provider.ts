import { createHash } from "crypto";
import { execSync } from "child_process";
import { logger } from "./logger";

export interface ChatMessage { role: string; content: string; }

const BASE = "https://agent.minimax.io";
const ARCHON = "/archon/api/v1";
const SIGN_SALT = "I*7Cf%WZ#S&%1RlZJ&C2";

// Fixed device fingerprint (matches what the server validated against)
const DEVICE = {
  uuid: "c451c3b9-3de8-4545-9ba9-72bbb241054f",
  device_id: "23492706",
  user_id: "518879131345821696",
  timezone_offset: "25200",
  browser_language: "id-ID",
};

interface ModelInfo { model_id: string; variant?: string; }

export const MINIMAX_MODELS: Record<string, ModelInfo> = {
  "minimax-m3":             { model_id: "MiniMax-M3",           variant: "thinking" },
  "minimax-m3-thinking":    { model_id: "MiniMax-M3",           variant: "thinking" },
  "minimax-m2.7":           { model_id: "MiniMax-M2.7",         variant: "" },
  "minimax-m2.7-highspeed": { model_id: "MiniMax-M2.7-highspeed", variant: "" },
};

export function isMinimaxModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized.startsWith("minimax-") ||
    normalized === "minimax-m3" ||
    normalized === "minimax-m2.7" ||
    normalized === "minimax-m2.7-highspeed"
  );
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function resolveModel(model: string): ModelInfo {
  return MINIMAX_MODELS[model.toLowerCase()] ?? { model_id: "MiniMax-M3", variant: "thinking" };
}

function buildQueryString(tsSec: number, token: string): string {
  const tsMs = tsSec * 1000;
  const params = new URLSearchParams([
    ["device_platform", "web"],
    ["biz_id", "3"],
    ["app_id", "3001"],
    ["version_code", "22201"],
    ["unix", String(tsMs)],
    ["timezone_offset", DEVICE.timezone_offset],
    ["sys_language", "en"],
    ["lang", "en"],
    ["uuid", DEVICE.uuid],
    ["device_id", DEVICE.device_id],
    ["os_name", "Linux"],
    ["browser_name", "Chrome"],
    ["device_memory", "8"],
    ["cpu_core_num", "8"],
    ["browser_language", DEVICE.browser_language],
    ["browser_platform", "Linux armv81"],
    ["user_id", DEVICE.user_id],
    ["screen_width", "599"],
    ["screen_height", "1332"],
    ["token", token],
    ["client", "web"],
    ["region", "en"],
  ]);
  return params.toString();
}

function minimaxHeaders(tsSec: number, body: string, token: string): string {
  const sig = md5(`${tsSec}${SIGN_SALT}${body}`);
  return [
    `-H "token: ${token}"`,
    `-H "x-signature: ${sig}"`,
    `-H "x-timestamp: ${tsSec}"`,
    `-H "Content-Type: application/json"`,
    `-H "Accept: text/event-stream"`,
    `-H "Origin: ${BASE}"`,
    `-H "Referer: ${BASE}/"`,
    `-H "User-Agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"`,
  ].join(" ");
}

function buildPrompt(messages: ChatMessage[]): string {
  if (messages.length === 1) return messages[0].content;
  const lines: string[] = [];
  for (const msg of messages) {
    const role =
      msg.role === "assistant" ? "Assistant" :
      msg.role === "system"    ? "System"    :
      msg.role === "tool"      ? "Tool Result" :
                                  "User";
    lines.push(`${role}: ${msg.content}`);
  }
  return lines.join("\n\n");
}

function getToken(): string {
  const token = process.env.MINIMAX_TOKEN;
  if (!token) throw new Error("MINIMAX_TOKEN env var not set");
  return token;
}

function getSessionId(): string {
  const sid = process.env.MINIMAX_SESSION_ID;
  if (!sid) throw new Error("MINIMAX_SESSION_ID env var not set");
  return sid;
}

function curlSSE(sessionId: string, bodyStr: string, token: string): string {
  const tsSec = Math.floor(Date.now() / 1000);
  const qs = buildQueryString(tsSec, token);
  const url = `${BASE}${ARCHON}/session/${sessionId}/message?${qs}`;
  const headers = minimaxHeaders(tsSec, bodyStr, token);
  const safeBody = bodyStr.replace(/'/g, "'\\''");

  return execSync(
    `curl -sN -X POST "${url}" ${headers} --max-time 60 -d '${safeBody}'`,
    { maxBuffer: 20 * 1024 * 1024 },
  ).toString();
}

interface MinimaxChunk {
  type: number;
  agent_message_chunk?: {
    msg_id: string;
    chunk_index: number;
    role?: string;
    msg_content?: string;
    thinking_content?: string;
    finish?: boolean;
    finish_reason?: string;
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
  agent_message?: {
    msg_id?: string;
    role?: string;
    msg_content?: string;
    thinking_content?: string;
    finish_reason?: string;
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
}

function parseSSE(raw: string): { content: string; inputTokens: number; outputTokens: number } {
  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    try {
      const chunk = JSON.parse(data) as MinimaxChunk;

      // type:6 — streaming chunk
      if (chunk.type === 6 && chunk.agent_message_chunk) {
        const c = chunk.agent_message_chunk;
        // msg_content = actual response (not thinking)
        if (c.msg_content) content += c.msg_content;
      }

      // type:2 — final complete message (last one has usage)
      if (chunk.type === 2 && chunk.agent_message) {
        const m = chunk.agent_message;
        if (m.role === "assistant" && m.usage) {
          inputTokens = m.usage.input_tokens ?? 0;
          outputTokens = m.usage.output_tokens ?? 0;
          // If content was not assembled from chunks, use final message
          if (!content && m.msg_content) content = m.msg_content;
        }
      }
    } catch { /* skip malformed */ }
  }

  return { content, inputTokens, outputTokens };
}

export async function minimaxChat(
  messages: ChatMessage[],
  model = "minimax-m3",
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const token = getToken();
  const sessionId = getSessionId();
  const prompt = buildPrompt(messages);
  const minimaxModel = resolveModel(model);

  const bodyStr = JSON.stringify({ content: prompt, model: minimaxModel });

  logger.info({ sessionId, model: minimaxModel }, "minimax: sending request");

  const raw = curlSSE(sessionId, bodyStr, token);
  const result = parseSSE(raw);

  if (!result.content) {
    logger.warn({ rawSnippet: raw.slice(0, 300) }, "minimax: empty content in response");
    throw new Error("No content in MiniMax response");
  }

  return result;
}

export async function* minimaxStream(
  messages: ChatMessage[],
  model = "minimax-m3",
): AsyncGenerator<string> {
  // MiniMax streams through execSync (blocking), then we chunk the result
  const result = await minimaxChat(messages, model);
  // Simulate streaming by yielding full text in one shot
  if (result.content) yield result.content;
}

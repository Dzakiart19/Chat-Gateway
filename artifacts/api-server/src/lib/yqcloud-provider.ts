/**
 * Yqcloud Provider
 *
 * Endpoint : POST https://api.binjie.fun/api/generateStream
 * Model    : GPT-4 (proxied, no auth required)
 * Pool     : 200 pre-generated userIds, rotated round-robin to spread
 *            per-session rate-limit pressure — same pattern as Qwen umid-pool.
 */

import { randomUUID } from "crypto";
import { Readable } from "stream";
import { logger } from "./logger";

const API_URL = "https://api.binjie.fun/api/generateStream";
const ORIGIN  = "https://chat9.yqcloud.top";
const POOL_SIZE = 200;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// ── userId pool ───────────────────────────────────────────────────────────────

const userIdPool: string[] = Array.from({ length: POOL_SIZE }, () =>
  randomUUID().replace(/-/g, "").slice(0, 20),
);
let poolCursor = 0;

function nextUserId(): string {
  const id = userIdPool[poolCursor % POOL_SIZE];
  poolCursor = (poolCursor + 1) % POOL_SIZE;
  return id;
}

// ── Message helpers ───────────────────────────────────────────────────────────

interface ChatMessage {
  role: string;
  content: string;
}

function buildPrompt(messages: ChatMessage[]): string {
  return messages
    .filter(m => m.role !== "system")
    .map(m => (m.role === "assistant" ? `Assistant: ${m.content}` : `User: ${m.content}`))
    .join("\n") + "\nAssistant:";
}

function extractSystem(messages: ChatMessage[]): string {
  return messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n");
}

// ── Streaming ─────────────────────────────────────────────────────────────────

export async function yqcloudChatStream(
  messages: ChatMessage[],
): Promise<Readable> {
  const userId = nextUserId();
  const prompt = buildPrompt(messages);
  const system = extractSystem(messages);

  const body = JSON.stringify({
    prompt,
    userId,
    network: true,
    system,
    withoutContext: false,
    stream: true,
  });

  logger.debug({ userId }, "yqcloud: sending request");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "origin": ORIGIN,
      "referer": `${ORIGIN}/`,
      "user-agent": UA,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Yqcloud HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  if (!res.body) throw new Error("Yqcloud: no response body");

  const readable = Readable.from(
    (async function* () {
      const reader = (res.body as unknown as { getReader(): ReadableStreamDefaultReader<Uint8Array> }).getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield dec.decode(value, { stream: true });
      }
    })(),
  );

  return readable;
}

export async function yqcloudChat(messages: ChatMessage[]): Promise<{ content: string }> {
  const stream = await yqcloudChatStream(messages);
  return new Promise((resolve, reject) => {
    let content = "";
    stream.on("data", (chunk: Buffer | string) => { content += chunk.toString(); });
    stream.on("end", () => resolve({ content: content.trim() }));
    stream.on("error", reject);
  });
}

export const YQCLOUD_MODELS = [
  { id: "yqcloud",         object: "model", created: 1700000000, owned_by: "yqcloud" },
  { id: "yqcloud-gpt4",    object: "model", created: 1700000000, owned_by: "yqcloud" },
];

export function isYqcloudModel(model: string): boolean {
  return model === "yqcloud" || model === "yqcloud-gpt4";
}

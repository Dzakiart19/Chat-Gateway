/**
 * DeepSeek Official API Provider
 *
 * Endpoint : https://api.deepseek.com/v1/chat/completions  (OpenAI-compatible)
 * Models   : deepseek-chat (V3-0324), deepseek-reasoner (R1)
 * Auth     : Bearer token — DEEPSEEK_API_KEY env var
 *
 * Notes:
 *  - deepseek-chat     : DeepSeek-V3, 64K ctx, tool-calling, JSON mode — no native vision
 *  - deepseek-reasoner : DeepSeek-R1, 64K ctx, extended reasoning via reasoning_content field
 *  - Vision            : not supported natively — v1.ts calls flattenVisionMessages() first
 *  - Tool calling      : prompt injection + detectToolCalls() in v1.ts (same as all providers)
 *  - For deepseek-reasoner, only the final `content` delta is yielded (reasoning_content is
 *    skipped) so detectToolCalls() receives clean JSON from the model output
 */

import { logger } from "./logger";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY ?? "";
  if (!key) throw new Error("DEEPSEEK_API_KEY env var is not set");
  return key;
}

export interface DeepseekMessage {
  role: string;
  content: string;
}

export const DEEPSEEK_MODELS = [
  { id: "deepseek-chat",     object: "model", created: 1748736000, owned_by: "deepseek" },
  { id: "deepseek-reasoner", object: "model", created: 1748736000, owned_by: "deepseek" },
];

export function isDeepseekModel(model: string): boolean {
  return DEEPSEEK_MODELS.some(m => m.id === model);
}

/**
 * Streaming generator — yields plain text tokens only.
 *
 * For deepseek-reasoner: only yields final `content` chunks (not `reasoning_content`),
 * ensuring the accumulated output is clean tool-call JSON or prose — not interspersed
 * with chain-of-thought text that would break detectToolCalls().
 */
export async function* deepseekStream(
  messages: DeepseekMessage[],
  model = "deepseek-chat",
): AsyncGenerator<string> {
  const key = getApiKey();

  const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`DeepSeek API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  if (!resp.body) throw new Error("DeepSeek: no response body");

  type Chunk = {
    choices?: Array<{
      delta?: { content?: string | null; reasoning_content?: string | null };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const reader = (resp.body as unknown as { getReader(): ReadableStreamDefaultReader<Uint8Array> }).getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const chunk = JSON.parse(data) as Chunk;
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          const content = delta.content ?? "";
          if (content) yield content;
        } catch { /* skip malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming chat call — returns full content + accurate token counts from the API.
 */
export async function deepseekChat(
  messages: DeepseekMessage[],
  model = "deepseek-chat",
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const key = getApiKey();

  const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: false }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`DeepSeek API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  type Response = {
    choices?: Array<{
      message?: { content?: string | null };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const data = await resp.json() as Response;
  const content = (data.choices?.[0]?.message?.content ?? "").trim();
  const inputTokens  = data.usage?.prompt_tokens     ?? Math.round(messages.map(m => m.content).join("").length / 4);
  const outputTokens = data.usage?.completion_tokens ?? Math.round(content.length / 4);

  logger.debug({ model, inputTokens, outputTokens, len: content.length }, "deepseek: non-stream done");

  return { content, inputTokens, outputTokens };
}

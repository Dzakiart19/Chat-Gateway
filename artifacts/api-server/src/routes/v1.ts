import { Router } from "express";
import { randomUUID } from "crypto";
import { requireApiKey } from "../middleware/requireApiKey";
import { logger } from "../lib/logger";

const router = Router();

const QWEN_ORIGIN = "https://chat.qwen.ai";
const QWEN_BASE = `${QWEN_ORIGIN}/api/v2`;
const UMID_URL = "https://sg-wum.alibaba.com/w/wu.json";
const TOKEN_TTL = 3600_000;

let _midtoken = "";
let _midtokenTs = 0;

async function getMidtoken(): Promise<string> {
  if (_midtoken && Date.now() - _midtokenTs < TOKEN_TTL) return _midtoken;
  try {
    const res = await fetch(UMID_URL, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/138.0.0.0 Safari/537.36" },
    });
    const text = await res.text();
    const m = text.match(/(?:umx\.wu|__fycb)\('([^']+)'\)/);
    if (m) { _midtoken = m[1]; _midtokenTs = Date.now(); }
  } catch { /* ignore */ }
  return _midtoken;
}

function qwenHeaders(midtoken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: QWEN_ORIGIN,
    Referer: `${QWEN_ORIGIN}/`,
    "X-Requested-With": "XMLHttpRequest",
    "X-Source": "web",
    "bx-v": "2.5.31",
    ...(midtoken ? { "bx-umidtoken": midtoken } : {}),
  };
}

async function createQwenChat(headers: Record<string, string>, model: string): Promise<string> {
  const res = await fetch(`${QWEN_BASE}/chats/new`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "New Chat", models: [model], chat_mode: "normal", chat_type: "t2t", timestamp: Date.now() }),
  });
  const data = await res.json() as { success: boolean; data?: { id: string } };
  if (!data.success || !data.data?.id) throw new Error(`createChat failed: ${JSON.stringify(data)}`);
  return data.data.id;
}

function parseQwenSSE(body: string): { content: string; inputTokens: number; outputTokens: number } {
  let answer = ""; let fallback = "";
  let inputTokens = 0; let outputTokens = 0;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const chunk = JSON.parse(line.slice(5).trim()) as {
        choices?: Array<{ delta?: { content?: string; extra?: { output_schema?: string } } }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (chunk.usage) {
        inputTokens = chunk.usage.input_tokens ?? 0;
        outputTokens = chunk.usage.output_tokens ?? 0;
      }
      const delta = chunk.choices?.[0]?.delta;
      const content = delta?.content ?? "";
      if (!content) continue;
      if ((delta?.extra?.output_schema ?? "") === "answer") { answer += content; } else { fallback += content; }
    } catch { /* skip */ }
  }
  return { content: answer || fallback, inputTokens, outputTokens };
}

function messagesToPrompt(messages: Array<{ role: string; content?: string | null }>): string {
  return messages.map(m => {
    const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
    return `${role}: ${m.content ?? ""}`;
  }).join("\n");
}

// POST /v1/chat/completions (OpenAI-compatible)
router.post("/chat/completions", requireApiKey, async (req, res) => {
  const {
    model = "qwen3-235b-a22b",
    messages,
    temperature: _temp,
    max_tokens: _max,
    stream = false,
  } = req.body as {
    model?: string;
    messages?: Array<{ role: string; content?: string | null }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { message: "messages is required and must be a non-empty array", type: "invalid_request_error", code: "missing_messages" } });
    return;
  }

  const id = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 29)}`;

  try {
    const midtoken = await getMidtoken();
    const headers = qwenHeaders(midtoken);
    const chatId = await createQwenChat(headers, model);

    const msgId = randomUUID();
    const userPrompt = messagesToPrompt(messages);
    const r2 = await fetch(`${QWEN_BASE}/chat/completions?chat_id=${chatId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        stream: true, incremental_output: true, chat_id: chatId, chat_mode: "normal", model,
        parent_id: null,
        messages: [{
          fid: msgId, parentId: null, childrenIds: [], role: "user",
          content: userPrompt, user_action: "chat", files: [], models: [model],
          chat_type: "t2t",
          feature_config: { thinking_enabled: false, output_schema: "phase", thinking_budget: 81920 },
          sub_chat_type: "t2t",
        }],
      }),
    });

    const body = await r2.text();
    const { content, inputTokens, outputTokens } = parseQwenSSE(body);

    if (!content) {
      res.status(502).json({
        error: { message: "No response from model", type: "upstream_error", code: "empty_response" }
      });
      return;
    }

    res.json({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        logprobs: null,
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      system_fingerprint: "fp_qwen_gateway",
    });
  } catch (err) {
    logger.error({ err }, "v1/chat/completions error");
    res.status(500).json({ error: { message: "Internal server error", type: "server_error" } });
  }
});

// GET /v1/models
router.get("/models", requireApiKey, (_req, res) => {
  const models = [
    { id: "qwen3-235b-a22b", object: "model", created: 1700000000, owned_by: "qwen" },
    { id: "qwen3.7-max", object: "model", created: 1700000000, owned_by: "qwen" },
    { id: "qwen3-30b-a3b", object: "model", created: 1700000000, owned_by: "qwen" },
  ];
  res.json({ object: "list", data: models });
});

export default router;

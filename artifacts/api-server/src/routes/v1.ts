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

// ── Tool-calling types ──────────────────────────────────────────────────────

interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}
interface Tool { type: "function"; function: ToolFunction }

interface DetectedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// Build compact tool definitions block
function buildToolDefs(tools: Tool[]): string {
  return tools.map(t => {
    const f = t.function;
    const params = f.parameters ? JSON.stringify(f.parameters) : "{}";
    return `- ${f.name}: ${f.description ?? "(no description)"} | params: ${params}`;
  }).join("\n");
}

// Inject tool instructions into messages
// Strategy: prepend system block + append reminder to LAST user message
function injectToolPrompt(
  messages: Message[],
  tools: Tool[],
  toolChoice: string | { type: string; function?: { name: string } } | undefined,
): Message[] {
  const defs = buildToolDefs(tools);

  // Determine if a specific tool is forced
  const forcedTool =
    typeof toolChoice === "object" && toolChoice?.type === "function"
      ? toolChoice.function?.name
      : toolChoice === "required"
        ? tools[0]?.function?.name
        : null;

  const systemBlock = `You have access to external tools listed below. You do NOT have real-time internet access, so whenever the user asks for live data (weather, prices, time, news, calculations, etc.) you MUST call the appropriate tool instead of saying you cannot.

AVAILABLE TOOLS:
${defs}

RESPONSE FORMAT — when calling a tool, output ONLY this raw JSON (no markdown, no explanation):
{"tool_calls":[{"name":"FUNCTION_NAME","arguments":{...}}]}

When NOT calling a tool, respond normally in plain text.`;

  // Build message list with system injected
  let result: Array<{ role: string; content?: string | null }>;
  const first = messages[0];
  if (first?.role === "system") {
    result = [
      { role: "system", content: `${first.content ?? ""}\n\n${systemBlock}` },
      ...messages.slice(1),
    ];
  } else {
    result = [{ role: "system", content: systemBlock }, ...messages];
  }

  // Append a strong reminder to the last user message
  const lastIdx = result.length - 1;
  const last = result[lastIdx];
  if (last?.role === "user") {
    const reminder = forcedTool
      ? `\n\n[SYSTEM: You MUST call the tool "${forcedTool}" to answer this. Output only the JSON tool_calls object.]`
      : `\n\n[SYSTEM: If this request needs live data or an action you cannot do internally, call the appropriate tool. Output ONLY the JSON object {"tool_calls":[...]} with no other text.]`;
    result = [
      ...result.slice(0, lastIdx),
      { role: "user", content: `${last.content ?? ""}${reminder}` },
    ];
  }

  return result;
}

// Try to extract JSON tool_calls block from raw model response
function detectToolCalls(raw: string): DetectedToolCall[] | null {
  // Strip optional code fences
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Find first { ... } block
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      tool_calls?: Array<{ name: string; arguments: unknown }>;
    };
    if (!Array.isArray(parsed.tool_calls) || parsed.tool_calls.length === 0) return null;
    return parsed.tool_calls.map((tc, i) => ({
      id: `call_${randomUUID().replace(/-/g, "").slice(0, 20)}_${i}`,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
      },
    }));
  } catch {
    return null;
  }
}

interface Message {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

function messagesToPrompt(messages: Message[]): string {
  return messages.map(m => {
    if (m.role === "system") {
      return `System: ${m.content ?? ""}`;
    }
    if (m.role === "assistant") {
      if (m.tool_calls && m.tool_calls.length > 0) {
        // Assistant requested tool calls — render as JSON so model understands history
        const calls = m.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; } })(),
        }));
        const toolJson = JSON.stringify({ tool_calls: calls });
        const extra = m.content ? `${m.content}\n` : "";
        return `Assistant: ${extra}${toolJson}`;
      }
      return `Assistant: ${m.content ?? ""}`;
    }
    if (m.role === "tool") {
      // Tool result — label clearly so model understands it as tool output
      const toolName = m.name ? ` (${m.name})` : "";
      return `Tool Result${toolName} [id=${m.tool_call_id ?? "?"}]: ${m.content ?? ""}`;
    }
    // user or fallback
    return `User: ${m.content ?? ""}`;
  }).join("\n");
}

// POST /v1/chat/completions (OpenAI-compatible, with tool calling)
router.post("/chat/completions", requireApiKey, async (req, res) => {
  const {
    model = "qwen3-235b-a22b",
    messages,
    tools,
    tool_choice: _toolChoice,
    temperature: _temp,
    max_tokens: _max,
    stream = false,
  } = req.body as {
    model?: string;
    messages?: Message[];
    tools?: Tool[];
    tool_choice?: "none" | "auto" | "required" | { type: string; function?: { name: string } };
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stream?: boolean;
  };

  // Clamp temperature to 0–2 range Qwen supports
  const temperature = typeof _temp === "number"
    ? Math.max(0, Math.min(2, _temp))
    : 0.7;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { message: "messages is required and must be a non-empty array", type: "invalid_request_error", code: "missing_messages" } });
    return;
  }

  const hasTools = Array.isArray(tools) && tools.length > 0 && _toolChoice !== "none";
  const effectiveMessages = hasTools ? injectToolPrompt(messages, tools!, _toolChoice) : messages;
  const id = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 29)}`;

  // ── SSE helpers ─────────────────────────────────────────────────────────
  function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
    const payload = {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    };
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  function startSSE() {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
  }

  try {
    const midtoken = await getMidtoken();
    const headers = qwenHeaders(midtoken);
    const chatId = await createQwenChat(headers, model);

    const msgId = randomUUID();
    const userPrompt = messagesToPrompt(effectiveMessages);

    const r2 = await fetch(`${QWEN_BASE}/chat/completions?chat_id=${chatId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        stream: true, incremental_output: true, chat_id: chatId, chat_mode: "normal", model,
        temperature,
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

    // ── STREAMING path ──────────────────────────────────────────────────────
    if (stream) {
      startSSE();

      // Tools: must buffer full response first to detect tool calls
      if (hasTools) {
        const body = await r2.text();
        const { content, inputTokens, outputTokens } = parseQwenSSE(body);

        if (!content) {
          res.write(`data: ${JSON.stringify({ error: "No response from model" })}\n\ndata: [DONE]\n\n`);
          res.end();
          return;
        }

        const toolCalls = detectToolCalls(content);

        if (toolCalls) {
          // Stream tool_calls deltas (OpenAI streaming format for tool calls)
          res.write(sseChunk({ role: "assistant", content: null }));
          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            // First delta for this tool: id + name
            res.write(sseChunk({
              tool_calls: [{
                index: i, id: tc.id, type: "function",
                function: { name: tc.function.name, arguments: "" },
              }],
            }));
            // Stream arguments in small chunks
            const args = tc.function.arguments;
            const chunkSize = 20;
            for (let j = 0; j < args.length; j += chunkSize) {
              res.write(sseChunk({
                tool_calls: [{ index: i, function: { arguments: args.slice(j, j + chunkSize) } }],
              }));
            }
          }
          res.write(sseChunk({}, "tool_calls"));
        } else {
          // Fake-stream text content word by word
          res.write(sseChunk({ role: "assistant", content: "" }));
          const words = content.split(/(\s+)/);
          for (const word of words) {
            if (word) res.write(sseChunk({ content: word }));
          }
          res.write(sseChunk({}, "stop"));
        }

        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // No tools: true SSE streaming — pipe Qwen SSE → OpenAI SSE
      if (!r2.body) {
        res.write(`data: ${JSON.stringify({ error: "No response body" })}\n\ndata: [DONE]\n\n`);
        res.end();
        return;
      }

      res.write(sseChunk({ role: "assistant", content: "" }));

      const reader = (r2.body as unknown as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } }).getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });

        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const chunk = JSON.parse(line.slice(5).trim()) as {
              choices?: Array<{ delta?: { content?: string; extra?: { output_schema?: string } } }>;
            };
            const delta = chunk.choices?.[0]?.delta;
            const content = delta?.content ?? "";
            if (!content) continue;
            const schema = delta?.extra?.output_schema ?? "";
            if (schema && schema !== "answer") continue;
            res.write(sseChunk({ content }));
          } catch { /* skip malformed */ }
        }
      }

      res.write(sseChunk({}, "stop"));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ── NON-STREAMING path (original) ───────────────────────────────────────
    const body = await r2.text();
    const { content, inputTokens, outputTokens } = parseQwenSSE(body);

    if (!content) {
      res.status(502).json({
        error: { message: "No response from model", type: "upstream_error", code: "empty_response" }
      });
      return;
    }

    const toolCalls = hasTools ? detectToolCalls(content) : null;

    if (toolCalls) {
      res.json({
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: null, tool_calls: toolCalls },
          logprobs: null,
          finish_reason: "tool_calls",
        }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
        system_fingerprint: "fp_qwen_gateway",
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
    if (!res.headersSent) {
      res.status(500).json({ error: { message: "Internal server error", type: "server_error" } });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Internal server error" })}\n\ndata: [DONE]\n\n`);
      res.end();
    }
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

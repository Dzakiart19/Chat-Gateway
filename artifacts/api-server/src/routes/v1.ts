import { Router } from "express";
import { randomUUID, createHmac } from "crypto";
import { requireApiKey } from "../middleware/requireApiKey";
import { logger } from "../lib/logger";
import { recordRequest } from "../lib/stats";
import { getPooledMidtoken } from "../lib/umid-pool";
import { ariaChat, ariaChatStream, parseAriaSSELine } from "../lib/aria-provider";

const router = Router();

const QWEN_ORIGIN = "https://chat.qwen.ai";
const QWEN_BASE = `${QWEN_ORIGIN}/api/v2`;

async function getMidtoken(): Promise<string> {
  return getPooledMidtoken();
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

function buildToolDefs(tools: Tool[]): string {
  return tools.map(t => {
    const f = t.function;
    const params = f.parameters ? JSON.stringify(f.parameters) : "{}";
    return `- ${f.name}: ${f.description ?? "(no description)"} | params: ${params}`;
  }).join("\n");
}

function injectToolPrompt(
  messages: Message[],
  tools: Tool[],
  toolChoice: string | { type: string; function?: { name: string } } | undefined,
): Message[] {
  const defs = buildToolDefs(tools);

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

  let result: Array<{ role: string; content?: string | ContentPart[] | null }>;
  const first = messages[0];
  if (first?.role === "system") {
    result = [
      { role: "system", content: `${getMessageText(first.content)}\n\n${systemBlock}` },
      ...messages.slice(1),
    ];
  } else {
    result = [{ role: "system", content: systemBlock }, ...messages];
  }

  const lastIdx = result.length - 1;
  const last = result[lastIdx];
  if (last?.role === "user") {
    const reminder = forcedTool
      ? `\n\n[SYSTEM: You MUST call the tool "${forcedTool}" to answer this. Output only the JSON tool_calls object.]`
      : `\n\n[SYSTEM: If this request needs live data or an action you cannot do internally, call the appropriate tool. Output ONLY the JSON object {"tool_calls":[...]} with no other text.]`;

    const lastText = getMessageText(last.content);
    const lastImages = getMessageImages(last.content);
    result = [
      ...result.slice(0, lastIdx),
      {
        role: "user",
        content: lastImages.length > 0
          ? buildMultipartContent(lastText + reminder, lastImages)
          : `${lastText}${reminder}`,
      },
    ];
  }

  return result;
}

function injectJsonMode(messages: Message[]): Message[] {
  const jsonInstruction =
    "You MUST respond with a valid JSON object only. Do not include any explanation, markdown, or text outside the JSON structure.";
  const first = messages[0];
  if (first?.role === "system") {
    return [
      { role: "system", content: `${getMessageText(first.content)}\n\n${jsonInstruction}` },
      ...messages.slice(1),
    ];
  }
  return [{ role: "system", content: jsonInstruction }, ...messages];
}

function detectToolCalls(raw: string): DetectedToolCall[] | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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

// ── Vision / multipart content types ─────────────────────────────────────────

interface TextContentPart {
  type: "text";
  text: string;
}

interface ImageUrlContentPart {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}

type ContentPart = TextContentPart | ImageUrlContentPart;

interface Message {
  role: string;
  content?: string | ContentPart[] | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

/** Extract plain text from a message content (string or multipart array). */
function getMessageText(content: string | ContentPart[] | null | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is TextContentPart => p.type === "text")
    .map(p => p.text)
    .join("\n");
}

/** Extract image URLs from a message content array. */
function getMessageImages(content: string | ContentPart[] | null | undefined): string[] {
  if (!content || typeof content === "string") return [];
  return content
    .filter((p): p is ImageUrlContentPart => p.type === "image_url")
    .map(p => p.image_url?.url)
    .filter((u): u is string => Boolean(u));
}

/** Build a multipart content array from text + image URLs. */
function buildMultipartContent(text: string, images: string[]): ContentPart[] {
  const parts: ContentPart[] = [];
  if (text) parts.push({ type: "text", text });
  for (const url of images) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

/** Collect all image URLs from all messages in a conversation. */
function collectAllImages(messages: Message[]): string[] {
  return messages.flatMap(m => getMessageImages(m.content));
}

// ── Vision / image upload types & helpers ─────────────────────────────────────

interface QwenFileDescriptor {
  url: string;
  type: string;
  file_type: string;
  file_class: string;
  showType: string;
  status: string;
  name: string;
  id: string;
}

/** Fetch the acw_tc anti-bot cookie from chat.qwen.ai (needed for file uploads). */
async function getQwenCookies(midtoken: string): Promise<string> {
  const res = await fetch(QWEN_ORIGIN, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
      "bx-umidtoken": midtoken,
    },
    redirect: "follow",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  return setCookie.split(/,(?=[^ ])/).map((c: string) => c.split(";")[0].trim()).join("; ");
}

/** Detect MIME type from a URL or data URI string. */
function detectMimeType(url: string): string {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+)/);
    return m?.[1] || "image/jpeg";
  }
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

/** Fetch image bytes and MIME type from a URL or data URI. */
async function fetchImageBytes(url: string): Promise<{ buf: Buffer; mimeType: string; filename: string }> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (!m) throw new Error("Invalid data URI");
    const mimeType = m[1];
    const buf = Buffer.from(m[2], "base64");
    const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    return { buf, mimeType, filename: `image.${ext}` };
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36" },
  });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type")?.split(";")[0].trim() || detectMimeType(url);
  const mimeType = ct.startsWith("image/") ? ct : detectMimeType(url);
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const rawName = url.split("/").pop()?.split("?")[0] || `image.${ext}`;
  const filename = rawName.includes(".") ? rawName : `${rawName}.${ext}`;
  return { buf, mimeType, filename };
}

/**
 * Upload a single image (URL or base64 data URI) to Qwen OSS and return
 * a QwenFileDescriptor ready for use in the files[] array.
 *
 * Flow: getstsToken → OSS PUT (HMAC-SHA1) → /files/parse → descriptor
 */
async function uploadImageToQwen(
  imageUrl: string,
  uploadHeaders: Record<string, string>,
): Promise<QwenFileDescriptor> {
  const { buf, mimeType, filename } = await fetchImageBytes(imageUrl);

  const stsRes = await fetch(`${QWEN_BASE}/files/getstsToken`, {
    method: "POST",
    headers: uploadHeaders,
    body: JSON.stringify({ filename, filesize: String(buf.length), filetype: "image" }),
  });
  const stsData = (await stsRes.json()) as { data: { file_id: string; file_url: string; file_path: string; bucketname: string; endpoint: string; access_key_id: string; access_key_secret: string; security_token: string } };
  const sts = stsData.data;

  const date = new Date().toUTCString();
  const stringToSign = `PUT\n\n${mimeType}\n${date}\nx-oss-security-token:${sts.security_token}\n/${sts.bucketname}/${sts.file_path}`;
  const sig = createHmac("sha1", sts.access_key_secret).update(stringToSign).digest("base64");

  const putRes = await fetch(`https://${sts.bucketname}.${sts.endpoint}/${sts.file_path}`, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Date": date,
      "Authorization": `OSS ${sts.access_key_id}:${sig}`,
      "x-oss-security-token": sts.security_token,
    },
    body: buf,
  });
  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => "");
    throw new Error(`OSS PUT failed: ${putRes.status} ${errText.slice(0, 200)}`);
  }

  await fetch(`${QWEN_BASE}/files/parse`, {
    method: "POST",
    headers: uploadHeaders,
    body: JSON.stringify({ file_id: sts.file_id }),
  });

  return {
    url: sts.file_url,
    type: "image",
    file_type: mimeType,
    file_class: "vision",
    showType: "image",
    status: "uploaded",
    name: filename,
    id: sts.file_id,
  };
}

/**
 * Upload all image URLs to Qwen CDN (parallel). Returns QwenFileDescriptors.
 * Failures are logged and skipped so a bad image doesn't kill the whole request.
 */
async function resolveImageUrls(
  imageUrls: string[],
  uploadHeaders: Record<string, string>,
): Promise<QwenFileDescriptor[]> {
  const results = await Promise.all(
    imageUrls.map(u =>
      uploadImageToQwen(u, uploadHeaders).catch(err => {
        logger.warn({ err: String(err), url: u.slice(0, 80) }, "vision: image upload failed, skipping");
        return null;
      }),
    ),
  );
  return results.filter((r): r is QwenFileDescriptor => r !== null);
}

function messagesToPrompt(messages: Message[], suppressImageNotes = false): string {
  return messages.map(m => {
    const text = getMessageText(m.content);
    const images = getMessageImages(m.content);
    const imageNote = (!suppressImageNotes && images.length > 0)
      ? `\n[${images.length} image${images.length > 1 ? "s" : ""} attached]`
      : "";

    if (m.role === "system") return `System: ${text}${imageNote}`;
    if (m.role === "assistant") {
      if (m.tool_calls && m.tool_calls.length > 0) {
        const calls = m.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; } })(),
        }));
        const toolJson = JSON.stringify({ tool_calls: calls });
        const extra = text ? `${text}\n` : "";
        return `Assistant: ${extra}${toolJson}`;
      }
      return `Assistant: ${text}${imageNote}`;
    }
    if (m.role === "tool") {
      const toolName = m.name ? ` (${m.name})` : "";
      return `Tool Result${toolName} [id=${m.tool_call_id ?? "?"}]: ${text}`;
    }
    return `User: ${text}${imageNote}`;
  }).join("\n");
}

// ── Model registry ───────────────────────────────────────────────────────────

const MODELS = [
  // Opera Aria — keyless, anonymous auth, powered by OpenAI + Google
  { id: "aria",                         object: "model", created: 1700000000, owned_by: "opera" },
  // Text + vision models — all available via chat.qwen.ai proxy
  { id: "qwen3.7-max",                 object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen3.6-plus",                object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen3.6-max-preview",         object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen3-235b-a22b",             object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen3-30b-a3b",               object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen-max-latest",             object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen-turbo-latest",           object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen2.5-coder-32b-instruct",  object: "model", created: 1700000000, owned_by: "qwen" },
  // Vision-capable model aliases (all route to text models with vision upload support)
  { id: "qwen-vl-max-latest",          object: "model", created: 1700000000, owned_by: "qwen" },
  { id: "qwen2.5-vl-72b-instruct",     object: "model", created: 1700000000, owned_by: "qwen" },
];

const MODEL_ALIASES: Record<string, string> = {
  // qwen-max family
  "qwen-max":              "qwen3.7-max",
  "qwen-max-0919":         "qwen3.7-max",
  // qwen-plus family
  "qwen-plus":             "qwen3.6-plus",
  "qwen-plus-latest":      "qwen3.6-plus",
  "qwen-plus-0723":        "qwen3.6-plus",
  // qwen-turbo family
  "qwen-turbo":            "qwen-turbo-latest",
  "qwen-turbo-0919":       "qwen-turbo-latest",
  // qwen-long
  "qwen-long":             "qwen3.6-plus",
  // qwq / reasoning
  "qwq-32b":               "qwen3.7-max",
  "qwq-32b-preview":       "qwen3.7-max",
  // qwen3 small/mid
  "qwen3-0.6b":            "qwen3-30b-a3b",
  "qwen3-1.7b":            "qwen3-30b-a3b",
  "qwen3-4b":              "qwen3-30b-a3b",
  "qwen3-8b":              "qwen3-30b-a3b",
  "qwen3-14b":             "qwen3-30b-a3b",
  "qwen3-32b":             "qwen3-235b-a22b",
  "qwen3-72b":             "qwen3-235b-a22b",
  // qwen2.5 instruct series
  "qwen2.5-7b-instruct":   "qwen3-30b-a3b",
  "qwen2.5-14b-instruct":  "qwen3-30b-a3b",
  "qwen2.5-32b-instruct":  "qwen3-235b-a22b",
  "qwen2.5-72b-instruct":  "qwen3-235b-a22b",
  // qwen2.5-coder small sizes
  "qwen2.5-coder-7b-instruct":  "qwen2.5-coder-32b-instruct",
  "qwen2.5-coder-14b-instruct": "qwen2.5-coder-32b-instruct",
  // Vision model aliases — vision is handled via OSS image upload, not model ID.
  // Map all VL/vision model IDs to working chat.qwen.ai text models.
  "qwen-vl-max":            "qwen3.7-max",
  "qwen-vl-max-latest":     "qwen3.7-max",
  "qwen-vl":                "qwen3.7-max",
  "qwen-vl-plus":           "qwen3.6-plus",
  "qwen2-vl-7b-instruct":   "qwen3-30b-a3b",
  "qwen2-vl-72b-instruct":  "qwen3-235b-a22b",
  "qwen2.5-vl":             "qwen3-235b-a22b",
  "qwen2.5-vl-7b-instruct": "qwen3-30b-a3b",
  "qwen2.5-vl-72b-instruct": "qwen3-235b-a22b",
  "qwen2.5-vl-max":         "qwen3.7-max",
};

function resolveModel(m: string): string {
  return MODEL_ALIASES[m] ?? m;
}

/** True if the model natively supports vision input. */
function isVisionModel(model: string): boolean {
  return model.includes("vl") || model.includes("vision");
}

// ── POST /v1/chat/completions ────────────────────────────────────────────────

router.post("/chat/completions", requireApiKey, async (req, res) => {
  const reqStart = Date.now();
  const reqId = `v1-${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  const {
    model: _rawModel = "qwen3-235b-a22b",
    messages,
    tools,
    tool_choice: _toolChoice,
    temperature: _temp,
    max_tokens: _max,
    stream = false,
    stream_options,
    response_format,
    stop: _stop,
    n: _n,
    top_p: _topP,
    presence_penalty: _pp,
    frequency_penalty: _fp,
    seed: _seed,
    logprobs: _logprobs,
    top_logprobs: _topLogprobs,
  } = req.body as {
    model?: string;
    messages?: Message[];
    tools?: Tool[];
    tool_choice?: "none" | "auto" | "required" | { type: string; function?: { name: string } };
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    stream_options?: { include_usage?: boolean };
    response_format?: { type?: "text" | "json_object" };
    stop?: string | string[] | null;
    n?: number;
    top_p?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    seed?: number;
    logprobs?: boolean | null;
    top_logprobs?: number | null;
  };

  const model = resolveModel(_rawModel);

  const temperature = typeof _temp === "number"
    ? Math.max(0, Math.min(2, _temp))
    : 0.7;

  const includeUsage = stream_options?.include_usage === true;
  const jsonMode = response_format?.type === "json_object";

  res.on("finish", () => {
    recordRequest({
      id: reqId,
      success: res.statusCode < 400,
      statusCode: res.statusCode,
      requestedAt: new Date(reqStart).toISOString(),
      responseTime: Date.now() - reqStart,
      endpoint: "v1/chat/completions",
      method: "POST",
      model,
      requestPayload: { model, messages: messages?.slice(0, 3) },
      responseBody: null,
      responseHeaders: {},
      error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
    });
  });

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      error: {
        message: "messages is required and must be a non-empty array",
        type: "invalid_request_error",
        param: "messages",
        code: "missing_messages",
      },
    });
    return;
  }

  // Detect images across all messages
  const allImageUrls = collectAllImages(messages);
  const hasImages = allImageUrls.length > 0;

  const effectiveModel = model;

  const hasTools = Array.isArray(tools) && tools.length > 0 && _toolChoice !== "none";

  let effectiveMessages = messages;
  if (hasTools) effectiveMessages = injectToolPrompt(effectiveMessages, tools!, _toolChoice);
  if (jsonMode && !hasTools) effectiveMessages = injectJsonMode(effectiveMessages);

  const id = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 29)}`;
  const created = Math.floor(Date.now() / 1000);

  // ── SSE helpers ─────────────────────────────────────────────────────────
  function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
    const payload = {
      id,
      object: "chat.completion.chunk",
      created,
      model: _rawModel,
      service_tier: "default",
      system_fingerprint: "fp_qwen_gateway",
      choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    };
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  function sseUsageChunk(inputTokens: number, outputTokens: number): string {
    const payload = {
      id,
      object: "chat.completion.chunk",
      created,
      model: _rawModel,
      service_tier: "default",
      system_fingerprint: "fp_qwen_gateway",
      choices: [],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
      },
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
    // ── ARIA provider path ───────────────────────────────────────────────────
    if (model === "aria") {
      const query = messagesToPrompt(effectiveMessages);

      if (stream) {
        startSSE();
        res.write(sseChunk({ role: "assistant", content: "" }));

        const proc = await ariaChatStream(query);
        let buf = "";

        await new Promise<void>((resolve, reject) => {
          proc.stdout!.on("data", (chunk: Buffer) => {
            buf += chunk.toString("utf8");
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const text = parseAriaSSELine(line);
              if (text) res.write(sseChunk({ content: text }));
            }
          });
          proc.stdout!.on("end", resolve);
          proc.on("error", reject);
        });

        res.write(sseChunk({}, "stop"));
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const { content, inputTokens, outputTokens } = await ariaChat(query);
      if (!content) {
        res.status(502).json({
          error: { message: "No response from Aria", type: "upstream_error", code: "empty_response" },
        });
        return;
      }

      res.json({
        id,
        object: "chat.completion",
        created,
        model: _rawModel,
        service_tier: "default",
        system_fingerprint: "fp_aria_gateway",
        choices: [{
          index: 0,
          message: { role: "assistant", refusal: null, content },
          logprobs: null,
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
          prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
        },
      });
      return;
    }

    // ── QWEN provider path ───────────────────────────────────────────────────
    const midtoken = await getMidtoken();
    const headers = qwenHeaders(midtoken);

    // For vision requests, get acw_tc cookie (required by getstsToken upload endpoint)
    let resolvedFiles: QwenFileDescriptor[] = [];
    if (hasImages) {
      const cookie = await getQwenCookies(midtoken);
      const uploadHeaders = { ...headers, Cookie: cookie };
      resolvedFiles = await resolveImageUrls(allImageUrls, uploadHeaders);
    }

    const chatId = await createQwenChat(headers, effectiveModel);

    // Build the prompt; strip image notes when images are handled natively via files[]
    const userPrompt = messagesToPrompt(effectiveMessages, resolvedFiles.length > 0);

    const r2 = await fetch(`${QWEN_BASE}/chat/completions?chat_id=${chatId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        stream: true, incremental_output: true, chat_id: chatId, chat_mode: "normal",
        model: effectiveModel,
        temperature,
        parent_id: null,
        messages: [{
          fid: randomUUID(), parentId: null, childrenIds: [], role: "user",
          content: userPrompt, user_action: "chat",
          files: resolvedFiles,
          models: [effectiveModel],
          chat_type: "t2t",
          feature_config: { thinking_enabled: false, output_schema: "phase", thinking_budget: 81920 },
          sub_chat_type: "t2t",
        }],
      }),
    });

    // ── STREAMING path ──────────────────────────────────────────────────────
    if (stream) {
      startSSE();

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
          res.write(sseChunk({ role: "assistant", content: null }));
          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            res.write(sseChunk({
              tool_calls: [{
                index: i, id: tc.id, type: "function",
                function: { name: tc.function.name, arguments: "" },
              }],
            }));
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
          res.write(sseChunk({ role: "assistant", content: "" }));
          const words = content.split(/(\s+)/);
          for (const word of words) {
            if (word) res.write(sseChunk({ content: word }));
          }
          res.write(sseChunk({}, "stop"));
        }

        if (includeUsage) res.write(sseUsageChunk(inputTokens, outputTokens));
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      if (!r2.body) {
        res.write(`data: ${JSON.stringify({ error: "No response body" })}\n\ndata: [DONE]\n\n`);
        res.end();
        return;
      }

      res.write(sseChunk({ role: "assistant", content: "" }));

      const reader = (r2.body as unknown as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } }).getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let ssInputTokens = 0;
      let ssOutputTokens = 0;

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
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            if (chunk.usage) {
              ssInputTokens = chunk.usage.input_tokens ?? ssInputTokens;
              ssOutputTokens = chunk.usage.output_tokens ?? ssOutputTokens;
            }
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
      if (includeUsage) res.write(sseUsageChunk(ssInputTokens, ssOutputTokens));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ── NON-STREAMING path ───────────────────────────────────────────────────
    const body = await r2.text();

    const { content, inputTokens, outputTokens } = parseQwenSSE(body);

    if (!content) {
      res.status(502).json({
        error: { message: "No response from model", type: "upstream_error", code: "empty_response" },
      });
      return;
    }

    const toolCalls = hasTools ? detectToolCalls(content) : null;

    const usageBlock = {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
    };

    if (toolCalls) {
      res.json({
        id,
        object: "chat.completion",
        created,
        model: _rawModel,
        service_tier: "default",
        system_fingerprint: "fp_qwen_gateway",
        choices: [{
          index: 0,
          message: { role: "assistant", refusal: null, content: null, tool_calls: toolCalls },
          logprobs: null,
          finish_reason: "tool_calls",
        }],
        usage: usageBlock,
      });
      return;
    }

    res.json({
      id,
      object: "chat.completion",
      created,
      model: _rawModel,
      service_tier: "default",
      system_fingerprint: "fp_qwen_gateway",
      choices: [{
        index: 0,
        message: { role: "assistant", refusal: null, content },
        logprobs: null,
        finish_reason: "stop",
      }],
      usage: usageBlock,
    });
  } catch (err) {
    logger.error({ err }, "v1/chat/completions error");
    if (!res.headersSent) {
      res.status(500).json({ error: { message: "Internal server error", type: "server_error", code: "internal_error" } });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Internal server error" })}\n\ndata: [DONE]\n\n`);
      res.end();
    }
  }
});

// ── GET /v1/models ───────────────────────────────────────────────────────────

router.get("/models", requireApiKey, (_req, res) => {
  res.json({ object: "list", data: MODELS });
});

// ── GET /v1/models/:model ────────────────────────────────────────────────────

router.get("/models/:model", requireApiKey, (req, res) => {
  const paramModel = String(req.params.model);
  const resolvedId = resolveModel(paramModel);
  const found = MODELS.find(m => m.id === resolvedId || m.id === paramModel);
  if (!found) {
    res.status(404).json({
      error: {
        message: `The model '${req.params.model}' does not exist`,
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });
    return;
  }
  res.json(found);
});

// ── POST /v1/completions (legacy text completions) ───────────────────────────

router.post("/completions", requireApiKey, async (req, res) => {
  const reqId = `cmpl-${randomUUID().replace(/-/g, "").slice(0, 29)}`;
  const created = Math.floor(Date.now() / 1000);

  const {
    model: _rawModel = "qwen3-235b-a22b",
    prompt,
    max_tokens,
    temperature: _temp,
    stream = false,
    suffix: _suffix,
    stop: _stop,
  } = req.body as {
    model?: string;
    prompt?: string | string[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    suffix?: string;
    stop?: string | string[];
  };

  if (!prompt) {
    res.status(400).json({
      error: {
        message: "prompt is required",
        type: "invalid_request_error",
        param: "prompt",
        code: "missing_required_parameter",
      },
    });
    return;
  }

  const promptText = Array.isArray(prompt) ? prompt.join("") : String(prompt);
  const model = resolveModel(_rawModel);
  const temperature = typeof _temp === "number" ? Math.max(0, Math.min(2, _temp)) : 0.7;

  try {
    const midtoken = await getMidtoken();
    const headers = qwenHeaders(midtoken);
    const chatId = await createQwenChat(headers, model);

    const r = await fetch(`${QWEN_BASE}/chat/completions?chat_id=${chatId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        stream: true, incremental_output: true, chat_id: chatId, chat_mode: "normal",
        model,
        temperature,
        parent_id: null,
        messages: [{
          fid: randomUUID(), parentId: null, childrenIds: [], role: "user",
          content: promptText, user_action: "chat",
          files: [],
          models: [model],
          chat_type: "t2t",
          feature_config: { thinking_enabled: false, output_schema: "phase", thinking_budget: 81920 },
          sub_chat_type: "t2t",
        }],
      }),
    });

    const rawBody = await r.text();
    const { content, inputTokens, outputTokens } = parseQwenSSE(rawBody);

    if (!content) {
      res.status(502).json({
        error: { message: "No response from model", type: "upstream_error", param: null, code: "empty_response" },
      });
      return;
    }

    const usageBlock = {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
    };

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const words = content.split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        const chunk = {
          id: reqId,
          object: "text_completion",
          created,
          model: _rawModel,
          service_tier: "default",
          system_fingerprint: "fp_qwen_gateway",
          choices: [{ text: word, index: 0, logprobs: null, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      const doneChunk = {
        id: reqId,
        object: "text_completion",
        created,
        model: _rawModel,
        service_tier: "default",
        system_fingerprint: "fp_qwen_gateway",
        choices: [{ text: "", index: 0, logprobs: null, finish_reason: "stop" }],
      };
      res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.json({
      id: reqId,
      object: "text_completion",
      created,
      model: _rawModel,
      service_tier: "default",
      system_fingerprint: "fp_qwen_gateway",
      choices: [{
        text: content,
        index: 0,
        logprobs: null,
        finish_reason: "stop",
      }],
      usage: usageBlock,
    });
  } catch (err) {
    logger.error({ err }, "v1/completions error");
    if (!res.headersSent) {
      res.status(500).json({
        error: { message: "Internal server error", type: "api_error", param: null, code: "internal_error" },
      });
    }
  }
});

// ── POST /v1/embeddings ───────────────────────────────────────────────────────

router.post("/embeddings", requireApiKey, (_req, res) => {
  res.status(400).json({
    error: {
      message: "Embeddings are not supported by this gateway. Use a dedicated embeddings provider.",
      type: "invalid_request_error",
      param: null,
      code: "unsupported_endpoint",
    },
  });
});

export default router;

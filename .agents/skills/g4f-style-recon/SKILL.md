---
name: g4f-style-recon
description: Metodologi reverse-engineering website AI seperti gpt4free — untuk menemukan endpoint API tersembunyi, bypass auth, dan mengintegrasikan provider AI gratis tanpa API key resmi. Gunakan ketika user ingin "test web AI ini", "coba reverse engineer", "cari endpoint gratis", atau membangun provider AI baru.
---

# G4F-Style AI Website Recon

Metodologi ini terinspirasi dari [gpt4free](https://github.com/xtekky/gpt4free) — project Python yang mengumpulkan endpoint AI gratis dari berbagai website dengan cara merekayasa balik request browser mereka.

## ⚠️ ATURAN WAJIB — Standar "Setara OpenAI untuk AI Agent Otonom"

Setiap provider yang diimplementasikan **WAJIB** mendukung seluruh fitur berikut agar setara dengan OpenAI resmi dan kompatibel dengan AI agent otonom (Manus, AutoGPT, CrewAI, LangChain, dll):

| Fitur | Wajib | Keterangan |
|---|---|---|
| **Streaming SSE** | ✅ WAJIB | `stream: true` kirim SSE chunks OpenAI-format |
| **Non-streaming** | ✅ WAJIB | `stream: false` return JSON lengkap |
| **Tool / Function calling** | ✅ WAJIB | Deteksi JSON `{"tool_calls":[...]}` dari output model via `detectToolCalls()` |
| **Multi-tool parallel** | ✅ WAJIB | Satu response bisa return lebih dari 1 tool call |
| **Tool results loop** | ✅ WAJIB | `role: "tool"` di messages harus di-handle di `messagesToPrompt()` |
| **Vision / Image** | ✅ WAJIB | Kalau provider native support → kirim langsung. Kalau tidak → pakai `flattenVisionMessages()` sebagai fallback via Qwen |
| **System prompt** | ✅ WAJIB | |
| **JSON mode** | ✅ WAJIB | `response_format: {type: "json_object"}` inject instruksi JSON ke system |
| **`finish_reason`** | ✅ WAJIB | `"stop"`, `"length"`, `"tool_calls"` |
| **Token usage** | ✅ WAJIB | `prompt_tokens`, `completion_tokens`, `total_tokens` (estimasi boleh) |
| **`max_tokens` + `max_completion_tokens`** | ✅ WAJIB | Support keduanya |
| **`stop` sequences** | ✅ WAJIB | Post-process via `applyStop()` |
| **`temperature`, `top_p`** | ✅ WAJIB | Kirim ke provider kalau didukung, ignore kalau tidak |
| **`stream_options.include_usage`** | ✅ WAJIB | Kirim usage chunk di akhir SSE kalau diminta |
| **Model capabilities metadata** | ✅ WAJIB | Entry di `MODELS[]` dengan `capabilities: {vision, tools, json_mode, streaming}` dan `context_window` |

**TIDAK BOLEH** menambah provider yang hanya support chat biasa tanpa tool calling dan streaming — itu tidak berguna untuk AI agent otonom.

---

## Alur Kerja (Urutan Wajib)

### FASE 1 — Profiling Website

```bash
# 1. Cek headers & cookies website
curl -s -I "https://target.ai/" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36" \
  --max-time 10

# 2. Probe endpoint umum sekaligus
for ep in "/v1/models" "/api/models" "/api/v1/models" "/api/config" \
          "/v1/chat/completions" "/api/chat/completions" "/auth/login" \
          "/api/v1/auths/" "/openai/v1/chat/completions"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://target.ai$ep" \
    -H "User-Agent: Mozilla/5.0 Chrome/138.0.0.0" --max-time 8 2>/dev/null)
  echo "$code  $ep"
done
```

**Interpretasi kode HTTP:**
- `200` = endpoint terbuka, test langsung
- `401` = endpoint ada, butuh auth — cari cara dapat token
- `403` = ada tapi blocked — coba bypass header
- `404` = tidak ada di path ini — coba variasi lain
- `405` = Method Not Allowed — coba method berbeda (GET/POST)
- `307/302` = redirect — follow redirectnya

### FASE 2 — Ekstrak Endpoint dari Source JS

```bash
# Ambil HTML dan cari file JS bundle utama
curl -s "https://target.ai/" | grep -oE 'src="[^"]+\.js"' | head -5

# Download JS bundle dan cari pattern endpoint
JS_URL="https://cdn.target.ai/assets/index-XXXX.js"
curl -s "$JS_URL" --max-time 30 | grep -oE '"(/api[^"]{0,80})"' | sort -u | head -30

# Cari fetch() calls dengan endpoint
curl -s "$JS_URL" --max-time 30 | grep -oE 'fetch\(`[^`]{0,100}`' | head -20

# Cari pola chat/completions
curl -s "$JS_URL" --max-time 30 | grep -oE '\$\{[a-zA-Z_]+\}/[a-z/]+completions' | head -10

# Cari base URL variable (biasanya: WEBUI_BASE_URL, apiUrl, baseUrl, dll)
curl -s "$JS_URL" --max-time 30 | grep -oE 'WEBUI_BASE_URL[^,;]{0,100}' | head -5
```

### FASE 3 — Cari Mekanisme Auth

**Pola auth yang umum ditemukan:**

#### A. Guest/Anonymous Token (paling bagus — tanpa registrasi)
```bash
# Open WebUI style — GET auth endpoint auto-buat guest account
curl -s "https://target.ai/api/v1/auths/" \
  -H "User-Agent: Mozilla/5.0 Chrome/138.0.0.0" \
  -H "Accept: application/json"
# Kalau dapat token → langsung pakai sebagai Bearer token
```

#### B. Login Email/Password
```bash
curl -s -X POST "https://target.ai/api/v1/auths/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
```

#### C. Cookie-Based (browser session)
```bash
# Simpan cookie dari login
curl -s -c /tmp/cookies.txt "https://target.ai/login" \
  -H "User-Agent: Mozilla/5.0 Chrome/138.0.0.0"
# Gunakan cookie untuk request berikutnya
curl -s -b /tmp/cookies.txt "https://target.ai/api/chat/completions" ...
```

#### D. Tanpa Auth Sama Sekali (Perplexity, PollinationsAI style)
```bash
# Langsung test endpoint dengan Chrome headers lengkap + TLS 1.3
curl -s -X POST "https://target.ai/api/endpoint" \
  --tlsv1.3 \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36" \
  -H "Origin: https://target.ai" \
  -H "Referer: https://target.ai/" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"...":"..."}'
```

### FASE 4 — Test Chat Completion

Setelah dapat token/cookie:

```bash
TOKEN="..."

# Non-streaming test
curl -s -X POST "https://target.ai/ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 Chrome/138.0.0.0" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"say hi in one sentence"}],"stream":false}' \
  --max-time 30

# Streaming test
curl -s -X POST "https://target.ai/ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"say hi"}],"stream":true}' \
  --max-time 30 | head -50
```

### FASE 5 — Test Tool Calling

Provider wajib support tool calling. Kalau native tidak support, pakai prompt injection + `detectToolCalls()` (lihat implementasi di `v1.ts` → `injectToolPrompt()`):

```bash
# Test apakah provider bisa return JSON tool call format
TOKEN="..."
curl -s -X POST "https://target.ai/ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"MODEL_ID",
    "messages":[{"role":"user","content":"What is the weather in Jakarta? You must call the get_weather tool.\n\n{\"tool_calls\":[{\"name\":\"get_weather\",\"arguments\":{\"location\":\"Jakarta\"}}]}"}],
    "stream":false
  }' --max-time 30
# Kalau model return format {"tool_calls":[...]} → native tool calling bisa dipakai
# Kalau tidak → pakai injectToolPrompt() + detectToolCalls() (prompt injection)
```

### FASE 6 — Identifikasi Format Response & Vision Support

**Format SSE (Server-Sent Events) — paling umum untuk streaming:**
```
event: message
data: {"choices":[{"delta":{"content":"Hello"}}]}

event: message
data: [DONE]
```

**Format OpenAI-compatible (paling mudah):**
```json
{"choices":[{"message":{"role":"assistant","content":"Hello!"}}]}
```

**Format custom (contoh Perplexity):**
```json
{"blocks":[{"diff_block":{"field":"markdown_block","patches":[{"value":{"answer":"Hello..."}}]}}]}
```

**Cek apakah provider support vision (kirim image_url):**
```bash
curl -s -X POST "https://target.ai/ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":[
    {"type":"text","text":"What is in this image?"},
    {"type":"image_url","image_url":{"url":"https://picsum.photos/200"}}
  ]}],"stream":false}' --max-time 30
# 200 dengan konten = native vision support
# Error/ignored = tidak support → wajib pakai flattenVisionMessages() fallback
```

---

## Checklist Perlindungan yang Sering Ditemui

| Proteksi | Cara Bypass |
|---|---|
| Cloudflare | Pakai `--tlsv1.3` + Chrome User-Agent |
| Captcha signup | Cari endpoint guest/anonymous tanpa captcha |
| `X-Signature` / HMAC | Reverse-engineer dari JS bundle |
| Rate limiting | Rotasi UUID/session per request |
| IP block | Tidak bisa bypass dari server |
| Token expiry | Re-fetch token tiap request atau cache TTL pendek |
| Hotlink protection gambar | Gunakan curl dengan Referer + Chrome UA (sudah handled di `fetchImageBytes()`) |

---

## Provider yang Sudah Terimplementasi

### 1. Qwen (Provider Utama — Native Vision)
- **File:** `artifacts/api-server/src/lib/umid-pool.ts` + logic di `v1.ts`
- **Auth:** Pool 2000 `bx-umidtoken` (rotasi round-robin), auto-refresh
- **Vision:** ✅ Native — upload ke Qwen OSS via STS token + HMAC-SHA1, semua model Qwen support
- **Image fetch:** `fetchImageBytes()` di `v1.ts` — pakai Node.js fetch dulu, fallback ke curl untuk hotlink-protected URL (Wikipedia, Cloudflare, dll)
- **Tools:** ✅ Via prompt injection `injectToolPrompt()` + `detectToolCalls()`
- **Streaming:** ✅ Native SSE dari chat.qwen.ai, parse `output_schema: "answer"` chunks
- **Models:** `qwen3.7-max`, `qwen3.6-plus`, `qwen3.6-max-preview`, `qwen3-235b-a22b`, `qwen3-30b-a3b`, `qwen-max-latest`, `qwen-turbo-latest`, `qwen2.5-coder-32b-instruct`, `qwen-vl-max-latest`, `qwen2.5-vl-72b-instruct`
- **Catatan:** Model alias panjang di `MODEL_ALIASES{}` — hampir semua nama model OpenAI/Qwen di-map ke model yang tersedia

### 2. Opera Aria
- **File:** `artifacts/api-server/src/lib/aria-provider.ts`
- **Auth:** 2 tahap — step 1 dapat `authToken`, step 2 tukar ke `access_token`. **KRITIS: step 2 HARUS tanpa User-Agent header**
- **Vision:** ⚡ Fallback — gambar dianalisis Qwen dulu via `flattenVisionMessages()`, hasilnya dikirim sebagai teks
- **Tools:** ✅ Via prompt injection
- **Streaming:** ✅ Via `execSync` curl (bukan Node.js fetch) karena masalah TLS fingerprint
- **Model ID:** `aria`

### 3. Yqcloud
- **File:** `artifacts/api-server/src/lib/yqcloud-provider.ts`
- **Auth:** Tidak perlu — pool 200 `userId` UUID rotasi round-robin
- **Endpoint:** `POST https://api.binjie.fun/api/generateStream`
- **Vision:** ⚡ Fallback via `flattenVisionMessages()`
- **Tools:** ✅ Via prompt injection
- **Streaming:** ✅ Response body adalah plain text stream (bukan SSE), langsung pipe
- **Models:** `yqcloud`, `yqcloud-gpt4`

### 4. Cohere (via HuggingFace Space)
- **File:** `artifacts/api-server/src/lib/cohere-provider.ts`
- **Auth:** Tidak perlu — HuggingFace public space. Pool 10 conversation slot per model, rotasi untuk spread rate limit
- **Endpoint:** `https://coherelabs-c4ai-command.hf.space`
- **Vision:** ⚡ Fallback via `flattenVisionMessages()`
- **Tools:** ✅ Via prompt injection
- **Streaming:** ✅ Via async generator, parse `{type:"stream", token:"..."}` chunks
- **Models:** `command-a`, `command-a-03-2025`, `command-r-plus`, `command-r`, `command-r7b`

---

## Template Implementasi Provider Lengkap (Node.js/TypeScript)

Gunakan template ini sebagai dasar setiap provider baru. **Semua bagian wajib diisi.**

```typescript
// artifacts/api-server/src/lib/{nama}-provider.ts

import { execSync } from "child_process";
import { logger } from "./logger";

export interface ChatMessage { role: string; content: string; }

// ── Token cache ───────────────────────────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const resp = await fetch("https://target.ai/api/v1/auths/", {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/138.0.0.0" }
  });
  const data = await resp.json() as { token: string };
  cachedToken = data.token;
  tokenExpiry = Date.now() + 3600_000; // 1 jam
  return cachedToken!;
}

// ── Streaming (AsyncGenerator — wajib) ───────────────────────────────────────
export async function* streamProvider(
  messages: ChatMessage[],
  model: string = "default-model",
): AsyncGenerator<string> {
  const token = await getToken();
  const body = JSON.stringify({ model, messages, stream: true });

  // Gunakan curl untuk bypass TLS fingerprint
  const raw = execSync(
    `curl -sN -X POST "https://target.ai/v1/chat/completions" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -H "User-Agent: Mozilla/5.0 Chrome/138.0.0.0" \
      --tlsv1.2 --max-time 120 \
      -d '${body.replace(/'/g, "'\\''")}'`,
    { maxBuffer: 20 * 1024 * 1024 },
  ).toString();

  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") break;
    try {
      const json = JSON.parse(data);
      // Sesuaikan dengan format response provider
      const content = json.choices?.[0]?.delta?.content ?? "";
      if (content) yield content;
    } catch { /* skip malformed */ }
  }
}

// ── Non-streaming (wajib) ─────────────────────────────────────────────────────
export async function chatProvider(
  messages: ChatMessage[],
  model: string = "default-model",
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  let content = "";
  for await (const token of streamProvider(messages, model)) {
    content += token;
  }
  return {
    content: content.trim(),
    inputTokens: Math.round(messages.map(m => m.content).join("").length / 4),
    outputTokens: Math.round(content.length / 4),
  };
}

// ── Model list (wajib) ────────────────────────────────────────────────────────
export const PROVIDER_MODELS = [
  { id: "provider-model-1", object: "model", created: 1700000000, owned_by: "provider" },
  { id: "provider-model-2", object: "model", created: 1700000000, owned_by: "provider" },
];

export function isProviderModel(model: string): boolean {
  return PROVIDER_MODELS.some(m => m.id === model);
}
```

---

## Cara Integrasi ke v1.ts (Wajib Ikuti Pola Ini)

Setelah provider selesai, integrasi ke `artifacts/api-server/src/routes/v1.ts`:

### 1. Import di atas file
```typescript
import { chatProvider, streamProvider, isProviderModel, PROVIDER_MODELS } from "../lib/nama-provider";
```

### 2. Tambah ke MODELS[] dengan capabilities (wajib)
```typescript
const MODELS: ModelEntry[] = [
  // ... provider lain ...
  ...PROVIDER_MODELS.map(m => ({
    ...m,
    capabilities: {
      vision: false,    // true kalau native vision, false kalau hanya fallback
      tools: true,      // selalu true (via prompt injection)
      json_mode: false, // true kalau reliable
      streaming: true,  // selalu true
    },
    context_window: 32768,  // sesuaikan dengan limit provider
  })),
];
```

### 3. Tambah route di chat/completions (ikuti pola provider yang ada)
```typescript
// Di bagian try{} di router.post("/chat/completions", ...)
// Letakkan SEBELUM blok Qwen provider

if (isProviderModel(model)) {
  // Vision fallback — wajib untuk semua provider yang tidak support native vision
  const provEffective = hasImages ? await flattenVisionMessages(effectiveMessages) : effectiveMessages;
  const provMessages = provEffective.map(m => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : getMessageText(m.content),
  }));

  if (stream) {
    startSSE();
    res.write(sseChunk({ role: "assistant", content: "" }));
    const maxChars = _max ? _max * 4 : Infinity;
    let charCount = 0;
    let lengthStop = false;

    try {
      for await (const token of streamProvider(provMessages, model)) {
        if (!token || lengthStop) continue;
        let t = token;
        if (charCount + t.length > maxChars) { t = t.slice(0, maxChars - charCount); lengthStop = true; }
        charCount += t.length;
        if (t) res.write(sseChunk({ content: t }));
      }
    } catch (err) { logger.warn({ err }, "provider: stream error"); }

    const streamFinish = lengthStop ? "length" : "stop";
    if (includeUsage) {
      const promptEst = estimateTokens(messagesToPrompt(provMessages));
      res.write(sseUsageChunk(promptEst, Math.round(charCount / 4)));
    }
    res.write(sseChunk({}, streamFinish));
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const { content: raw, inputTokens, outputTokens } = await chatProvider(provMessages, model);
  if (!raw) {
    res.status(502).json({ error: { message: "No response from provider", type: "upstream_error", code: "empty_response" } });
    return;
  }
  const mt = applyMaxTokens(raw, _max);
  const st = applyStop(mt.content, _stop);
  const finalContent = st.content;
  const finish = (mt.truncated || st.truncated) ? "length" : "stop";
  const promptTokens = estimateTokens(messagesToPrompt(provMessages));
  const compTokens = estimateTokens(finalContent);

  // Tool call detection (wajib)
  const toolCalls = hasTools ? detectToolCalls(finalContent) : null;
  if (toolCalls) {
    res.json({ id, object: "chat.completion", created, model: _rawModel, service_tier: "default",
      system_fingerprint: "fp_provider_gateway",
      choices: [{ index: 0, message: { role: "assistant", refusal: null, content: null, tool_calls: toolCalls }, logprobs: null, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: promptTokens, completion_tokens: compTokens, total_tokens: promptTokens + compTokens } });
    return;
  }
  res.json({ id, object: "chat.completion", created, model: _rawModel, service_tier: "default",
    system_fingerprint: "fp_provider_gateway",
    choices: [{ index: 0, message: { role: "assistant", refusal: null, content: finalContent }, logprobs: null, finish_reason: finish }],
    usage: { prompt_tokens: promptTokens, completion_tokens: compTokens, total_tokens: promptTokens + compTokens } });
  return;
}
```

---

## Checklist Sebelum Provider Dianggap Selesai

Sebelum commit, pastikan semua ini sudah ditest:

```bash
APIKEY="sk-..."

# 1. Non-streaming basic
curl -s -X POST http://localhost:5000/v1/chat/completions \
  -H "Authorization: Bearer $APIKEY" -H "Content-Type: application/json" \
  -d '{"model":"NAMA_MODEL","stream":false,"messages":[{"role":"user","content":"say hi"}]}'

# 2. Streaming
curl -s -X POST http://localhost:5000/v1/chat/completions \
  -H "Authorization: Bearer $APIKEY" -H "Content-Type: application/json" \
  -d '{"model":"NAMA_MODEL","stream":true,"messages":[{"role":"user","content":"say hi"}]}' | head -10

# 3. Tool calling
curl -s -X POST http://localhost:5000/v1/chat/completions \
  -H "Authorization: Bearer $APIKEY" -H "Content-Type: application/json" \
  -d '{"model":"NAMA_MODEL","stream":false,"messages":[{"role":"user","content":"get weather jakarta"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"location":{"type":"string"}}}}}]}'

# 4. Vision (image URL publik)
curl -s -X POST http://localhost:5000/v1/chat/completions \
  -H "Authorization: Bearer $APIKEY" -H "Content-Type: application/json" \
  -d '{"model":"NAMA_MODEL","stream":false,"messages":[{"role":"user","content":[{"type":"text","text":"What is in this image?"},{"type":"image_url","image_url":{"url":"https://picsum.photos/200"}}]}]}'

# 5. Vision (URL hotlink-protected — wajib test ini)
curl -s -X POST http://localhost:5000/v1/chat/completions \
  -H "Authorization: Bearer $APIKEY" -H "Content-Type: application/json" \
  -d '{"model":"NAMA_MODEL","stream":false,"messages":[{"role":"user","content":[{"type":"text","text":"What animal?"},{"type":"image_url","image_url":{"url":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/481px-Cat03.jpg"}}]}]}'

# 6. Model ada di list dengan capabilities
curl -s http://localhost:5000/v1/models \
  -H "Authorization: Bearer $APIKEY" | grep -A5 "NAMA_MODEL"
```

---

## Contoh Nyata — Recon & Status

### Perplexity AI (belum diimplementasi)
```bash
# Endpoint: POST https://www.perplexity.ai/rest/sse/perplexity_ask
# KRITIS: underscore (_), bukan hyphen (-)
curl -s -X POST "https://www.perplexity.ai/rest/sse/perplexity_ask" \
  --tlsv1.3 \
  -H "accept: text/event-stream" \
  -H "content-type: application/json" \
  -H "origin: https://www.perplexity.ai" \
  -H "referer: https://www.perplexity.ai/" \
  -H "user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36" \
  -H "x-perplexity-request-reason: perplexity-query-state-provider" \
  -H "x-request-id: $(cat /proc/sys/kernel/random/uuid)" \
  -d '{
    "params": {
      "attachments": [], "language": "en-US", "timezone": "America/Los_Angeles",
      "search_focus": "internet", "sources": ["web"],
      "frontend_uuid": "UUID-DISINI", "mode": "copilot",
      "model_preference": "turbo", "is_related_query": false,
      "frontend_context_uuid": "CTX-UUID-DISINI",
      "prompt_source": "user", "query_source": "home",
      "use_schematized_api": true, "send_back_text_in_streaming_api": false,
      "dsl_query": "PERTANYAAN_DISINI", "version": "2.18"
    },
    "query_str": "PERTANYAAN_DISINI"
  }' --max-time 30
```
**Parse response (Node.js):**
```javascript
// blocks[].diff_block.patches[].value.answer — atau streaming: patches[].value (string)
// "text_completed": true menandai akhir respons utama
```

### PollinationsAI (belum diimplementasi)
```bash
curl -s -X POST "https://text.pollinations.ai/openai" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai","messages":[{"role":"user","content":"say hi"}],"stream":false}'
# Atau: https://gen.pollinations.ai/v1/chat/completions (OpenAI-compatible langsung)
# Models: openai, openai-fast, deepseek, mistral-small, llamascout, dll
```

### Z.ai / chat.z.ai (GLM-5.1 — blocked, butuh X-Signature)
```bash
# Guest token gratis
curl -s "https://chat.z.ai/api/v1/auths/" \
  -H "User-Agent: Mozilla/5.0 Chrome/138.0.0.0" -H "Accept: application/json"
# Response: {"token":"eyJ...","role":"guest","email":"guest-{timestamp}@guest.com"}
# ⚠️ Chat DIBLOKIR untuk guest — /openai/v1/chat/completions butuh X-Signature (HMAC)
# Status: Perlu reverse-engineer signature algorithm dari JS bundle untuk bypass
```

---

## Tips Penting

1. **Selalu gunakan Node.js 20+ untuk `crypto.randomUUID()`** — dibutuhkan untuk generate UUID session
2. **Cache token dengan TTL** — jangan fetch ulang tiap request, gunakan TTL ~1 jam
3. **Gunakan `execSync` curl bukan `fetch`** — untuk provider yang memerlukan TLS fingerprint Chrome
4. **Parse SSE dengan hati-hati** — beberapa provider kirim format non-standar
5. **Test dulu dengan curl** sebelum implement di TypeScript — lebih cepat iterasi
6. **Perhatikan header `x-process-time: 0`** — berarti 404 dari CDN/nginx, bukan dari app backend
7. **Model ID bisa berbeda** dari nama yang ditampilkan di UI — selalu ambil dari `/api/models`
8. **Vision fallback via `flattenVisionMessages()`** sudah ada di `v1.ts` — tinggal panggil sebelum kirim ke provider yang tidak support native vision
9. **Tool calling via prompt injection** sudah ada di `injectToolPrompt()` dan `detectToolCalls()` di `v1.ts` — tidak perlu implement ulang

## Referensi

- gpt4free repo: https://github.com/xtekky/gpt4free
- Implementasi Perplexity: `g4f/Provider/Perplexity.py`
- Implementasi PollinationsAI: `g4f/Provider/PollinationsAI.py`
- Implementasi OperaAria: `g4f/Provider/OperaAria.py`
- Standard OpenAI API reference: https://platform.openai.com/docs/api-reference/chat

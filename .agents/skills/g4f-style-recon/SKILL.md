---
name: g4f-style-recon
description: Metodologi reverse-engineering website AI seperti gpt4free — untuk menemukan endpoint API tersembunyi, bypass auth, dan mengintegrasikan provider AI gratis tanpa API key resmi. Gunakan ketika user ingin "test web AI ini", "coba reverse engineer", "cari endpoint gratis", atau membangun provider AI baru.
---

# G4F-Style AI Website Recon

Metodologi ini terinspirasi dari [gpt4free](https://github.com/xtekky/gpt4free) — project Python yang mengumpulkan endpoint AI gratis dari berbagai website dengan cara merekayasa balik request browser mereka.

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

### FASE 5 — Identifikasi Format Response

**Format SSE (Server-Sent Events) — paling umum untuk streaming:**
```
event: message
data: {"choices":[{"delta":{"content":"Hello"}}]}

event: message
data: [DONE]
```

**Format custom (contoh Perplexity):**
```json
{"blocks":[{"diff_block":{"field":"markdown_block","patches":[{"value":{"answer":"Hello..."}}]}}]}
```

**Format OpenAI-compatible (paling mudah):**
```json
{"choices":[{"message":{"role":"assistant","content":"Hello!"}}]}
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
| Token expiry | Re-fetch token tiap request atau cache |

---

## Contoh Nyata yang Sudah Terbukti Berhasil

### 1. Perplexity AI (tanpa API key)
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

**Parse response Perplexity (Node.js):**
```javascript
// Cari blok dengan field "markdown_block" dan "answer"
// Data ada di: blocks[].diff_block.patches[].value.answer
// Atau streaming: blocks[].diff_block.patches[].value (string langsung)
// Field "text_completed": true menandai akhir respons utama
```

### 2. PollinationsAI (tanpa API key, OpenAI-compatible)
```bash
curl -s -X POST "https://text.pollinations.ai/openai" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai","messages":[{"role":"user","content":"say hi"}],"stream":false}'
# Model tersedia: openai, openai-fast, deepseek, mistral-small, llamascout, dll
# Atau: https://gen.pollinations.ai/v1/chat/completions (sama persis format OpenAI)
```

### 3. Opera Aria (tanpa API key)
- Auth 2 tahap: step 1 dapat `authToken`, step 2 tukar ke `access_token`
- Step 2 HARUS tanpa User-Agent header (kalau ada → gagal)
- Gunakan `child_process.execSync` curl bukan Node.js fetch (masalah TLS)
- Lihat file: `artifacts/api-server/src/lib/aria-provider.ts` untuk implementasi lengkap

### 4. Z.ai / chat.z.ai (GLM-5.1, Open WebUI)
```bash
# Guest token gratis — GET ke endpoint ini
curl -s "https://chat.z.ai/api/v1/auths/" \
  -H "User-Agent: Mozilla/5.0 Chrome/138.0.0.0" -H "Accept: application/json"
# Response: {"token":"eyJ...","role":"guest","email":"guest-{timestamp}@guest.com"}

# List model (dengan token)
curl -s "https://chat.z.ai/api/models" -H "Authorization: Bearer TOKEN"
# Model tersedia: GLM-5.1, GLM-5-Turbo, GLM-5V-Turbo, glm-4.7, Z1-Rumination, dll

# ⚠️ Chat completions DIBLOKIR untuk guest — endpoint /openai/v1/chat/completions
# memerlukan X-Signature (HMAC) yang di-generate di frontend JS
# Status: Perlu reverse-engineer signature algorithm untuk bypass
```

---

## Template Implementasi Provider (Node.js/TypeScript)

Setelah berhasil menemukan endpoint, buat provider di project:

```typescript
// artifacts/api-server/src/lib/{nama}-provider.ts

import { execSync } from "child_process";

interface ChatMessage { role: string; content: string; }

export async function* streamProvider(
  messages: ChatMessage[],
  model: string = "default"
): AsyncGenerator<string> {
  const TOKEN = await getToken(); // cache token, re-fetch kalau expired
  
  // Build request
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    // ... field spesifik provider
  });

  // Gunakan curl untuk bypass TLS fingerprint (penting untuk beberapa provider)
  const cmd = [
    "curl", "-s", "-X", "POST", "ENDPOINT_URL",
    "-H", `Authorization: Bearer ${TOKEN}`,
    "-H", "Content-Type: application/json",
    "-H", "User-Agent: Mozilla/5.0 Chrome/138.0.0.0",
    "--tlsv1.3",
    "-d", body,
    "--max-time", "60"
  ];

  const result = execSync(cmd.join(" "), { maxBuffer: 10 * 1024 * 1024 });
  const lines = result.toString().split("\n");

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") break;
    
    try {
      const json = JSON.parse(data);
      // Parse sesuai format response provider
      const content = json.choices?.[0]?.delta?.content;
      if (content) yield content;
    } catch {}
  }
}

// Cache token agar tidak fetch ulang tiap request
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
  return cachedToken;
}
```

---

## Integrasi ke Route OpenAI-Compatible

Setelah provider jadi, tambahkan ke `/v1/chat/completions`:

```typescript
// Di artifacts/api-server/src/routes/v1.ts
// Tambahkan case baru di bagian switch(model):

if (model.startsWith("perplexity") || model === "pplx") {
  // Route ke perplexity provider
} else if (model.startsWith("pollinations") || model === "glm") {
  // Route ke pollinations/glm provider
}
```

---

## Tips Penting

1. **Selalu gunakan Node.js 20+ untuk `crypto.randomUUID()`** — dibutuhkan untuk generate UUID session
2. **Cache token** — jangan fetch ulang tiap request, gunakan TTL ~1 jam
3. **Gunakan `execSync` curl bukan `fetch`** — untuk provider yang memerlukan TLS fingerprint Chrome (curl punya lebih banyak opsi TLS)
4. **Parse SSE dengan hati-hati** — beberapa provider kirim format non-standar
5. **Test dulu dengan curl** sebelum implement di TypeScript — lebih cepat iterasi
6. **Perhatikan header `x-process-time: 0`** — berarti 404 dari CDN/nginx, bukan dari app backend
7. **Model ID bisa berbeda** dari nama yang ditampilkan di UI — selalu ambil dari `/api/models`

## Referensi

- gpt4free repo: https://github.com/xtekky/gpt4free
- Implementasi Perplexity: `g4f/Provider/Perplexity.py`
- Implementasi PollinationsAI: `g4f/Provider/PollinationsAI.py`
- Implementasi OperaAria: `g4f/Provider/OperaAria.py`

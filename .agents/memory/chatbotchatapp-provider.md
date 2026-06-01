---
name: ChatbotChatApp provider
description: Reverse-engineering notes and operational quirks for chatbotchatapp.com guest API
---

## Endpoint & auth

- Chat: `POST https://chatbotchatapp.com/api/mai` (SSE stream)
- Setup: GET /chat → CSRF from `<meta name="csrf-token">` + cookies (Laravel session)
- Timestamp: `POST /api/get-timestamp` with `href=<url>&ypp=` (form-encoded)
- Timestamp response: `{status,timestamp,ipInfo:{ip,lang,country_code2,id},isLoad,isLoad1,href}`

## Hash formula

```
id = MD5(
  "timestamp" + ts +
  "nonce"     + uuid4 +
  "messages"  + messages[ts % messages.length].content +
  "keyToken"  + "XXXXXXYYY" +
  "vv1"
)
```

- `XXXXXXYYY` = exactly 6 X's + 3 Y's (confirmed from JS source `keyToken="XXXXXXYYY"`)
- `o = []` (Array); named properties on array; `Object.entries(o)` = insertion order = [timestamp, nonce, messages]
- Verified: timestamp=1780250748, nonce=be6b24da-..., messages="Say hello in one sentence" → MD5=5cf8a274023290440813f525bca385a5

## Payload to /api/mai

```json
{
  "id": "<md5>",
  "timestamp": <number>,
  "nonce": "<uuid4>",
  "messages": [{"role":"user","content":"..."}],
  "url": "https://chatbotchatapp.com/chat",
  "modal": "model-chatgpt-3-5",
  "conversationId": ""
}
```

Headers: `X-CSRF-TOKEN`, `Accept: text/event-stream`, `Content-Type: application/json`

## SSE response format

- **Success** (data lines): `data: {"choices":[{"delta":{"content":"...","reasoning":"..."}}],"conversationId":"","pointId":"..."}`
- **Error** (**id lines, not data**): `id: {"code":1002,"message":"","data":{"href":"https://chatbotchatapp.com/"}}`
- Code 1006 = hash verification failed; Code 1002 = session/IP guard

## Critical operational limitation

The server implements a **"1 free chat per IP" anti-bot guard** for guest sessions:
- First request from a new IP → SUCCESS (code=0, streaming response)
- Subsequent requests from same IP → code 1002 (regardless of session freshness)
- Datacenter IPs (e.g. Google Cloud 34.100.203.60) get blocked after first use
- `isLoad`/`isLoad1` in timestamp response are NOT the rate-limit indicator; they're display flags
- `getDelayChat()` returns `1` — no JS-side delay, the block is server-side

**Why:** Anti-scraping/anti-bot measure; one "demo" chat per IP, then redirect to homepage.

**How to apply:** Provider retries with fresh session on 1002/1006, but this won't help if the IP itself is blocked. Provider works correctly on fresh IPs (first deployment). Session rotation won't bypass IP-level blocks.

## Models available

| Provider ID | Modal value |
|-------------|-------------|
| cbca | model-chatgpt-3-5 |
| cbca-gpt4 | model-chatgpt-4 |
| cbca-deepseek-r1 | model-deepseek-r1 |
| cbca-deepseek-v3 | model-deepseek-v3-0324 |
| cbca-qwen3 | model-qwen3-235b-a22b |
| cbca-gpt-oss | model-gpt-oss |
| cbca-mistral | model-mistral-large |
| cbca-pixtral | model-pixtral |
| cbca-codestral | model-codestral |

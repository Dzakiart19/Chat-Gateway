# Deploy ke Koyeb (Free Tier)

## Cara Deploy

### 1. Push ke GitHub
Pastikan project ini sudah di-push ke GitHub repository.

### 2. Buat Service di Koyeb
1. Buka [koyeb.com](https://koyeb.com) → **Create Service**
2. Pilih **GitHub** → pilih repository ini
3. Pilih **Builder: Dockerfile**
4. Koyeb akan otomatis detect `Dockerfile` di root

### 3. Set Environment Variables di Koyeb
Di bagian **Environment Variables**, tambahkan:

| Variable | Value | Keterangan |
|---|---|---|
| `MONGODB_URI` | `mongodb+srv://...` | MongoDB Atlas connection string |
| `MONGODB_DATABASE` | `qwen_gateway` | Nama database |
| `JWT_SECRET` | `<random-string>` | Secret untuk JWT token |
| `NODE_ENV` | `production` | Mode produksi |

> **PORT** sudah otomatis diset oleh Koyeb, tidak perlu diisi manual.

### 4. Health Check
Koyeb akan auto-detect port. Health check path: `/api/healthz`

### 5. MongoDB Gratis
Gunakan [MongoDB Atlas Free Tier](https://www.mongodb.com/cloud/atlas):
- Buat cluster M0 (gratis selamanya)
- Whitelist IP: `0.0.0.0/0` (allow all — karena Koyeb IP dinamis)
- Copy connection string ke `MONGODB_URI`

## Endpoint API Setelah Deploy
```
https://<nama-app>.koyeb.app/v1/chat/completions
https://<nama-app>.koyeb.app/v1/models
https://<nama-app>.koyeb.app/v1/models/:model
https://<nama-app>.koyeb.app/api/healthz
```

## OpenAI SDK Compatible
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<nama-app>.koyeb.app/v1",
    api_key="sk-..."
)

response = client.chat.completions.create(
    model="qwen3-235b-a22b",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

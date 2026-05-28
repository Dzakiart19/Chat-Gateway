import { Router } from "express";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

const router = Router();

const QWEN_BASE_URL = "https://chat.qwen.ai/api/v2";

interface HistoryEntry {
  id: string;
  success: boolean;
  statusCode: number;
  requestedAt: string;
  responseTime: number;
  endpoint: string;
  method: string;
  requestPayload: unknown;
  responseBody: unknown;
  responseHeaders: Record<string, string>;
  error: string | null;
}

const history: HistoryEntry[] = [];
const MAX_HISTORY = 200;

function getStats() {
  const total = history.length;
  const successCount = history.filter((h) => h.success).length;
  const failureCount = total - successCount;
  const avgResponseTime =
    total > 0
      ? Math.round(history.reduce((sum, h) => sum + h.responseTime, 0) / total)
      : 0;
  const lastRequestAt = history.length > 0 ? history[0].requestedAt : null;

  return {
    totalRequests: total,
    successCount,
    failureCount,
    avgResponseTime,
    lastRequestAt,
  };
}

// POST /api/gateway/proxy
router.post("/gateway/proxy", async (req, res) => {
  const { token, endpoint, method, payload, extraHeaders } = req.body as {
    token: string;
    endpoint: string;
    method: string;
    payload?: unknown;
    extraHeaders?: Record<string, string>;
  };

  if (!token || !endpoint || !method) {
    res.status(400).json({ error: "token, endpoint, and method are required" });
    return;
  }

  const url = `${QWEN_BASE_URL}/${endpoint.replace(/^\//, "")}`;
  const startTime = Date.now();
  const requestedAt = new Date().toISOString();
  const id = randomUUID();

  let statusCode = 0;
  let responseBody: unknown = null;
  let responseHeaders: Record<string, string> = {};
  let success = false;
  let error: string | null = null;

  try {
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        ...extraHeaders,
      },
    };

    if (
      payload &&
      ["POST", "PUT", "PATCH"].includes(method.toUpperCase())
    ) {
      fetchOptions.body = JSON.stringify(payload);
    }

    req.log.info({ url, method, endpoint }, "Proxying request to Qwen API");

    const response = await fetch(url, fetchOptions);
    statusCode = response.status;

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      const text = await response.text();
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { _raw: text };
      }
    }

    success = response.ok || statusCode === 200;
    if (!success && responseBody && typeof responseBody === "object") {
      const body = responseBody as Record<string, unknown>;
      if (body.data && typeof body.data === "object") {
        const data = body.data as Record<string, unknown>;
        error = (data.details as string) ?? (data.code as string) ?? null;
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    error = errMsg;
    statusCode = 0;
    responseBody = { error: errMsg };
    logger.error({ err, url }, "Proxy fetch failed");
  }

  const responseTime = Date.now() - startTime;

  const entry: HistoryEntry = {
    id,
    success,
    statusCode,
    requestedAt,
    responseTime,
    endpoint,
    method: method.toUpperCase(),
    requestPayload: payload ?? null,
    responseBody,
    responseHeaders,
    error,
  };

  history.unshift(entry);
  if (history.length > MAX_HISTORY) {
    history.splice(MAX_HISTORY);
  }

  res.json({
    id,
    success,
    statusCode,
    requestedAt,
    responseTime,
    endpoint,
    method: method.toUpperCase(),
    requestPayload: payload ?? null,
    responseBody,
    responseHeaders,
    error,
  });
});

// GET /api/gateway/history
router.get("/gateway/history", (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  res.json(history.slice(0, limit));
});

// DELETE /api/gateway/history
router.delete("/gateway/history", (req, res) => {
  const cleared = history.length;
  history.splice(0, history.length);
  res.json({ cleared });
});

// GET /api/gateway/stats
router.get("/gateway/stats", (req, res) => {
  res.json(getStats());
});

export default router;

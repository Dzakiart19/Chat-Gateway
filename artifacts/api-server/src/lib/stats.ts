export interface HistoryEntry {
  id: string;
  success: boolean;
  statusCode: number;
  requestedAt: string;
  responseTime: number;
  endpoint: string;
  method: string;
  model: string;
  requestPayload: unknown;
  responseBody: unknown;
  responseHeaders: Record<string, string>;
  error: string | null;
}

const history: HistoryEntry[] = [];
const MAX_HISTORY = 200;

export function recordRequest(entry: HistoryEntry): void {
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
}

export function getHistory(limit = 50): HistoryEntry[] {
  return history.slice(0, limit);
}

export function clearHistory(): number {
  const count = history.length;
  history.splice(0, history.length);
  return count;
}

export function getStats() {
  const total = history.length;
  const successCount = history.filter((h) => h.success).length;
  return {
    totalRequests: total,
    successCount,
    failureCount: total - successCount,
    avgResponseTime: total > 0
      ? Math.round(history.reduce((s, h) => s + h.responseTime, 0) / total)
      : 0,
    lastRequestAt: history[0]?.requestedAt ?? null,
  };
}

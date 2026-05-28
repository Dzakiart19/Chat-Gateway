import { useGetHistory, getGetHistoryQueryKey, useClearHistory } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trash2, ChevronRight, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function MethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  const cls =
    m === "GET" ? "method-badge-get" :
    m === "POST" ? "method-badge-post" :
    m === "DELETE" ? "method-badge-delete" :
    "method-badge-put";
  return <span className={cls}>{m}</span>;
}

function syntaxHighlight(json: unknown): string {
  const str = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = "num";
        if (/^"/.test(match)) cls = /:$/.test(match) ? "key" : "str";
        else if (/true|false/.test(match)) cls = "bool";
        else if (/null/.test(match)) cls = "null";
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

export default function History() {
  const { data: history, isLoading } = useGetHistory({}, { query: { queryKey: getGetHistoryQueryKey() } });
  const clearHistory = useClearHistory();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleClear = () => {
    if (!confirm("Clear all request history?")) return;
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
        toast.success("History cleared");
      },
    });
  };

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  const copyJson = (data: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("Copied");
  };

  return (
    <div className="flex-1 flex flex-col overflow-auto bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Request History</h1>
            <p className="text-sm text-muted-foreground mt-0.5">All proxied requests and their responses</p>
          </div>
          <button
            onClick={handleClear}
            disabled={!history?.length || clearHistory.isPending}
            data-testid="btn-clear-history"
            className="flex items-center gap-2 px-4 py-2 border border-destructive/50 text-destructive text-sm rounded hover:bg-destructive/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Clear all
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading...</div>
        ) : !history || history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-dashed border-border rounded-lg text-muted-foreground">
            <p className="text-sm">No requests yet</p>
            <p className="text-xs mt-1">Use the API Playground to make your first request</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-[32px_160px_80px_1fr_80px_80px_80px] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
              <div className="px-3 py-2.5" />
              <div className="px-3 py-2.5">Timestamp</div>
              <div className="px-3 py-2.5">Method</div>
              <div className="px-3 py-2.5">Endpoint</div>
              <div className="px-3 py-2.5 text-center">Status</div>
              <div className="px-3 py-2.5 text-right">Latency</div>
              <div className="px-3 py-2.5 text-center">Result</div>
            </div>

            {history.map((entry, i) => {
              const isExpanded = expandedId === entry.id;
              const statusCls = entry.statusCode >= 200 && entry.statusCode < 300 ? "status-2xx" :
                entry.statusCode >= 400 ? "status-4xx" : "status-err";

              return (
                <div key={entry.id} className={i > 0 ? "border-t border-border" : ""}>
                  <div
                    className={`grid grid-cols-[32px_160px_80px_1fr_80px_80px_80px] cursor-pointer hover:bg-muted/40 transition-colors text-sm ${isExpanded ? "bg-muted/30" : "bg-white"}`}
                    onClick={() => toggle(entry.id)}
                    data-testid={`history-row-${entry.id}`}
                  >
                    <div className="px-3 py-3 flex items-center text-muted-foreground">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </div>
                    <div className="px-3 py-3 font-mono text-xs text-muted-foreground flex items-center">
                      {format(new Date(entry.requestedAt), "HH:mm:ss.SSS")}
                    </div>
                    <div className="px-3 py-3 flex items-center">
                      <MethodBadge method={entry.method} />
                    </div>
                    <div className="px-3 py-3 font-mono text-xs text-foreground flex items-center truncate">
                      /{entry.endpoint}
                    </div>
                    <div className="px-3 py-3 flex items-center justify-center">
                      <span className={statusCls}>{entry.statusCode || "ERR"}</span>
                    </div>
                    <div className="px-3 py-3 text-right text-xs text-muted-foreground flex items-center justify-end">
                      {entry.responseTime}ms
                    </div>
                    <div className="px-3 py-3 flex items-center justify-center">
                      <span className={`text-xs font-semibold ${entry.success ? "text-green-600" : "text-red-500"}`}>
                        {entry.success ? "OK" : "FAIL"}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border bg-background/60 p-5 space-y-4">
                      {entry.error && (
                        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">
                          Error: {entry.error}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Request Payload</span>
                            <button
                              onClick={() => copyJson(entry.requestPayload)}
                              data-testid={`btn-copy-request-${entry.id}`}
                              className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          </div>
                          <div
                            className="code-block max-h-64 overflow-auto"
                            dangerouslySetInnerHTML={{ __html: syntaxHighlight(entry.requestPayload ?? "null") }}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Response Body</span>
                            <button
                              onClick={() => copyJson(entry.responseBody)}
                              data-testid={`btn-copy-response-${entry.id}`}
                              className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          </div>
                          <div
                            className="code-block max-h-64 overflow-auto"
                            dangerouslySetInnerHTML={{ __html: syntaxHighlight(entry.responseBody ?? "null") }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

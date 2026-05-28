import { useState, useCallback } from "react";
import { useProxyRequest, useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { ChevronDown, ChevronUp, Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// ── helpers ────────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  const cls =
    m === "GET" ? "method-badge-get" :
    m === "POST" ? "method-badge-post" :
    m === "DELETE" ? "method-badge-delete" :
    "method-badge-put";
  return <span className={cls}>{m}</span>;
}

function buildCurl(token: string, endpoint: string, method: string, payload: unknown): string {
  const url = `https://chat.qwen.ai/api/v2/${endpoint.replace(/^\//, "")}`;
  const m = method.toUpperCase();
  let cmd = `curl -X '${m}' \\\n  '${url}' \\\n  -H 'accept: application/json' \\\n  -H 'Authorization: Bearer ${token ? "<YOUR_TOKEN>" : "..."}'`;
  if (payload && ["POST", "PUT", "PATCH"].includes(m)) {
    cmd += ` \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(payload)}'`;
  }
  return cmd;
}

function syntaxHighlight(json: unknown): string {
  const str = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
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

function CodeBlock({ content, label }: { content: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative group">
      {label && <div className="text-xs text-muted-foreground mb-1 font-medium">{label}</div>}
      <div
        className="code-block"
        dangerouslySetInnerHTML={{ __html: syntaxHighlight(content) }}
      />
      <button
        onClick={copy}
        data-testid="btn-copy-code"
        className="absolute top-2 right-2 p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ── endpoint definitions ────────────────────────────────────────────────────

interface EndpointDef {
  id: string;
  method: "POST" | "GET";
  path: string;
  summary: string;
  description: string;
  defaultPayload?: object;
  params: ParamDef[];
}

interface ParamDef {
  name: string;
  required: boolean;
  type: string;
  location: string;
  description: string;
  placeholder?: string;
  multiline?: boolean;
}

const ENDPOINTS: EndpointDef[] = [
  {
    id: "chat-completions",
    method: "POST",
    path: "/chat/completions",
    summary: "Chat Completions",
    description: "Creates a model response for the given chat conversation. Supports tool/function calling.",
    defaultPayload: {
      model: "qwen-plus",
      messages: [{ role: "user", content: "Hello! What is 2 + 2?" }],
      stream: false,
    },
    params: [
      { name: "model", required: true, type: "string", location: "body", description: "Model ID to use (e.g. qwen-plus, qwen-max, qwen-turbo)", placeholder: "qwen-plus" },
      { name: "messages", required: true, type: "array", location: "body", description: "Array of messages in the conversation", placeholder: '[{"role":"user","content":"Hello!"}]', multiline: true },
      { name: "stream", required: false, type: "boolean", location: "body", description: "Whether to stream the response", placeholder: "false" },
      { name: "tools", required: false, type: "array", location: "body", description: "List of tool definitions for function calling", placeholder: '[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}}]', multiline: true },
      { name: "tool_choice", required: false, type: "string", location: "body", description: "Controls which tool is called: auto, none, or specific tool name", placeholder: "auto" },
      { name: "temperature", required: false, type: "number", location: "body", description: "Sampling temperature (0.0 – 2.0)", placeholder: "0.7" },
      { name: "max_tokens", required: false, type: "integer", location: "body", description: "Maximum tokens to generate", placeholder: "1024" },
    ],
  },
  {
    id: "models",
    method: "GET",
    path: "/models",
    summary: "List Models",
    description: "Returns a list of available models.",
    params: [],
  },
  {
    id: "custom",
    method: "POST",
    path: "",
    summary: "Custom Endpoint",
    description: "Send a request to any endpoint with a custom JSON body.",
    params: [
      { name: "endpoint", required: true, type: "string", location: "path", description: "API path relative to base URL (e.g. chat/completions)", placeholder: "chat/completions" },
      { name: "method", required: true, type: "string", location: "meta", description: "HTTP method to use", placeholder: "POST" },
      { name: "body", required: false, type: "object", location: "body", description: "Request body as JSON", placeholder: '{"model":"qwen-plus","messages":[{"role":"user","content":"Hi"}],"stream":false}', multiline: true },
    ],
  },
];

// ── EndpointBlock ───────────────────────────────────────────────────────────

interface EndpointResponse {
  success: boolean;
  statusCode: number;
  responseTime: number;
  endpoint: string;
  method: string;
  requestPayload: unknown;
  responseBody: unknown;
  error: string | null;
}

function EndpointBlock({ def, token }: { def: EndpointDef; token: string }) {
  const [open, setOpen] = useState(def.id === "chat-completions");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (def.defaultPayload) {
      const p = def.defaultPayload as Record<string, unknown>;
      def.params.forEach((param) => {
        if (param.name in p) {
          init[param.name] = typeof p[param.name] === "string"
            ? (p[param.name] as string)
            : JSON.stringify(p[param.name], null, 2);
        }
      });
    }
    return init;
  });
  const [response, setResponse] = useState<EndpointResponse | null>(null);
  const [showResponse, setShowResponse] = useState(false);

  const proxyRequest = useProxyRequest();
  const queryClient = useQueryClient();

  const setValue = (name: string, val: string) => setValues((prev) => ({ ...prev, [name]: val }));

  const buildPayload = (): { endpoint: string; method: string; payload: unknown } => {
    if (def.id === "custom") {
      const endpoint = values["endpoint"] || "";
      const method = values["method"] || "POST";
      let payload: unknown = undefined;
      if (values["body"]) {
        try { payload = JSON.parse(values["body"]); } catch { payload = values["body"]; }
      }
      return { endpoint, method, payload };
    }

    if (def.id === "models") {
      return { endpoint: "models", method: "GET", payload: undefined };
    }

    const body: Record<string, unknown> = {};
    def.params.forEach((param) => {
      const val = values[param.name];
      if (val === undefined || val === "") return;
      if (param.type === "boolean") body[param.name] = val === "true";
      else if (param.type === "number" || param.type === "integer") body[param.name] = Number(val);
      else if (param.type === "array" || param.type === "object") {
        try { body[param.name] = JSON.parse(val); } catch { body[param.name] = val; }
      } else {
        body[param.name] = val;
      }
    });

    return { endpoint: def.path.replace(/^\//, ""), method: def.method, payload: body };
  };

  const handleExecute = () => {
    if (!token) { toast.error("Token is required. Set it in the Authorization section above."); return; }
    const { endpoint, method, payload } = buildPayload();
    if (!endpoint && def.id === "custom") { toast.error("Endpoint path is required"); return; }

    setShowResponse(true);
    setResponse(null);

    proxyRequest.mutate({ data: { token, endpoint, method, payload } }, {
      onSuccess: (data) => {
        setResponse(data as EndpointResponse);
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      },
      onError: () => {
        toast.error("Gateway connection failed");
        setResponse({ success: false, statusCode: 0, responseTime: 0, endpoint, method, requestPayload: payload, responseBody: null, error: "Connection failed" });
      },
    });
  };

  const handleClear = () => {
    setValues(() => {
      const init: Record<string, string> = {};
      if (def.defaultPayload) {
        const p = def.defaultPayload as Record<string, unknown>;
        def.params.forEach((param) => {
          if (param.name in p) {
            init[param.name] = typeof p[param.name] === "string"
              ? (p[param.name] as string)
              : JSON.stringify(p[param.name], null, 2);
          }
        });
      }
      return init;
    });
    setResponse(null);
    setShowResponse(false);
  };

  const { endpoint, method, payload } = buildPayload();
  const curlStr = buildCurl(token, endpoint || def.path.replace(/^\//, ""), method, payload);
  const requestUrl = `https://chat.qwen.ai/api/v2/${(endpoint || def.path.replace(/^\//, "")).replace(/^\//, "")}`;

  const blockCls = def.method === "GET" ? "endpoint-block-get" : "endpoint-block-post";

  const statusCls = !response ? "" :
    response.statusCode >= 200 && response.statusCode < 300 ? "status-2xx" :
    response.statusCode >= 400 ? "status-4xx" : "status-err";

  return (
    <div className={`rounded-md border border-border bg-card shadow-sm overflow-hidden ${blockCls}`} data-testid={`endpoint-block-${def.id}`}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen((p) => !p)}
        data-testid={`btn-expand-${def.id}`}
      >
        <MethodBadge method={def.method} />
        <span className="font-mono text-sm font-medium text-foreground flex-1">
          {def.id === "custom" ? <span className="italic text-muted-foreground">/{values["endpoint"] || "custom"}</span> : def.path}
        </span>
        <span className="text-sm text-muted-foreground hidden sm:block">{def.summary}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border bg-background/50">
          {/* Description */}
          <div className="px-5 py-3 text-sm text-muted-foreground border-b border-border/60">
            {def.description}
          </div>

          {/* Parameters */}
          <div className="px-5 pt-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Parameters</h3>
              <button
                onClick={handleClear}
                data-testid={`btn-clear-${def.id}`}
                className="text-xs px-3 py-1 border border-destructive/60 text-destructive rounded hover:bg-destructive/5 transition-colors"
              >
                Cancel
              </button>
            </div>

            {def.params.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-2">No parameters required.</div>
            ) : (
              <div className="border border-border rounded-md overflow-hidden">
                <div className="grid grid-cols-[220px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <div className="px-4 py-2 border-r border-border">Name</div>
                  <div className="px-4 py-2">Description</div>
                </div>
                {def.params.map((param, i) => (
                  <div
                    key={param.name}
                    className={`grid grid-cols-[220px_1fr] border-t border-border ${i % 2 === 0 ? "bg-white" : "bg-muted/30"}`}
                  >
                    <div className="px-4 py-3 border-r border-border">
                      <div className="font-mono text-sm font-semibold text-foreground">{param.name}</div>
                      {param.required && (
                        <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-0.5">{param.type}</div>
                      <div className="text-[11px] text-muted-foreground">({param.location})</div>
                    </div>
                    <div className="px-4 py-3 flex flex-col gap-1.5">
                      <div className="text-sm text-muted-foreground">{param.description}</div>
                      {param.multiline ? (
                        <textarea
                          data-testid={`input-${def.id}-${param.name}`}
                          value={values[param.name] ?? ""}
                          onChange={(e) => setValue(param.name, e.target.value)}
                          placeholder={param.placeholder}
                          rows={4}
                          className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                          spellCheck={false}
                        />
                      ) : (
                        <input
                          data-testid={`input-${def.id}-${param.name}`}
                          type="text"
                          value={values[param.name] ?? ""}
                          onChange={(e) => setValue(param.name, e.target.value)}
                          placeholder={param.placeholder}
                          className="w-full border border-border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Execute / Clear */}
            <div className="flex gap-3 mt-4 pb-4">
              <button
                onClick={handleExecute}
                disabled={proxyRequest.isPending}
                data-testid={`btn-execute-${def.id}`}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-white text-sm font-semibold rounded hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {proxyRequest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Execute
              </button>
              <button
                onClick={handleClear}
                data-testid={`btn-clear2-${def.id}`}
                className="px-6 py-2 border border-border text-sm font-semibold rounded hover:bg-muted transition-colors text-foreground"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Responses */}
          {showResponse && (
            <div className="border-t border-border px-5 py-4 space-y-4 bg-background/30">
              <h3 className="text-sm font-semibold text-foreground">Responses</h3>

              {/* Curl */}
              <CodeBlock content={curlStr} label="Curl" />

              {/* Request URL */}
              <div>
                <div className="text-xs text-muted-foreground mb-1 font-medium">Request URL</div>
                <div className="code-block text-sm">{requestUrl}</div>
              </div>

              {/* Server Response */}
              <div>
                <div className="text-xs text-muted-foreground mb-2 font-medium">Server response</div>
                {proxyRequest.isPending && !response ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Awaiting response...</span>
                  </div>
                ) : response ? (
                  <div className="border border-border rounded-md overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[80px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <div className="px-4 py-2 border-r border-border">Code</div>
                      <div className="px-4 py-2">Details</div>
                    </div>
                    {/* Row */}
                    <div className="grid grid-cols-[80px_1fr] border-t border-border bg-white">
                      <div className="px-4 py-3 border-r border-border flex items-start pt-4">
                        <span className={statusCls}>
                          {response.statusCode || "ERR"}
                        </span>
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground font-medium">Response body</div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">{response.responseTime}ms</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(response.responseBody, null, 2));
                                toast.success("Copied");
                              }}
                              data-testid="btn-copy-response"
                              className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors"
                            >
                              Copy
                            </button>
                            <button
                              onClick={() => {
                                const blob = new Blob([JSON.stringify(response.responseBody, null, 2)], { type: "application/json" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url; a.download = "response.json"; a.click();
                                URL.revokeObjectURL(url);
                              }}
                              data-testid="btn-download-response"
                              className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors"
                            >
                              Download
                            </button>
                          </div>
                        </div>
                        <div
                          className="code-block"
                          dangerouslySetInnerHTML={{
                            __html: syntaxHighlight(JSON.stringify(response.responseBody, null, 2) || "null"),
                          }}
                        />
                        {response.error && (
                          <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">
                            {response.error}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── main page ───────────────────────────────────────────────────────────────

export default function Playground() {
  const [token, setToken] = useState(() => localStorage.getItem("qwen_token") || "");
  const [tokenVisible, setTokenVisible] = useState(false);
  const { data: stats } = useGetStats({}, { query: { queryKey: getGetStatsQueryKey() } });

  const saveToken = useCallback((val: string) => {
    setToken(val);
    localStorage.setItem("qwen_token", val);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      {/* Page header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Qwen Chat API</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 bg-primary text-white rounded font-medium">v2</span>
              <span className="text-sm text-muted-foreground font-mono">https://chat.qwen.ai/api/v2</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              API gateway wrapper — test endpoints, inspect responses, explore tool calling flows.
            </p>
          </div>
          {stats && (
            <div className="flex gap-4 text-center text-sm shrink-0">
              <div>
                <div className="font-semibold text-foreground">{stats.totalRequests}</div>
                <div className="text-xs text-muted-foreground">Requests</div>
              </div>
              <div>
                <div className="font-semibold text-green-600">
                  {stats.totalRequests ? Math.round((stats.successCount / stats.totalRequests) * 100) : 0}%
                </div>
                <div className="text-xs text-muted-foreground">Success</div>
              </div>
              <div>
                <div className="font-semibold text-foreground">{stats.avgResponseTime}ms</div>
                <div className="text-xs text-muted-foreground">Avg latency</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-4">
        {/* Authorization */}
        <div className="rounded-md border border-border bg-card shadow-sm overflow-hidden border-l-[6px] border-l-amber-400">
          <div className="px-5 py-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold px-2 py-0.5 bg-amber-100 text-amber-700 rounded uppercase tracking-wide">Auth</span>
              <span className="text-sm font-semibold text-foreground">Bearer Token</span>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <div className="grid grid-cols-[220px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div className="px-4 py-2 border-r border-border">Name</div>
                <div className="px-4 py-2">Description</div>
              </div>
              <div className="grid grid-cols-[220px_1fr] border-t border-border bg-white">
                <div className="px-4 py-3 border-r border-border">
                  <div className="font-mono text-sm font-semibold">Authorization</div>
                  <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">string (header)</div>
                </div>
                <div className="px-4 py-3 flex flex-col gap-1.5">
                  <div className="text-sm text-muted-foreground">
                    Your Qwen session token. Get it from <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">chat.qwen.ai</span> — open DevTools, go to Network tab, find any API request, copy the <span className="font-mono text-xs">Authorization</span> header value.
                  </div>
                  <div className="relative">
                    <input
                      data-testid="input-token"
                      type={tokenVisible ? "text" : "password"}
                      value={token}
                      onChange={(e) => saveToken(e.target.value)}
                      placeholder="Paste your Bearer token here..."
                      className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors pr-20"
                    />
                    <button
                      onClick={() => setTokenVisible((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {tokenVisible ? "Hide" : "Show"}
                    </button>
                  </div>
                  {token && (
                    <div className="text-[11px] text-green-600 font-medium">Token saved (persisted in browser)</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Endpoint blocks */}
        {ENDPOINTS.map((def) => (
          <EndpointBlock key={def.id} def={def} token={token} />
        ))}
      </div>
    </div>
  );
}

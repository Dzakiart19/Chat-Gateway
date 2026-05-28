import { useState, useCallback } from "react";
import { useProxyRequest, useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { ChevronDown, ChevronUp, Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

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

function CodeBlock({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative group">
      <div className="code-block" dangerouslySetInnerHTML={{ __html: syntaxHighlight(content) }} />
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

interface ParamDef {
  name: string;
  required: boolean;
  type: string;
  location: string;
  description: string;
  placeholder?: string;
  multiline?: boolean;
}

interface EndpointDef {
  id: string;
  method: "POST" | "GET";
  path: string;
  summary: string;
  description: string;
  defaultPayload?: object;
  params: ParamDef[];
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

function ParamRow({ param, value, onChange }: { param: ParamDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className="border-t border-border bg-white">
      {/* Mobile: stacked, Desktop: side-by-side */}
      <div className="flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
        <div className="px-3 py-2 sm:px-4 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-white">
          <div className="font-mono text-sm font-semibold text-foreground">{param.name}</div>
          {param.required && <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>}
          <div className="text-[11px] text-muted-foreground mt-0.5">{param.type} ({param.location})</div>
        </div>
        <div className="px-3 py-2 sm:px-4 sm:py-3 flex flex-col gap-1.5">
          <div className="text-xs sm:text-sm text-muted-foreground">{param.description}</div>
          {param.multiline ? (
            <textarea
              data-testid={`input-${param.name}`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={param.placeholder}
              rows={3}
              className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
              spellCheck={false}
            />
          ) : (
            <input
              data-testid={`input-${param.name}`}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={param.placeholder}
              className="w-full border border-border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
            />
          )}
        </div>
      </div>
    </div>
  );
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
    if (def.id === "models") return { endpoint: "models", method: "GET", payload: undefined };

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
    if (!token) { toast.error("Set your Bearer token in the AUTH section above"); return; }
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

  const blockBorderCls = def.method === "GET" ? "endpoint-block-get" : "endpoint-block-post";

  const statusCls = !response ? "" :
    response.statusCode >= 200 && response.statusCode < 300 ? "status-2xx" :
    response.statusCode >= 400 ? "status-4xx" : "status-err";

  return (
    <div className={`rounded-md border border-border bg-card shadow-sm overflow-hidden ${blockBorderCls}`} data-testid={`endpoint-block-${def.id}`}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen((p) => !p)}
        data-testid={`btn-expand-${def.id}`}
      >
        <MethodBadge method={def.method} />
        <span className="font-mono text-xs sm:text-sm font-medium text-foreground flex-1 truncate">
          {def.id === "custom"
            ? <span className="italic text-muted-foreground">/{values["endpoint"] || "custom"}</span>
            : def.path}
        </span>
        <span className="text-xs sm:text-sm text-muted-foreground hidden sm:block truncate max-w-[180px]">{def.summary}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border bg-background/50">
          {/* Description */}
          <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border/60">
            {def.description}
          </div>

          {/* Parameters */}
          <div className="px-3 sm:px-5 pt-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Parameters</h3>
              <button
                onClick={handleClear}
                data-testid={`btn-cancel-${def.id}`}
                className="text-xs px-3 py-1 border border-destructive/60 text-destructive rounded hover:bg-destructive/5 transition-colors"
              >
                Cancel
              </button>
            </div>

            {def.params.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-2">No parameters required.</p>
            ) : (
              <div className="border border-border rounded-md overflow-hidden">
                {/* Column headers — hidden on mobile */}
                <div className="hidden sm:grid sm:grid-cols-[200px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <div className="px-4 py-2 border-r border-border">Name</div>
                  <div className="px-4 py-2">Description</div>
                </div>
                {def.params.map((param) => (
                  <ParamRow
                    key={param.name}
                    param={param}
                    value={values[param.name] ?? ""}
                    onChange={(v) => setValue(param.name, v)}
                  />
                ))}
              </div>
            )}

            {/* Execute / Clear */}
            <div className="flex gap-3 mt-4 pb-4">
              <button
                onClick={handleExecute}
                disabled={proxyRequest.isPending}
                data-testid={`btn-execute-${def.id}`}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-white text-sm font-semibold rounded hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {proxyRequest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Execute
              </button>
              <button
                onClick={handleClear}
                data-testid={`btn-clear-${def.id}`}
                className="flex-1 sm:flex-none px-6 py-2.5 border border-border text-sm font-semibold rounded hover:bg-muted transition-colors text-foreground"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Responses */}
          {showResponse && (
            <div className="border-t border-border px-3 sm:px-5 py-4 space-y-4 bg-background/30">
              <h3 className="text-sm font-semibold text-foreground">Responses</h3>

              <div>
                <div className="text-xs text-muted-foreground mb-1 font-medium">Curl</div>
                <CodeBlock content={curlStr} />
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1 font-medium">Request URL</div>
                <div className="code-block break-all text-xs sm:text-sm">{requestUrl}</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-2 font-medium">Server response</div>
                {proxyRequest.isPending && !response ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Awaiting response...</span>
                  </div>
                ) : response ? (
                  <div className="border border-border rounded-md overflow-hidden">
                    {/* Mobile: stacked; Desktop: side-by-side */}
                    <div className="hidden sm:grid sm:grid-cols-[80px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <div className="px-4 py-2 border-r border-border">Code</div>
                      <div className="px-4 py-2">Details</div>
                    </div>
                    <div className="sm:grid sm:grid-cols-[80px_1fr] border-t border-border bg-white">
                      <div className="px-4 py-3 sm:border-r sm:border-border flex items-center sm:items-start sm:pt-4 gap-3 sm:gap-0 border-b border-border sm:border-b-0">
                        <span className="text-xs font-semibold text-muted-foreground sm:hidden">Code:</span>
                        <span className={statusCls}>{response.statusCode || "ERR"}</span>
                      </div>
                      <div className="px-3 sm:px-4 py-3 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="text-xs text-muted-foreground font-medium">Response body</div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs text-muted-foreground">{response.responseTime}ms</span>
                            <button
                              onClick={() => { navigator.clipboard.writeText(JSON.stringify(response.responseBody, null, 2)); toast.success("Copied"); }}
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
                        <div className="code-block overflow-x-auto" dangerouslySetInnerHTML={{ __html: syntaxHighlight(JSON.stringify(response.responseBody, null, 2) || "null") }} />
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
      <div className="bg-card border-b border-border px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Qwen Chat API</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs px-2 py-0.5 bg-primary text-white rounded font-medium shrink-0">v2</span>
              <span className="text-xs sm:text-sm text-muted-foreground font-mono truncate">https://chat.qwen.ai/api/v2</span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 hidden sm:block">
              API gateway wrapper — test endpoints, inspect responses, explore tool calling flows.
            </p>
          </div>
          {stats && (
            <div className="flex gap-4 sm:gap-5 text-center shrink-0">
              <div>
                <div className="font-semibold text-sm sm:text-base text-foreground">{stats.totalRequests}</div>
                <div className="text-[11px] text-muted-foreground">Requests</div>
              </div>
              <div>
                <div className="font-semibold text-sm sm:text-base text-green-600">
                  {stats.totalRequests ? Math.round((stats.successCount / stats.totalRequests) * 100) : 0}%
                </div>
                <div className="text-[11px] text-muted-foreground">Success</div>
              </div>
              <div>
                <div className="font-semibold text-sm sm:text-base text-foreground">{stats.avgResponseTime}ms</div>
                <div className="text-[11px] text-muted-foreground">Avg latency</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
        {/* Authorization */}
        <div className="rounded-md border border-border bg-card shadow-sm overflow-hidden border-l-[6px] border-l-amber-400">
          <div className="px-3 sm:px-5 py-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold px-2 py-0.5 bg-amber-100 text-amber-700 rounded uppercase tracking-wide">Auth</span>
              <span className="text-sm font-semibold text-foreground">Bearer Token</span>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <div className="hidden sm:grid sm:grid-cols-[200px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div className="px-4 py-2 border-r border-border">Name</div>
                <div className="px-4 py-2">Description</div>
              </div>
              <div className="border-t border-border sm:grid sm:grid-cols-[200px_1fr] bg-white">
                <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-white">
                  <div className="font-mono text-sm font-semibold">Authorization</div>
                  <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">string (header)</div>
                </div>
                <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                  <div className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
                    Your Qwen session token. Get it from <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">chat.qwen.ai</span> — open DevTools, Network tab, copy the <span className="font-mono text-xs">Authorization</span> header.
                  </div>
                  <div className="relative">
                    <input
                      data-testid="input-token"
                      type={tokenVisible ? "text" : "password"}
                      value={token}
                      onChange={(e) => saveToken(e.target.value)}
                      placeholder="Paste your Bearer token here..."
                      className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors pr-16"
                    />
                    <button
                      onClick={() => setTokenVisible((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {tokenVisible ? "Hide" : "Show"}
                    </button>
                  </div>
                  {token && <div className="text-[11px] text-green-600 font-medium">Token saved</div>}
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

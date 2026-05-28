import { useState } from "react";
import {
  useKeylessChat,
  useProxyRequest,
  useGetStats,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import { ChevronDown, ChevronUp, Copy, Check, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// ── helpers ────────────────────────────────────────────────────────────────

const WORKING_MODELS = [
  { id: "qwen3-235b-a22b", label: "Qwen3 235B A22B (Fastest free)" },
  { id: "qwen3.7-max", label: "Qwen3.7 Max" },
  { id: "qwen3-30b-a3b", label: "Qwen3 30B A3B" },
];

function MethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  const cls =
    m === "GET" ? "method-badge-get" :
    m === "POST" ? "method-badge-post" :
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

function CodeBlock({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div className="relative">
      <div className="code-block overflow-x-auto" dangerouslySetInnerHTML={{ __html: syntaxHighlight(content) }} />
      <button onClick={copy} data-testid="btn-copy-code" className="absolute top-2 right-2 p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors">
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ── Response display ────────────────────────────────────────────────────────

interface GatewayResponse {
  success: boolean;
  statusCode: number;
  responseTime: number;
  responseBody: unknown;
  error: string | null;
}

function ResponseSection({ res, isPending, endpoint, curlStr }: {
  res: GatewayResponse | null;
  isPending: boolean;
  endpoint: string;
  curlStr: string;
}) {
  const requestUrl = `https://chat.qwen.ai/api/v2/${endpoint.replace(/^\//, "")}`;
  const statusCls = !res ? "" :
    res.statusCode === 200 ? "status-2xx" :
    res.statusCode >= 400 ? "status-4xx" : "status-err";

  return (
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
        {isPending && !res ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
            <Loader2 className="w-4 h-4 animate-spin" /><span>Awaiting response...</span>
          </div>
        ) : res ? (
          <div className="border border-border rounded-md overflow-hidden">
            <div className="hidden sm:grid sm:grid-cols-[80px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div className="px-4 py-2 border-r border-border">Code</div>
              <div className="px-4 py-2">Details</div>
            </div>
            <div className="sm:grid sm:grid-cols-[80px_1fr] border-t border-border bg-white">
              <div className="px-4 py-3 sm:border-r sm:border-border flex items-center gap-2 sm:items-start sm:pt-4 border-b border-border sm:border-b-0">
                <span className="text-xs font-semibold text-muted-foreground sm:hidden">Code:</span>
                <span className={statusCls}>{res.statusCode || "ERR"}</span>
              </div>
              <div className="px-3 sm:px-4 py-3 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs text-muted-foreground font-medium">Response body</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{res.responseTime}ms</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(JSON.stringify(res.responseBody, null, 2)); toast.success("Copied"); }}
                      data-testid="btn-copy-response"
                      className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors"
                    >Copy</button>
                    <button
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(res.responseBody, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = "response.json"; a.click();
                        URL.revokeObjectURL(url);
                      }}
                      data-testid="btn-download-response"
                      className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors"
                    >Download</button>
                  </div>
                </div>
                <div className="code-block overflow-x-auto" dangerouslySetInnerHTML={{ __html: syntaxHighlight(JSON.stringify(res.responseBody, null, 2) || "null") }} />
                {res.error && (
                  <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">{res.error}</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Keyless Chat Block ──────────────────────────────────────────────────────

function KeylessChatBlock() {
  const [open, setOpen] = useState(true);
  const [model, setModel] = useState("qwen3-235b-a22b");
  const [messages, setMessages] = useState(JSON.stringify([
    { role: "user", content: "Hello! What is 2 + 2?" }
  ], null, 2));
  const [systemPrompt, setSystemPrompt] = useState("");
  const [response, setResponse] = useState<GatewayResponse | null>(null);
  const [showResponse, setShowResponse] = useState(false);

  const keylessChat = useKeylessChat();
  const queryClient = useQueryClient();

  const handleExecute = () => {
    let parsedMessages: Array<{ role: string; content: string }>;
    try {
      parsedMessages = JSON.parse(messages);
    } catch {
      toast.error("Invalid JSON in messages field");
      return;
    }

    const finalMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...parsedMessages]
      : parsedMessages;

    setShowResponse(true);
    setResponse(null);

    keylessChat.mutate({ data: { model, messages: finalMessages } }, {
      onSuccess: (data) => {
        setResponse(data as GatewayResponse);
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      },
      onError: () => {
        toast.error("Request failed");
        setResponse({ success: false, statusCode: 0, responseTime: 0, responseBody: null, error: "Connection failed" });
      },
    });
  };

  const handleClear = () => {
    setMessages(JSON.stringify([{ role: "user", content: "Hello! What is 2 + 2?" }], null, 2));
    setSystemPrompt("");
    setResponse(null);
    setShowResponse(false);
  };

  const curlStr = `curl -X 'POST' \\\n  'https://YOUR_GATEWAY/api/gateway/chat' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ model, messages: JSON.parse(messages.trim() || "[]").slice(0, 1) })}'`;

  return (
    <div className="rounded-md border border-border bg-card shadow-sm overflow-hidden endpoint-block-post" data-testid="endpoint-block-keyless">
      <button
        className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(p => !p)}
        data-testid="btn-expand-keyless"
      >
        <MethodBadge method="POST" />
        <span className="font-mono text-xs sm:text-sm font-medium text-foreground flex-1">/chat/completions</span>
        <div className="hidden sm:flex items-center gap-1.5">
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium">No token required</span>
          <span className="text-xs text-muted-foreground">Chat Completions</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border bg-background/50">
          <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border/60 flex items-start gap-2">
            <Zap className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            <span>
              Keyless — tidak butuh login atau API key. Menggunakan <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">bx-umidtoken</span> dari Alibaba CDN secara otomatis.
              Model yang tersedia: <span className="font-mono text-xs">qwen3-235b-a22b</span>, <span className="font-mono text-xs">qwen3.7-max</span>, <span className="font-mono text-xs">qwen3-30b-a3b</span>.
            </span>
          </div>

          <div className="px-3 sm:px-5 pt-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Parameters</h3>
              <button onClick={handleClear} data-testid="btn-cancel-keyless" className="text-xs px-3 py-1 border border-destructive/60 text-destructive rounded hover:bg-destructive/5 transition-colors">Cancel</button>
            </div>

            <div className="border border-border rounded-md overflow-hidden">
              <div className="hidden sm:grid sm:grid-cols-[200px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div className="px-4 py-2 border-r border-border">Name</div>
                <div className="px-4 py-2">Description</div>
              </div>

              {/* model */}
              <div className="border-t border-border bg-white flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-white">
                  <div className="font-mono text-sm font-semibold">model</div>
                  <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">string (body)</div>
                </div>
                <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                  <div className="text-xs sm:text-sm text-muted-foreground">Qwen model to use (only models listed below work without a token)</div>
                  <select
                    data-testid="input-model"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="w-full border border-border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                  >
                    {WORKING_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* system prompt (optional) */}
              <div className="border-t border-border bg-muted/20 flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-muted/20">
                  <div className="font-mono text-sm font-semibold">system</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">string (body)</div>
                  <div className="text-[11px] text-muted-foreground">(optional)</div>
                </div>
                <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                  <div className="text-xs sm:text-sm text-muted-foreground">System prompt — instructs the AI's behavior/role (injected before messages)</div>
                  <input
                    data-testid="input-system"
                    type="text"
                    value={systemPrompt}
                    onChange={e => setSystemPrompt(e.target.value)}
                    placeholder="You are a helpful assistant."
                    className="w-full border border-border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {/* messages */}
              <div className="border-t border-border bg-white flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-white">
                  <div className="font-mono text-sm font-semibold">messages</div>
                  <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">array (body)</div>
                </div>
                <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                  <div className="text-xs sm:text-sm text-muted-foreground">Conversation history — array of <span className="font-mono text-xs bg-muted px-1 rounded">{"{ role, content }"}</span> objects. Roles: <span className="font-mono text-xs">user</span>, <span className="font-mono text-xs">assistant</span></div>
                  <textarea
                    data-testid="input-messages"
                    value={messages}
                    onChange={e => setMessages(e.target.value)}
                    rows={5}
                    className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                    spellCheck={false}
                  />
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        try {
                          const msgs = JSON.parse(messages);
                          msgs.push({ role: "user", content: "" });
                          setMessages(JSON.stringify(msgs, null, 2));
                        } catch { toast.error("Fix JSON first"); }
                      }}
                      className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                    >+ Add user message</button>
                    <button
                      onClick={() => {
                        try {
                          const msgs = JSON.parse(messages);
                          msgs.push({ role: "assistant", content: "" });
                          setMessages(JSON.stringify(msgs, null, 2));
                        } catch { toast.error("Fix JSON first"); }
                      }}
                      className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                    >+ Add assistant message</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-4 pb-4">
              <button
                onClick={handleExecute}
                disabled={keylessChat.isPending}
                data-testid="btn-execute-keyless"
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-white text-sm font-semibold rounded hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {keylessChat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Execute
              </button>
              <button onClick={handleClear} data-testid="btn-clear-keyless" className="flex-1 sm:flex-none px-6 py-2.5 border border-border text-sm font-semibold rounded hover:bg-muted transition-colors">Clear</button>
            </div>
          </div>

          {showResponse && (
            <ResponseSection
              res={response}
              isPending={keylessChat.isPending}
              endpoint="chat/completions"
              curlStr={curlStr}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Raw Proxy Block ────────────────────────────────────────────────────────

function RawProxyBlock() {
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("chat/completions");
  const [method, setMethod] = useState("POST");
  const [token, setToken] = useState(() => localStorage.getItem("qwen_token") || "");
  const [payload, setPayload] = useState(JSON.stringify({
    model: "qwen-plus",
    messages: [{ role: "user", content: "Hello" }],
    stream: false,
  }, null, 2));
  const [response, setResponse] = useState<GatewayResponse | null>(null);
  const [showResponse, setShowResponse] = useState(false);

  const proxyRequest = useProxyRequest();
  const queryClient = useQueryClient();

  const handleExecute = () => {
    let parsedPayload: unknown;
    try { parsedPayload = JSON.parse(payload); } catch { toast.error("Invalid JSON payload"); return; }

    if (token) localStorage.setItem("qwen_token", token);

    setShowResponse(true);
    setResponse(null);

    proxyRequest.mutate({ data: { token: token || undefined, endpoint, method, payload: parsedPayload } }, {
      onSuccess: (data) => {
        setResponse(data as GatewayResponse);
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      },
      onError: () => {
        toast.error("Request failed");
        setResponse({ success: false, statusCode: 0, responseTime: 0, responseBody: null, error: "Connection failed" });
      },
    });
  };

  const handleClear = () => { setResponse(null); setShowResponse(false); };

  const curlStr = `curl -X '${method}' \\\n  'https://chat.qwen.ai/api/v2/${endpoint}' \\\n  -H 'accept: application/json'${token ? ` \\\n  -H 'Authorization: Bearer <YOUR_TOKEN>'` : ""} \\\n  -H 'Content-Type: application/json' \\\n  -d '${payload.replace(/\n/g, "")}'`;

  return (
    <div className="rounded-md border border-border bg-card shadow-sm overflow-hidden endpoint-block-get" data-testid="endpoint-block-proxy">
      <button
        className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(p => !p)}
        data-testid="btn-expand-proxy"
      >
        <span className="method-badge-put">ANY</span>
        <span className="font-mono text-xs sm:text-sm font-medium text-foreground flex-1">/{endpoint || "custom"}</span>
        <span className="hidden sm:block text-xs text-muted-foreground">Raw Proxy (advanced)</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border bg-background/50">
          <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border/60">
            Forward any raw request to <span className="font-mono text-xs bg-muted px-1 rounded">chat.qwen.ai/api/v2</span>. Token opsional — jika dikosongkan akan menggunakan keyless headers otomatis.
          </div>

          <div className="px-3 sm:px-5 pt-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Parameters</h3>
              <button onClick={handleClear} className="text-xs px-3 py-1 border border-destructive/60 text-destructive rounded hover:bg-destructive/5 transition-colors">Cancel</button>
            </div>

            <div className="border border-border rounded-md overflow-hidden">
              <div className="hidden sm:grid sm:grid-cols-[200px_1fr] bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div className="px-4 py-2 border-r border-border">Name</div>
                <div className="px-4 py-2">Description</div>
              </div>

              {[
                { name: "token", label: "token", type: "password", value: token, onChange: setToken, desc: "Bearer token (optional — leave blank to use keyless mode)", placeholder: "Paste your session token, or leave blank" },
              ].map(f => (
                <div key={f.name} className="border-t border-border bg-white flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                  <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-white">
                    <div className="font-mono text-sm font-semibold">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">string (header)</div>
                    <div className="text-[11px] text-muted-foreground">(optional)</div>
                  </div>
                  <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                    <div className="text-xs sm:text-sm text-muted-foreground">{f.desc}</div>
                    <input
                      data-testid={`input-proxy-${f.name}`}
                      type={f.type}
                      value={f.value}
                      onChange={e => f.onChange(e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                    />
                  </div>
                </div>
              ))}

              <div className="border-t border-border bg-muted/20 flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-muted/20">
                  <div className="font-mono text-sm font-semibold">method</div>
                  <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">string (meta)</div>
                </div>
                <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                  <div className="text-xs sm:text-sm text-muted-foreground">HTTP method</div>
                  <select value={method} onChange={e => setMethod(e.target.value)} data-testid="input-proxy-method" className="w-full border border-border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors">
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-border bg-white flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-white">
                  <div className="font-mono text-sm font-semibold">endpoint</div>
                  <div className="text-[11px] text-destructive font-semibold mt-0.5">* required</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">string (path)</div>
                </div>
                <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                  <div className="text-xs sm:text-sm text-muted-foreground">Path relative to <span className="font-mono text-xs">chat.qwen.ai/api/v2/</span></div>
                  <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="chat/completions" data-testid="input-proxy-endpoint" className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors" />
                </div>
              </div>

              <div className="border-t border-border bg-muted/20 flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                <div className="px-3 sm:px-4 py-2 sm:py-3 sm:border-r sm:border-border border-b border-border/40 sm:border-b-0 bg-muted/30 sm:bg-muted/20">
                  <div className="font-mono text-sm font-semibold">body</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">object (body)</div>
                  <div className="text-[11px] text-muted-foreground">(optional)</div>
                </div>
                <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-1.5">
                  <div className="text-xs sm:text-sm text-muted-foreground">Raw JSON request body</div>
                  <textarea value={payload} onChange={e => setPayload(e.target.value)} rows={6} data-testid="input-proxy-body" className="w-full border border-border rounded px-3 py-2 text-sm font-mono bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors" spellCheck={false} />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-4 pb-4">
              <button onClick={handleExecute} disabled={proxyRequest.isPending} data-testid="btn-execute-proxy" className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-white text-sm font-semibold rounded hover:bg-primary/90 disabled:opacity-60 transition-colors">
                {proxyRequest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Execute
              </button>
              <button onClick={handleClear} data-testid="btn-clear-proxy" className="flex-1 sm:flex-none px-6 py-2.5 border border-border text-sm font-semibold rounded hover:bg-muted transition-colors">Clear</button>
            </div>
          </div>

          {showResponse && (
            <ResponseSection res={response} isPending={proxyRequest.isPending} endpoint={endpoint} curlStr={curlStr} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function Playground() {
  const { data: stats } = useGetStats({}, { query: { queryKey: getGetStatsQueryKey() } });

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="bg-card border-b border-border px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold text-foreground">Qwen Chat API</h1>
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded font-semibold shrink-0">Keyless</span>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs px-2 py-0.5 bg-primary text-white rounded font-medium shrink-0">v2</span>
              <span className="text-xs sm:text-sm text-muted-foreground font-mono truncate">https://chat.qwen.ai/api/v2</span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 hidden sm:block">
              API gateway wrapper — tidak butuh token atau login. Gunakan langsung.
            </p>
          </div>
          {stats && (
            <div className="flex gap-4 text-center shrink-0">
              <div><div className="font-semibold text-sm sm:text-base">{stats.totalRequests}</div><div className="text-[11px] text-muted-foreground">Requests</div></div>
              <div><div className="font-semibold text-sm sm:text-base text-green-600">{stats.totalRequests ? Math.round((stats.successCount / stats.totalRequests) * 100) : 0}%</div><div className="text-[11px] text-muted-foreground">Success</div></div>
              <div><div className="font-semibold text-sm sm:text-base">{stats.avgResponseTime}ms</div><div className="text-[11px] text-muted-foreground">Avg latency</div></div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
        <KeylessChatBlock />
        <RawProxyBlock />
      </div>
    </div>
  );
}

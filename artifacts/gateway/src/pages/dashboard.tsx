import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Trash2, Copy, Check, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, getUser } from "@/lib/auth";
import { format } from "date-fns";

interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  created_at: string;
  last_used_at: string | null;
  usage_count: number;
}

interface NewKeyResult extends ApiKeyInfo {
  key: string;
}

function maskKey(prefix: string, suffix: string): string {
  return `${prefix}${"*".repeat(12)}${suffix}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button onClick={copy} className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function NewKeyBanner({ keyData, onDismiss }: { keyData: NewKeyResult; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
          <Key className="w-4 h-4 text-green-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-green-900 text-sm mb-1">API key created — save it now!</div>
          <div className="text-xs text-green-700 mb-2">This is the only time the full key will be shown. Copy and store it securely.</div>
          <div className="flex items-center gap-2 bg-white border border-green-200 rounded-lg px-3 py-2">
            <code className="text-sm font-mono text-foreground flex-1 break-all select-all">
              {visible ? keyData.key : maskKey(keyData.prefix, keyData.suffix)}
            </code>
            <button onClick={() => setVisible(p => !p)} className="p-1 text-muted-foreground hover:text-foreground shrink-0">
              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <CopyButton text={keyData.key} />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { navigator.clipboard.writeText(keyData.key); toast.success("Copied!"); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white text-xs font-semibold rounded-lg hover:bg-green-800 transition-colors"
            >
              <Copy className="w-3 h-3" /> Copy key
            </button>
            <button onClick={onDismiss} className="px-3 py-1.5 border border-green-300 text-green-800 text-xs font-semibold rounded-lg hover:bg-green-100 transition-colors">
              I've saved it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const user = getUser();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const res = await apiFetch("/api/apikeys");
      if (res.ok) setKeys(await res.json() as ApiKeyInfo[]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadKeys(); }, [loadKeys]);

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await apiFetch("/api/apikeys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName || "My API Key" }),
      });
      const data = await res.json() as NewKeyResult & { error?: string };
      if (!res.ok) { toast.error(data.error ?? "Failed to create key"); return; }
      setNewKey(data);
      setNewKeyName("");
      setShowForm(false);
      await loadKeys();
    } catch {
      toast.error("Connection error");
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string, name: string) => {
    if (!confirm(`Revoke API key "${name}"? This cannot be undone.`)) return;
    setRevoking(id);
    try {
      const res = await apiFetch(`/api/apikeys/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("API key revoked");
        setKeys(k => k.filter(x => x.id !== id));
        if (newKey?.id === id) setNewKey(null);
      } else {
        const d = await res.json() as { error?: string };
        toast.error(d.error ?? "Failed to revoke key");
      }
    } catch {
      toast.error("Connection error");
    } finally {
      setRevoking(null);
    }
  };

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const firstKey = newKey ?? keys[0];
  const codeSnippet = firstKey
    ? `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${firstKey.key ?? maskKey(firstKey.prefix, firstKey.suffix)}",
  baseURL: "https://${window.location.host}${BASE}/v1",
});

const response = await client.chat.completions.create({
  model: "qwen3-235b-a22b",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);`
    : `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-dzcx...",
  baseURL: "https://${window.location.host}${BASE}/v1",
});`;

  const curlSnippet = firstKey
    ? `curl https://${window.location.host}${BASE}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${firstKey.key ?? maskKey(firstKey.prefix, firstKey.suffix)}" \\
  -d '{
    "model": "qwen3-235b-a22b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`
    : "";

  return (
    <div className="flex-1 flex flex-col overflow-auto bg-background">
      <div className="bg-card border-b border-border px-4 sm:px-6 py-4">
        <h1 className="text-lg sm:text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Welcome back, <span className="font-medium text-foreground">{user?.name}</span>
        </p>
      </div>

      <div className="flex-1 p-3 sm:p-6 max-w-4xl mx-auto w-full space-y-6">
        {/* New key banner */}
        {newKey && <NewKeyBanner keyData={newKey} onDismiss={() => setNewKey(null)} />}

        {/* API Keys card */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
            <div>
              <h2 className="font-semibold text-foreground">API Keys</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage your secret API keys</p>
            </div>
            <button
              onClick={() => setShowForm(p => !p)}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New key</span>
            </button>
          </div>

          {showForm && (
            <form onSubmit={createKey} className="px-4 sm:px-6 py-4 border-b border-border bg-muted/30 flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="block text-xs font-medium text-foreground mb-1">Key name (optional)</label>
                <input
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  placeholder="e.g. Production, Development"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  Generate
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 border border-border text-sm rounded-lg hover:bg-muted transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Key className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm font-medium">No API keys yet</p>
              <p className="text-xs mt-1">Create your first key to start using the gateway</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map(k => (
                <div key={k.id} className="flex items-center gap-3 px-4 sm:px-6 py-4 bg-white hover:bg-muted/20 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Key className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{k.name}</span>
                      {newKey?.id === k.id && (
                        <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">New</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-xs font-mono text-muted-foreground">{maskKey(k.prefix, k.suffix)}</code>
                      <CopyButton text={maskKey(k.prefix, k.suffix)} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                      <span>Created {format(new Date(k.created_at), "MMM d, yyyy")}</span>
                      {k.last_used_at && <span>Last used {format(new Date(k.last_used_at), "MMM d")}</span>}
                      <span>{k.usage_count} requests</span>
                    </div>
                  </div>
                  <button
                    onClick={() => revokeKey(k.id, k.name)}
                    disabled={revoking === k.id}
                    className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/5 transition-colors shrink-0"
                    title="Revoke key"
                  >
                    {revoking === k.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick start */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Quick start</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Compatible with OpenAI SDK — just change the base URL</p>
          </div>
          <div className="p-4 sm:p-6 space-y-4">
            {!firstKey && (
              <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Create an API key above to see your personalized code snippet
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node.js / TypeScript</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(codeSnippet); toast.success("Copied!"); }}
                  className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">{codeSnippet}</pre>
            </div>

            {curlSnippet && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">cURL</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(curlSnippet); toast.success("Copied!"); }}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </div>
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">{curlSnippet}</pre>
              </div>
            )}

            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-1.5">
              <div className="font-semibold text-foreground text-xs uppercase tracking-wider mb-2">Available models</div>
              {["qwen3-235b-a22b", "qwen3.7-max", "qwen3-30b-a3b"].map(m => (
                <div key={m} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  <code className="text-xs font-mono text-foreground">{m}</code>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { Copy, Check, ChevronRight, ArrowRight, Zap, Shield, Globe, Code2, Layers, Infinity, Menu, X } from "lucide-react";

const MODELS = [
  { id: "qwen3.7-max",                label: "Qwen3.7 Max",         badge: "Flagship",  color: "#a78bfa" },
  { id: "qwen3.6-plus",               label: "Qwen3.6 Plus",        badge: "Multimodal",color: "#f472b6" },
  { id: "qwen3.6-max-preview",        label: "Qwen3.6 Max Preview", badge: "Preview",   color: "#fbbf24" },
  { id: "qwen3-235b-a22b",            label: "Qwen3 235B-A22B",     badge: "235B",      color: "#34d399" },
  { id: "qwen3-30b-a3b",              label: "Qwen3 30B-A3B",       badge: "Fast",      color: "#38bdf8" },
  { id: "qwen-max-latest",            label: "Qwen Max Latest",     badge: "Latest",    color: "#818cf8" },
  { id: "qwen-turbo-latest",          label: "Qwen Turbo",          badge: "Turbo",     color: "#fb923c" },
  { id: "qwen2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B",  badge: "Code",      color: "#2dd4bf" },
];

const FEATURES = [
  { icon: <Zap className="w-4 h-4" />,     label: "Automatic retries" },
  { icon: <Shield className="w-4 h-4" />,   label: "One API key" },
  { icon: <Layers className="w-4 h-4" />,   label: "8 Qwen models" },
  { icon: <Code2 className="w-4 h-4" />,    label: "OpenAI SDK compatible" },
  { icon: <Globe className="w-4 h-4" />,    label: "Streaming support" },
  { icon: <Infinity className="w-4 h-4" />, label: "50 MB payload limit" },
];

const CURL_SNIPPET = (base: string) => `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.7-max",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`;

const PYTHON_SNIPPET = (base: string) => `from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="${base}/v1"
)

response = client.chat.completions.create(
    model="qwen3.7-max",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`;

const NODE_SNIPPET = (base: string) => `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "YOUR_API_KEY",
  baseURL: "${base}/v1",
});

const response = await client.chat.completions.create({
  model: "qwen3.7-max",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);`;

function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const stars: { x: number; y: number; r: number; o: number; speed: number }[] = [];
    for (let i = 0; i < 160; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.2,
        o: Math.random() * 0.7 + 0.15,
        speed: Math.random() * 0.3 + 0.05,
      });
    }

    let frame = 0;
    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      for (const s of stars) {
        const flicker = s.o + Math.sin(frame * s.speed * 0.08 + s.x) * 0.18;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, flicker))})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.55 }}
    />
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="absolute top-3 right-3 p-1.5 rounded-md transition-colors"
      style={{ background: "rgba(255,255,255,0.07)", color: copied ? "#34d399" : "rgba(255,255,255,0.4)" }}
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

export default function Landing() {
  const [base, setBase] = useState("https://your-domain.com");
  const [tab, setTab] = useState<"Python" | "Node.js" | "cURL">("Python");
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => { setBase(window.location.origin); }, []);

  const snippets: Record<string, string> = {
    Python: PYTHON_SNIPPET(base),
    "Node.js": NODE_SNIPPET(base),
    cURL: CURL_SNIPPET(base),
  };

  return (
    <div style={{ background: "#08080f", color: "#fff", fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh" }}>

      {/* ── Announcement bar ─────────────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(90deg,#1a0533,#0a1a3a,#1a0533)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "9px 16px", textAlign: "center", fontSize: "0.78rem", color: "rgba(255,255,255,0.65)" }}>
        <span style={{ color: "#a78bfa", fontWeight: 600 }}>8 Qwen models</span> available · OpenAI-compatible · Works with any SDK
        <Link href="/register" style={{ marginLeft: 12, color: "#34d399", fontWeight: 600, textDecoration: "none" }}>Get started →</Link>
      </div>

      {/* ── Navbar ───────────────────────────────────────────────────────── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(8,8,15,0.85)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#2563eb)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", fontWeight: 800, color: "#fff" }}>D</div>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#fff" }}>Dzeck API AI</span>
        </div>
        <div className="hidden md:flex" style={{ gap: 28, fontSize: "0.85rem", color: "rgba(255,255,255,0.55)" }}>
          <a href="#models" style={{ color: "inherit", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color="#fff")} onMouseLeave={e => (e.currentTarget.style.color="rgba(255,255,255,0.55)")}>Models</a>
          <a href="#quickstart" style={{ color: "inherit", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color="#fff")} onMouseLeave={e => (e.currentTarget.style.color="rgba(255,255,255,0.55)")}>Quickstart</a>
          <a href="#features" style={{ color: "inherit", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color="#fff")} onMouseLeave={e => (e.currentTarget.style.color="rgba(255,255,255,0.55)")}>Features</a>
        </div>
        <div className="hidden md:flex" style={{ gap: 10, alignItems: "center" }}>
          <Link href="/login" style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", textDecoration: "none", padding: "6px 14px", borderRadius: 8, transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color="#fff")} onMouseLeave={e => (e.currentTarget.style.color="rgba(255,255,255,0.6)")}>Sign in</Link>
          <Link href="/register" style={{ fontSize: "0.85rem", fontWeight: 600, color: "#08080f", background: "#fff", borderRadius: 20, padding: "7px 18px", textDecoration: "none", transition: "opacity 0.15s" }} onMouseEnter={e => (e.currentTarget.style.opacity="0.9")} onMouseLeave={e => (e.currentTarget.style.opacity="1")}>Get started</Link>
        </div>
        <button className="md:hidden" onClick={() => setMobileMenu(v => !v)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", padding: 4 }}>
          {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </nav>

      {/* mobile menu */}
      {mobileMenu && (
        <div style={{ background: "#0f0f1c", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16, fontSize: "0.9rem" }}>
          <a href="#models" onClick={() => setMobileMenu(false)} style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Models</a>
          <a href="#quickstart" onClick={() => setMobileMenu(false)} style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Quickstart</a>
          <a href="#features" onClick={() => setMobileMenu(false)} style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Features</a>
          <div style={{ display: "flex", gap: 10, paddingTop: 8 }}>
            <Link href="/login" style={{ flex: 1, textAlign: "center", padding: "9px", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: "0.85rem" }}>Sign in</Link>
            <Link href="/register" style={{ flex: 1, textAlign: "center", padding: "9px", background: "#fff", borderRadius: 10, color: "#08080f", textDecoration: "none", fontWeight: 600, fontSize: "0.85rem" }}>Get started</Link>
          </div>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{ position: "relative", overflow: "hidden", paddingTop: 100, paddingBottom: 100, textAlign: "center" }}>
        <StarField />
        {/* Glow blobs */}
        <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: 700, height: 400, background: "radial-gradient(ellipse,rgba(124,58,237,0.12) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 0, left: "30%", width: 400, height: 300, background: "radial-gradient(ellipse,rgba(37,99,235,0.09) 0%,transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", maxWidth: 700, margin: "0 auto", padding: "0 20px" }}>
          {/* pill badge */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 99, padding: "6px 16px", marginBottom: 32, fontSize: "0.78rem", color: "rgba(255,255,255,0.6)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", display: "inline-block", boxShadow: "0 0 6px #34d399" }} />
            Supporting 8 Qwen models · OpenAI-compatible
          </div>

          <h1 style={{ fontSize: "clamp(2.2rem, 6vw, 3.8rem)", fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.03em", marginBottom: 24, color: "#fff" }}>
            One API.{" "}
            <span style={{ background: "linear-gradient(135deg,#34d399,#38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Every Qwen Model.
            </span>
          </h1>

          <p style={{ fontSize: "1.05rem", color: "rgba(255,255,255,0.45)", lineHeight: 1.7, maxWidth: 480, margin: "0 auto 40px", fontWeight: 400 }}>
            One endpoint, all Qwen models. Switch models instantly — no lock-in.
            Drop-in replacement for any OpenAI-compatible client.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 52 }}>
            <Link href="/register" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: "#08080f", padding: "13px 28px", borderRadius: 12, fontWeight: 700, fontSize: "0.9rem", textDecoration: "none", boxShadow: "0 0 30px rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: "1rem" }}>⚡</span> Go to Dashboard
            </Link>
            <a href="#quickstart" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)", padding: "13px 28px", borderRadius: 12, fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}>
              Documentation <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Feature badges row */}
          <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
            {FEATURES.map(f => (
              <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>
                <span style={{ color: "rgba(255,255,255,0.3)" }}>{f.icon}</span>
                {f.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Code block ───────────────────────────────────────────────────── */}
      <section id="quickstart" style={{ padding: "0 20px 80px", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16, overflow: "hidden", background: "#0d0d1c" }}>
          {/* window chrome */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 12, background: "#0f0f20" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57", display: "block" }} />
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e", display: "block" }} />
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840", display: "block" }} />
            </div>
            <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
              {(["Python", "Node.js", "cURL"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{ padding: "4px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, transition: "all 0.15s", background: tab === t ? "rgba(255,255,255,0.12)" : "transparent", color: tab === t ? "#fff" : "rgba(255,255,255,0.35)" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ position: "relative", padding: "22px 24px" }}>
            <CopyBtn text={snippets[tab]} />
            <pre style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.7, color: "#c9d1d9", fontFamily: "'JetBrains Mono','Fira Code',Menlo,monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", overflowX: "auto" }}>
              {snippets[tab]}
            </pre>
          </div>
        </div>
        {/* base URL */}
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.3)", marginRight: 6 }}>base_url</span>
          <code style={{ fontSize: "0.78rem", color: "#34d399", fontFamily: "monospace" }}>{base}/v1</code>
        </div>
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent)", maxWidth: 700, margin: "0 auto" }} />

      {/* ── Models ───────────────────────────────────────────────────────── */}
      <section id="models" style={{ padding: "72px 20px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", color: "#fff", marginBottom: 12 }}>Available Models</h2>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.95rem", maxWidth: 500, margin: "0 auto" }}>
            All models accessible via a single endpoint. Use exact IDs or common aliases like{" "}
            <code style={{ color: "#34d399", fontFamily: "monospace" }}>qwen-max</code>,{" "}
            <code style={{ color: "#34d399", fontFamily: "monospace" }}>qwen-plus</code>.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 12 }}>
          {MODELS.map(m => (
            <div key={m.id} style={{ background: "#0f0f1c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "16px 18px", transition: "border-color 0.2s,background 0.2s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)"; (e.currentTarget as HTMLDivElement).style.background = "#13131f"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLDivElement).style.background = "#0f0f1c"; }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "#fff" }}>{m.label}</span>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 99, color: m.color, background: `${m.color}18`, border: `1px solid ${m.color}30` }}>{m.badge}</span>
              </div>
              <code style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.3)", fontFamily: "monospace", wordBreak: "break-all" }}>{m.id}</code>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: "0 20px 80px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent)", marginBottom: 72 }} />
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", color: "#fff", marginBottom: 12 }}>Everything you need</h2>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.95rem" }}>Built for developers running autonomous AI agents and production workloads.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
          {[
            { icon: <Code2 className="w-5 h-5" />, title: "OpenAI-Compatible API", desc: "Drop-in replacement for OpenAI. Works with Python SDK, Node.js, LangChain, AutoGen, and more.", color: "#818cf8" },
            { icon: <Layers className="w-5 h-5" />, title: "8 Qwen Models", desc: "From lightweight Turbo to the flagship 235B. One endpoint, all models, no SDK switching.", color: "#34d399" },
            { icon: <Zap className="w-5 h-5" />, title: "Smart Alias Routing", desc: "Use familiar names like qwen-plus or qwen-max — automatically routed to the best available model.", color: "#fbbf24" },
            { icon: <Shield className="w-5 h-5" />, title: "API Key Auth", desc: "Secure access with API keys. Create, revoke, and manage keys from your dashboard.", color: "#f472b6" },
            { icon: <Globe className="w-5 h-5" />, title: "SSE Streaming", desc: "Full server-sent events streaming for real-time token-by-token output in any application.", color: "#38bdf8" },
            { icon: <Infinity className="w-5 h-5" />, title: "50 MB Payload Limit", desc: "Designed for AI agents sending long conversation histories and large tool results.", color: "#fb923c" },
          ].map(f => (
            <div key={f.title} style={{ background: "#0f0f1c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "24px", transition: "border-color 0.2s" }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.13)"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)"}
            >
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${f.color}15`, border: `1px solid ${f.color}25`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, color: f.color }}>
                {f.icon}
              </div>
              <h3 style={{ fontWeight: 700, fontSize: "0.95rem", color: "#fff", marginBottom: 8 }}>{f.title}</h3>
              <p style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.38)", lineHeight: 1.65 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section style={{ padding: "72px 20px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center,rgba(124,58,237,0.08) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", maxWidth: 540, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(1.8rem,4vw,2.8rem)", fontWeight: 800, letterSpacing: "-0.03em", color: "#fff", marginBottom: 16 }}>Ready to build?</h2>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "1rem", marginBottom: 36, lineHeight: 1.6 }}>
            Free to get started. Works with every OpenAI-compatible library. No configuration required.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/register" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: "#08080f", padding: "13px 28px", borderRadius: 12, fontWeight: 700, fontSize: "0.9rem", textDecoration: "none" }}>
              Create free account <ChevronRight className="w-4 h-4" />
            </Link>
            <Link href="/login" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)", padding: "13px 28px", borderRadius: 12, fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "28px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: "linear-gradient(135deg,#7c3aed,#2563eb)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 800, color: "#fff" }}>D</div>
          <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fff" }}>Dzeck API AI</span>
        </div>
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.25)" }}>
          base_url: <code style={{ color: "rgba(52,211,153,0.7)", fontFamily: "monospace" }}>{base}/v1</code>
        </div>
        <div style={{ display: "flex", gap: 20, fontSize: "0.8rem" }}>
          <Link href="/login" style={{ color: "rgba(255,255,255,0.35)", textDecoration: "none" }}>Sign in</Link>
          <Link href="/register" style={{ color: "rgba(255,255,255,0.35)", textDecoration: "none" }}>Register</Link>
        </div>
      </footer>

    </div>
  );
}

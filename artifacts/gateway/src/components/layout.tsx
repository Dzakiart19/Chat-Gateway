import { Link, useLocation } from "wouter";
import { LayoutGrid, History, BarChart3, Activity, Server } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  const isHealthy = health?.status === "ok";

  const navItems = [
    { href: "/", label: "API Playground", icon: LayoutGrid },
    { href: "/history", label: "Request History", icon: History },
    { href: "/stats", label: "Statistics", icon: BarChart3 },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-card flex flex-col shrink-0">
        <div className="h-16 flex items-center px-4 border-b border-border gap-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Server className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="font-semibold text-sm leading-tight text-foreground">Qwen Gateway</div>
            <div className="text-[11px] text-muted-foreground leading-tight">API Wrapper v2</div>
          </div>
        </div>

        <nav className="flex-1 py-3 px-3 flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                    active
                      ? "bg-accent text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2">
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span>Gateway status</span>
            <div className={`ml-auto w-2 h-2 rounded-full ${isHealthy ? "bg-green-500" : "bg-red-400"}`} />
          </div>
          <div className="text-[11px] text-muted-foreground px-3 pb-1 leading-tight">
            chat.qwen.ai/api/v2
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}

import { Link, useLocation } from "wouter";
import { Terminal, History, BarChart3, Activity } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const { data: health } = useHealthCheck();

  const isHealthy = health?.status === "ok";

  const navItems = [
    { href: "/", label: "Playground", icon: Terminal },
    { href: "/history", label: "History", icon: History },
    { href: "/stats", label: "Stats", icon: BarChart3 },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30">
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <div className="font-mono font-bold tracking-tight flex items-center gap-2 text-primary">
            <Terminal className="w-5 h-5" />
            <span>QWEN_GATEWAY</span>
          </div>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
          {navItems.map((item) => {
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <Activity className="w-4 h-4" />
            <span>SYSTEM_STATUS</span>
            <div className={`ml-auto w-2 h-2 rounded-full ${isHealthy ? 'bg-primary shadow-[0_0_8px_hsl(var(--primary))]' : 'bg-destructive'}`} />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}

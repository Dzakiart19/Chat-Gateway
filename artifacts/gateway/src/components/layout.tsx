import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutGrid, History, BarChart3, Activity, Server, Menu, X } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

const navItems = [
  { href: "/", label: "API Playground", icon: LayoutGrid },
  { href: "/history", label: "Request History", icon: History },
  { href: "/stats", label: "Statistics", icon: BarChart3 },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: health } = useHealthCheck();
  const isHealthy = health?.status === "ok";

  const NavLinks = ({ onNav }: { onNav?: () => void }) => (
    <>
      {navItems.map((item) => {
        const active = location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <div
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={onNav}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors cursor-pointer ${
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
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 border-r border-border bg-card flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-border gap-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Server className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="font-semibold text-sm leading-tight text-foreground">Qwen Gateway</div>
            <div className="text-[11px] text-muted-foreground leading-tight">API Wrapper v2</div>
          </div>
        </div>

        <nav className="flex-1 py-3 px-3 flex flex-col gap-0.5">
          <NavLinks />
        </nav>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5">
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span>Gateway status</span>
            <div className={`ml-auto w-2 h-2 rounded-full ${isHealthy ? "bg-green-500" : "bg-red-400"}`} />
          </div>
          <div className="text-[11px] text-muted-foreground px-3 pb-1">chat.qwen.ai/api/v2</div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col md:hidden transform transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
              <Server className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-semibold text-sm leading-tight">Qwen Gateway</div>
              <div className="text-[11px] text-muted-foreground leading-tight">API Wrapper v2</div>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <nav className="flex-1 py-3 px-3 flex flex-col gap-0.5">
          <NavLinks onNav={() => setMobileOpen(false)} />
        </nav>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5">
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span>Gateway status</span>
            <div className={`ml-auto w-2 h-2 rounded-full ${isHealthy ? "bg-green-500" : "bg-red-400"}`} />
          </div>
          <div className="text-[11px] text-muted-foreground px-3 pb-1">chat.qwen.ai/api/v2</div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden h-14 flex items-center gap-3 px-4 border-b border-border bg-card shrink-0">
          <button
            data-testid="btn-mobile-menu"
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-md hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <Server className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm">Qwen Gateway</span>
          </div>
        </div>

        <main className="flex-1 overflow-auto flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}

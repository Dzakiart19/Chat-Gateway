import { useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { Activity, Clock, Zap, AlertTriangle, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Stats() {
  const { data: stats, isLoading } = useGetStats({}, { query: { queryKey: getGetStatsQueryKey() }});

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col h-full bg-background items-center justify-center">
        <div className="animate-pulse font-mono text-primary text-xl tracking-wider">CALCULATING_TELEMETRY...</div>
      </div>
    );
  }

  const successRate = stats?.totalRequests ? Math.round((stats.successCount / stats.totalRequests) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-auto">
      <header className="h-14 border-b border-border flex items-center px-6 shrink-0 bg-card">
        <h1 className="text-lg font-mono font-medium">/stats</h1>
      </header>

      <div className="p-8 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          
          {/* Total Requests */}
          <div className="p-6 border border-border bg-card rounded-lg relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Activity className="w-16 h-16" />
            </div>
            <div className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-2">Total Req</div>
            <div className="text-4xl font-mono font-bold text-foreground">
              {stats?.totalRequests || 0}
            </div>
          </div>

          {/* Success Rate */}
          <div className="p-6 border border-primary/30 bg-primary/5 rounded-lg relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Zap className="w-16 h-16 text-primary" />
            </div>
            <div className="text-sm font-mono text-primary uppercase tracking-wider mb-2">Success Rate</div>
            <div className="text-4xl font-mono font-bold text-primary">
              {successRate}%
            </div>
          </div>

          {/* Avg Response Time */}
          <div className="p-6 border border-border bg-card rounded-lg relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Clock className="w-16 h-16" />
            </div>
            <div className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-2">Avg Latency</div>
            <div className="text-4xl font-mono font-bold text-foreground">
              {stats?.avgResponseTime ? Math.round(stats.avgResponseTime) : 0}ms
            </div>
          </div>

          {/* Failures */}
          <div className="p-6 border border-destructive/30 bg-destructive/5 rounded-lg relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <AlertTriangle className="w-16 h-16 text-destructive" />
            </div>
            <div className="text-sm font-mono text-destructive uppercase tracking-wider mb-2">Failures</div>
            <div className="text-4xl font-mono font-bold text-destructive">
              {stats?.failureCount || 0}
            </div>
          </div>

        </div>

        <div className="border border-border bg-sidebar rounded-lg p-6">
          <h2 className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4 border-b border-border pb-2">System Info</h2>
          <div className="space-y-3 font-mono text-sm">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Gateway Status</span>
              <span className="text-primary font-bold">ONLINE</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Last Request</span>
              <span className="text-foreground">
                {stats?.lastRequestAt ? format(new Date(stats.lastRequestAt), "yyyy-MM-dd HH:mm:ss") : "N/A"}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">Target API</span>
              <span className="text-foreground">chat.qwen.ai/api/v2</span>
            </div>
          </div>

          <div className="mt-8">
            <Link href="/history">
              <Button variant="outline" className="w-full font-mono border-border bg-background hover:bg-muted hover:text-foreground">
                VIEW FULL LOGS <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}

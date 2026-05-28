import { useGetHistory, getGetHistoryQueryKey, useClearHistory } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trash2, AlertCircle, CheckCircle2, ChevronRight, ChevronDown, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import {
  Table,
  Body,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"; // Assuming standard shadcn table structure but we'll use raw tags if needed

export default function History() {
  const { data: history, isLoading } = useGetHistory({}, { query: { queryKey: getGetHistoryQueryKey() }});
  const clearHistory = useClearHistory();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleClear = () => {
    if (confirm("Clear all history?")) {
      clearHistory.mutate(undefined, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
        }
      });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-card">
        <h1 className="text-lg font-mono font-medium">/history</h1>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleClear}
          disabled={!history?.length || clearHistory.isPending}
          className="font-mono text-xs border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="w-3 h-3 mr-2" />
          CLEAR LOG
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-pulse font-mono text-primary">LOADING_HISTORY...</div>
          </div>
        ) : !history || history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border border-dashed border-border rounded-md">
            <span className="font-mono">NO_RECORDS_FOUND</span>
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-hidden bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted font-mono text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium border-b border-border w-10"></th>
                  <th className="p-3 font-medium border-b border-border">TIMESTAMP</th>
                  <th className="p-3 font-medium border-b border-border">ENDPOINT</th>
                  <th className="p-3 font-medium border-b border-border">METHOD</th>
                  <th className="p-3 font-medium border-b border-border">STATUS</th>
                  <th className="p-3 font-medium border-b border-border text-right">TIME</th>
                </tr>
              </thead>
              <tbody className="font-mono divide-y divide-border">
                {history.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr 
                        className={`hover:bg-muted/50 cursor-pointer transition-colors ${isExpanded ? 'bg-muted/30' : ''}`}
                        onClick={() => toggleExpand(entry.id)}
                      >
                        <td className="p-3 text-muted-foreground">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {format(new Date(entry.requestedAt), "HH:mm:ss.SSS")}
                        </td>
                        <td className="p-3 text-foreground font-medium truncate max-w-[200px]">
                          /{entry.endpoint}
                        </td>
                        <td className="p-3">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                            {entry.method}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {entry.success ? (
                              <CheckCircle2 className="w-4 h-4 text-primary" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-destructive" />
                            )}
                            <span className={entry.success ? "text-primary" : "text-destructive"}>
                              {entry.statusCode}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-right text-muted-foreground">
                          {entry.responseTime}ms
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-sidebar">
                          <td colSpan={6} className="p-0">
                            <div className="p-4 border-l-4 border-l-primary space-y-4">
                              {entry.error && (
                                <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded">
                                  {entry.error}
                                </div>
                              )}
                              
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Request Payload</div>
                                  <div className="bg-background border border-border p-3 rounded overflow-auto max-h-[300px]">
                                    <pre className="text-xs text-foreground">
                                      {JSON.stringify(entry.requestPayload, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Response Body</div>
                                  <div className="bg-background border border-border p-3 rounded overflow-auto max-h-[300px]">
                                    <pre className="text-xs text-foreground">
                                      {JSON.stringify(entry.responseBody, null, 2) || "Empty"}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Ensure React is imported if needed, but Vite injects it.
import * as React from 'react';

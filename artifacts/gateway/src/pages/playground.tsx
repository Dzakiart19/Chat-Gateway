import { useState, useEffect } from "react";
import { useProxyRequest } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Play, AlertCircle, CheckCircle2, Clock, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function Playground() {
  const [token, setToken] = useState(() => localStorage.getItem("qwen_token") || "");
  const [endpoint, setEndpoint] = useState("chat/completions");
  const [method, setMethod] = useState("POST");
  const [payload, setPayload] = useState(JSON.stringify({
    model: "qwen-plus",
    messages: [{ role: "user", content: "Hello! What's 2+2?" }],
    stream: false
  }, null, 2));
  
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsPayload, setToolsPayload] = useState("[]");
  
  const [response, setResponse] = useState<any>(null);
  const [requestLog, setRequestLog] = useState<any>(null);

  const proxyRequest = useProxyRequest();

  useEffect(() => {
    localStorage.setItem("qwen_token", token);
  }, [token]);

  const handleSend = () => {
    if (!token) {
      toast.error("Authentication token is required");
      return;
    }

    let parsedPayload;
    try {
      parsedPayload = JSON.parse(payload);
    } catch (e) {
      toast.error("Invalid JSON payload");
      return;
    }

    let parsedTools;
    if (toolsOpen && toolsPayload && toolsPayload !== "[]") {
      try {
        parsedTools = JSON.parse(toolsPayload);
        parsedPayload.tools = parsedTools;
      } catch (e) {
        toast.error("Invalid tools JSON");
        return;
      }
    }

    setRequestLog(parsedPayload);
    setResponse(null);

    proxyRequest.mutate({
      data: {
        token,
        endpoint,
        method,
        payload: parsedPayload
      }
    }, {
      onSuccess: (data) => {
        setResponse(data);
      },
      onError: (err) => {
        toast.error("Request failed");
        setResponse({ error: "Failed to connect to gateway", details: String(err) });
      }
    });
  };

  const addToolTemplate = () => {
    const template = [
      {
        type: "function",
        function: {
          name: "get_current_weather",
          description: "Get the current weather in a given location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city and state, e.g. San Francisco, CA"
              },
              unit: {
                type: "string",
                enum: ["celsius", "fahrenheit"]
              }
            },
            required: ["location"]
          }
        }
      }
    ];
    setToolsPayload(JSON.stringify(template, null, 2));
    setToolsOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <header className="h-14 border-b border-border flex items-center px-6 shrink-0 bg-card">
        <h1 className="text-lg font-mono font-medium">/playground</h1>
      </header>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Editor */}
        <div className="w-1/2 flex flex-col border-r border-border overflow-y-auto bg-background">
          <div className="p-6 flex flex-col gap-6">
            
            <div className="space-y-2">
              <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Authentication</Label>
              <div className="flex gap-2">
                <Input 
                  type="password"
                  placeholder="Bearer sk-..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-32 space-y-2">
                <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-2">
                <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Endpoint</Label>
                <Input 
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="font-mono text-sm"
                  placeholder="chat/completions"
                />
              </div>
            </div>

            <div className="space-y-2 flex-1 flex flex-col">
              <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Payload (JSON)</Label>
              <Textarea 
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                className="font-mono text-sm min-h-[240px] resize-y bg-card border-border"
                spellCheck={false}
              />
            </div>

            <Collapsible open={toolsOpen} onOpenChange={setToolsOpen} className="border border-border rounded-md bg-card">
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 font-mono text-sm hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  {toolsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span>Tools Configuration</span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="p-3 pt-0 border-t border-border">
                <div className="flex justify-end mb-2 mt-2">
                  <Button variant="outline" size="sm" onClick={addToolTemplate} className="h-7 text-xs font-mono">
                    Insert Template
                  </Button>
                </div>
                <Textarea 
                  value={toolsPayload}
                  onChange={(e) => setToolsPayload(e.target.value)}
                  className="font-mono text-sm min-h-[160px] bg-background border-border"
                  spellCheck={false}
                />
              </CollapsibleContent>
            </Collapsible>

            <div className="pt-2">
              <Button 
                onClick={handleSend} 
                disabled={proxyRequest.isPending}
                className="w-full font-mono font-bold tracking-wider"
              >
                {proxyRequest.isPending ? "SENDING..." : (
                  <>
                    <Play className="w-4 h-4 mr-2" /> SEND REQUEST
                  </>
                )}
              </Button>
            </div>

          </div>
        </div>

        {/* Right Column: Response */}
        <div className="w-1/2 flex flex-col bg-sidebar">
          {(!response && !requestLog && !proxyRequest.isPending) ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
              <Terminal className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-mono text-sm">Waiting for request...</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {proxyRequest.isPending && !response && (
                <div className="h-full flex items-center justify-center">
                  <div className="flex items-center gap-3 text-primary font-mono animate-pulse">
                    <span className="w-2 h-2 bg-primary rounded-full" />
                    <span>AWAITING RESPONSE</span>
                  </div>
                </div>
              )}

              {response && (
                <div className="p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-border pb-4">
                    <div className="flex items-center gap-3">
                      {response.success ? (
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-destructive" />
                      )}
                      <span className="font-mono text-lg font-bold">
                        {response.statusCode || "ERR"}
                      </span>
                      <Badge variant={response.success ? "default" : "destructive"} className="font-mono rounded-sm">
                        {response.success ? "SUCCESS" : "FAILED"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground font-mono text-sm">
                      <Clock className="w-4 h-4" />
                      <span>{response.responseTime}ms</span>
                    </div>
                  </div>

                  {response.error && (
                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-destructive font-mono text-sm whitespace-pre-wrap">
                      {response.error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Request Payload</Label>
                    <div className="p-4 bg-background border border-border rounded-md overflow-x-auto">
                      <pre className="font-mono text-xs text-muted-foreground">
                        {JSON.stringify(requestLog, null, 2)}
                      </pre>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Response Body</Label>
                    <div className="p-4 bg-background border border-border rounded-md overflow-x-auto">
                      <pre className="font-mono text-xs text-foreground">
                        {JSON.stringify(response.responseBody, null, 2) || "No content"}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

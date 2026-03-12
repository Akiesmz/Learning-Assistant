import { useMemo, useRef, useState } from "react";
import { PlugZap, Plug, RefreshCw, Play, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

function parseHeaderJson(text: string): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const parsed = safeJsonParse(text);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v == null) return { ok: true, headers: {} };
  if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: '必须是 JSON 对象，例如 {"Authorization":"Bearer xxx"}' };
  const out: Record<string, string> = {};
  for (const [k, vv] of Object.entries(v)) {
    const key = String(k || "").trim();
    if (!key) continue;
    if (vv == null) continue;
    out[key] = String(vv);
  }
  return { ok: true, headers: out };
}

function safeJsonParse(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function prettyJson(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function parseSseJsonRpc(resp: Response): Promise<{ messages: any[]; raw: string }> {
  if (!resp.body) return { messages: [], raw: "" };
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const messages: any[] = [];
  let raw = "";
  let buf = "";
  let dataLines: string[] = [];
  const flushEvent = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    const parsed = safeJsonParse(data);
    if (parsed.ok) messages.push(parsed.value);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    buf += chunk;
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line === "") {
        flushEvent();
        continue;
      }
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
  }
  flushEvent();
  return { messages, raw };
}

async function parseMcpResponse(resp: Response): Promise<{ messages: any[]; raw: string }> {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/event-stream")) return await parseSseJsonRpc(resp);
  const raw = await resp.text();
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) return { messages: [], raw };
  const val = parsed.value;
  return { messages: Array.isArray(val) ? val : [val], raw };
}

async function mcpPost(opts: {
  url: string;
  sessionId?: string;
  extraHeaders?: Record<string, string>;
  payload: any;
}): Promise<{ sessionId?: string; messages: any[]; raw: string; status: number }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (opts.sessionId) headers["Mcp-Session-Id"] = opts.sessionId;
  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) headers[k] = v;
  }
  const resp = await fetch(opts.url, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.payload),
  });
  const sessionId = resp.headers.get("Mcp-Session-Id") || resp.headers.get("mcp-session-id") || undefined;
  const parsed = await parseMcpResponse(resp);
  return { sessionId, messages: parsed.messages, raw: parsed.raw, status: resp.status };
}

async function mcpDelete(opts: { url: string; sessionId: string; extraHeaders?: Record<string, string> }) {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Mcp-Session-Id": opts.sessionId,
  };
  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) headers[k] = v;
  }
  await fetch(opts.url, {
    method: "DELETE",
    headers,
  });
}

export default function McpDebug() {
  const sameOriginDefault = useMemo(() => `${window.location.origin}/mcp`, []);
  const [mcpUrl, setMcpUrl] = useState<string>(() => {
    try {
      return localStorage.getItem("mcp_debug_url") || "";
    } catch {
      return "";
    }
  });
  const [headersText, setHeadersText] = useState<string>(() => {
    try {
      return localStorage.getItem("mcp_debug_headers") || "{}";
    } catch {
      return "{}";
    }
  });
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [selectedToolName, setSelectedToolName] = useState<string | undefined>(undefined);
  const [argsText, setArgsText] = useState<string>("{}");
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [lastResponseRaw, setLastResponseRaw] = useState<string>("");
  const [lastResponseMessages, setLastResponseMessages] = useState<any[]>([]);
  const requestIdRef = useRef(1);

  const selectedTool = useMemo(() => tools.find((t) => t.name === selectedToolName), [tools, selectedToolName]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    setConnected(false);
    setTools([]);
    setSelectedToolName(undefined);
    setLastRequest(null);
    setLastResponseRaw("");
    setLastResponseMessages([]);
    try {
      if (!mcpUrl.trim()) {
        setError("请输入 MCP URL");
        return;
      }
      const parsedHeaders = parseHeaderJson(headersText);
      if (!parsedHeaders.ok) {
        setError(`请求头 JSON 解析失败：${parsedHeaders.error}`);
        return;
      }
      try {
        localStorage.setItem("mcp_debug_url", mcpUrl);
        localStorage.setItem("mcp_debug_headers", headersText);
      } catch {}
      const initId = requestIdRef.current++;
      const initPayload = {
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "ai-learning-assistant-web", version: "0.0.0" },
        },
      };
      setLastRequest(initPayload);
      const initResp = await mcpPost({ url: mcpUrl, extraHeaders: parsedHeaders.headers, payload: initPayload });
      const newSessionId = initResp.sessionId;
      if (newSessionId) setSessionId(newSessionId);
      setLastResponseRaw(initResp.raw);
      setLastResponseMessages(initResp.messages);

      const initializedPayload = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
      await mcpPost({ url: mcpUrl, sessionId: newSessionId, extraHeaders: parsedHeaders.headers, payload: initializedPayload });

      const listId = requestIdRef.current++;
      const listPayload = { jsonrpc: "2.0", id: listId, method: "tools/list", params: {} };
      setLastRequest(listPayload);
      const listResp = await mcpPost({ url: mcpUrl, sessionId: newSessionId, extraHeaders: parsedHeaders.headers, payload: listPayload });
      setLastResponseRaw(listResp.raw);
      setLastResponseMessages(listResp.messages);

      const msg = listResp.messages.find((m) => m && m.id === listId) || listResp.messages[0];
      const list = (msg?.result?.tools || []) as McpTool[];
      setTools(Array.isArray(list) ? list : []);
      setConnected(true);
    } catch (e: any) {
      setError(String(e?.message || e));
      setConnected(false);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const sid = sessionId;
    setSessionId(undefined);
    setConnected(false);
    setTools([]);
    setSelectedToolName(undefined);
    setLastRequest(null);
    setLastResponseRaw("");
    setLastResponseMessages([]);
    if (sid) {
      try {
        const parsedHeaders = parseHeaderJson(headersText);
        await mcpDelete({ url: mcpUrl, sessionId: sid, extraHeaders: parsedHeaders.ok ? parsedHeaders.headers : undefined });
      } catch {}
    }
  };

  const refreshTools = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsedHeaders = parseHeaderJson(headersText);
      if (!parsedHeaders.ok) {
        setError(`请求头 JSON 解析失败：${parsedHeaders.error}`);
        return;
      }
      const listId = requestIdRef.current++;
      const listPayload = { jsonrpc: "2.0", id: listId, method: "tools/list", params: {} };
      setLastRequest(listPayload);
      const listResp = await mcpPost({ url: mcpUrl, sessionId, extraHeaders: parsedHeaders.headers, payload: listPayload });
      if (listResp.sessionId) setSessionId(listResp.sessionId);
      setLastResponseRaw(listResp.raw);
      setLastResponseMessages(listResp.messages);
      const msg = listResp.messages.find((m) => m && m.id === listId) || listResp.messages[0];
      const list = (msg?.result?.tools || []) as McpTool[];
      setTools(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const formatArgs = () => {
    const parsed = safeJsonParse(argsText);
    if (!parsed.ok) {
      setError(`参数 JSON 解析失败：${parsed.error}`);
      return;
    }
    setArgsText(prettyJson(parsed.value));
  };

  const callSelectedTool = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!selectedToolName) {
        setError("请先选择一个工具");
        return;
      }
      const parsedHeaders = parseHeaderJson(headersText);
      if (!parsedHeaders.ok) {
        setError(`请求头 JSON 解析失败：${parsedHeaders.error}`);
        return;
      }
      const parsedArgs = safeJsonParse(argsText);
      if (!parsedArgs.ok) {
        setError(`参数 JSON 解析失败：${parsedArgs.error}`);
        return;
      }
      const callId = requestIdRef.current++;
      const payload = {
        jsonrpc: "2.0",
        id: callId,
        method: "tools/call",
        params: {
          name: selectedToolName,
          arguments: parsedArgs.value,
        },
      };
      setLastRequest(payload);
      const resp = await mcpPost({ url: mcpUrl, sessionId, extraHeaders: parsedHeaders.headers, payload });
      if (resp.sessionId) setSessionId(resp.sessionId);
      setLastResponseRaw(resp.raw);
      setLastResponseMessages(resp.messages);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 h-full overflow-auto space-y-4">
      <div>
        <h2 className="text-2xl font-bold m-0">MCP 调试</h2>
        <div className="text-sm text-muted-foreground">连接 /mcp，列出工具并手动调用（仅调试用途）</div>
      </div>

      {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 text-red-500 text-sm px-3 py-2">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>连接设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="例如：https://example.com/mcp 或 http://localhost:8001/mcp"
            />
            <Button variant="outline" onClick={() => setMcpUrl(sameOriginDefault)}>
              同源
            </Button>
            {!connected ? (
              <Button onClick={() => connect().catch(() => {})} disabled={busy}>
                <PlugZap size={16} className="mr-1" />
                连接
              </Button>
            ) : (
              <Button variant="outline" onClick={() => disconnect().catch(() => {})} disabled={busy}>
                <Plug size={16} className="mr-1" />
                断开
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">额外请求头（JSON）</div>
            <Textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder='例如：{"Authorization":"Bearer xxx"}'
              className="min-h-[72px]"
            />
          </div>
          <div className="flex gap-4 items-center flex-wrap text-sm">
            <div>
              状态：
              {connected ? <span className="ml-1 text-emerald-600">已连接</span> : <span className="ml-1 text-muted-foreground">未连接</span>}
            </div>
            <div>
              Session：
              {sessionId ? <code className="ml-1 px-1 py-0.5 rounded bg-muted">{sessionId}</code> : <span className="ml-1 text-muted-foreground">无</span>}
            </div>
            <Button variant="outline" onClick={() => refreshTools().catch(() => {})} disabled={!connected || busy}>
              <RefreshCw size={16} className="mr-1" />
              刷新工具
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{`工具列表（${tools.length}）`}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tools.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无工具</div>
          ) : (
            tools.map((t) => (
              <div
                key={t.name}
                className={`rounded-md border px-3 py-2 cursor-pointer ${selectedToolName === t.name ? "border-primary" : "border-border"}`}
                onClick={() => {
                  setSelectedToolName(t.name);
                  setArgsText("{}");
                }}
              >
                <div className="font-mono text-sm">{t.name}</div>
                <div className="text-xs text-muted-foreground truncate">{t.description || "（无）"}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>工具详情</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTool ? (
              <div className="space-y-2">
                <div>
                  当前：<code>{selectedTool.name}</code>
                </div>
                <div className="border border-border rounded-md p-3 bg-muted overflow-auto">
                  <pre className="m-0 text-xs whitespace-pre-wrap">{prettyJson(selectedTool.inputSchema || {})}</pre>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">点击上方工具以查看 inputSchema</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>手动调用</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Select
              value={selectedToolName || ""}
              onChange={(e) => {
                const v = e.target.value || undefined;
                setSelectedToolName(v);
                setArgsText("{}");
              }}
            >
              <option value="">选择一个工具</option>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="{ }"
              className="min-h-[150px]"
            />
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={formatArgs} disabled={busy}>
                <Wand2 size={16} className="mr-1" />
                格式化 JSON
              </Button>
              <Button onClick={() => callSelectedTool().catch(() => {})} disabled={!connected || busy}>
                <Play size={16} className="mr-1" />
                调用 tools/call
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近一次请求 / 响应</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="font-semibold mb-1">请求</div>
              <div className="border border-border rounded-md p-3 bg-muted overflow-auto">
                <pre className="m-0 text-xs whitespace-pre-wrap">{lastRequest ? prettyJson(lastRequest) : "（无）"}</pre>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-1">响应（原始）</div>
              <div className="border border-border rounded-md p-3 bg-muted overflow-auto">
                <pre className="m-0 text-xs whitespace-pre-wrap">{lastResponseRaw || "（无）"}</pre>
              </div>
            </div>
          </div>
          <div>
            <div className="font-semibold mb-1">响应（解析后 JSON-RPC）</div>
            <div className="border border-border rounded-md p-3 bg-muted overflow-auto">
              <pre className="m-0 text-xs whitespace-pre-wrap">
                {lastResponseMessages.length ? prettyJson(lastResponseMessages) : "（无）"}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

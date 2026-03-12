import React, { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { Input } from "@/components/ui/input";
import {
  Maximize,
  Minimize,
  Target,
  Info,
  FileText,
  Share2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Loader2,
} from "lucide-react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlowPanel } from "@/components/ui/twenty-first";
import { notify } from "@/lib/notify";

type GraphNode = {
  id: string;
  name?: string;
  label?: string;
  val?: number;
  degree?: number;
  sources?: string[];
  x?: number;
  y?: number;
  color?: string;
};

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  weight?: number;
  sources?: string[];
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const KnowledgeGraph: React.FC = () => {
  const [data, setData] = useState<GraphData | null>(null);
  const [collapsedMode, setCollapsedMode] = useState(true);
  const [structuredMode, setStructuredMode] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchMatches, setSearchMatches] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const fetchGraph = async (opts?: { silent?: boolean; preserve?: boolean }) => {
    const silent = Boolean(opts?.silent);
    const preserve = Boolean(opts?.preserve);
    const hadData = Boolean(data && data.nodes && data.nodes.length);
    if (!silent) setLoading(true);
    try {
      const res = await axios.get("http://localhost:8000/documents/graph", {
        params: { view: structuredMode ? "structured" : "flat" },
      });
      const nextData = res.data as GraphData;
      setData(nextData);
      setErrorText(null);
      if (!preserve) {
        setExpandedNodes(new Set());
        setSelectedNode(null);
      } else {
        setSelectedNode((prev) => {
          if (!prev) return prev;
          const hit = nextData?.nodes?.find((n) => n.id === prev.id);
          return hit ? { ...prev, ...hit } : null;
        });
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const msg = `加载图谱失败：${String(detail || e?.message || e)}`;
      console.error("Failed to fetch graph data", e);
      if (!silent) {
        if (!hadData) setErrorText(msg);
        notify(msg, "error");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 600,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [structuredMode]);

  useEffect(() => {
    if (!data || !graphRef.current) return;
    try {
      const charge = graphRef.current.d3Force("charge");
      if (charge?.strength) charge.strength(-320);
      const link = graphRef.current.d3Force("link");
      if (link?.distance) link.distance(165);
      graphRef.current.d3ReheatSimulation?.();
    } catch (e) {
      console.error("Failed to tune graph forces", e);
    }
  }, [data, collapsedMode]);

  useEffect(() => {
    if (!data) return;
    const q = searchText.trim().toLowerCase();
    if (!q) {
      setSearchMatches(new Set());
      return;
    }
    const matches = new Set<string>();
    for (const n of data.nodes) {
      const name = (n.name || n.id).toLowerCase();
      const label = (n.label || "").toLowerCase();
      if (name.includes(q) || label.includes(q)) {
        matches.add(n.id);
      }
    }
    setSearchMatches(matches);
    if (matches.size > 0 && matches.size < 10) {
      // Auto expand if few matches
      if (collapsedMode) {
        setExpandedNodes((prev) => {
          const next = new Set(prev);
          for (const id of matches) next.add(id);
          return next;
        });
      }
    }
  }, [searchText, data]);

  const toNodeId = (nodeOrId: unknown) => {
    if (typeof nodeOrId === "string") return nodeOrId;
    if (nodeOrId && typeof nodeOrId === "object" && "id" in (nodeOrId as any)) return String((nodeOrId as any).id);
    return "";
  };

  const toNode = (nodeOrId: unknown): GraphNode | undefined => {
    const id = toNodeId(nodeOrId);
    if (!id) return undefined;
    return data?.nodes.find((n) => n.id === id);
  };

  const displayNodeText = (node: any) => {
    const n = node as GraphNode;
    return String(n?.name || n?.id || "");
  };

  const baseNodeIds = useMemo(() => {
    if (!data) return new Set<string>();
    const sorted = [...data.nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
    const top = sorted.slice(0, Math.min(60, sorted.length)).map((n) => n.id);
    return new Set<string>(top);
  }, [data]);

  const visibleGraph = useMemo<GraphData | null>(() => {
    if (!data) return null;
    if (!collapsedMode) return data;
    const visibleIds = new Set<string>();
    for (const id of baseNodeIds) visibleIds.add(id);
    for (const id of expandedNodes) visibleIds.add(id);
    // Always show search matches
    for (const id of searchMatches) visibleIds.add(id);
    
    const links: GraphLink[] = [];
    for (const l of data.links) {
      const s = toNodeId(l.source);
      const t = toNodeId(l.target);
      if (visibleIds.has(s) && visibleIds.has(t)) links.push(l);
    }
    const nodes = data.nodes.filter((n) => visibleIds.has(n.id));
    return { nodes, links };
  }, [data, collapsedMode, baseNodeIds, expandedNodes]);

  const neighborsById = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!data) return map;
    for (const l of data.links) {
      const s = toNodeId(l.source);
      const t = toNodeId(l.target);
      if (!s || !t) continue;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    }
    return map;
  }, [data]);

  const handleNodeClick = (node: any) => {
    const id = toNodeId(node);
    const full = data?.nodes.find((n) => n.id === id) ?? (node as GraphNode);
    setSelectedNode(full);
    if (graphRef.current) {
      const x = typeof node?.x === "number" ? node.x : visibleGraph?.nodes.find((n) => n.id === id)?.x;
      const y = typeof node?.y === "number" ? node.y : visibleGraph?.nodes.find((n) => n.id === id)?.y;
      if (typeof x === "number" && typeof y === "number") {
        graphRef.current.centerAt(x, y, 1000);
        graphRef.current.zoom(2, 1000);
      } else {
        graphRef.current.zoomToFit(400);
      }
    }
  };

  const resetView = () => {
    graphRef.current?.zoomToFit(400);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (errorText) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <Card className="max-w-xl w-full">
          <CardHeader>
            <CardTitle>加载失败</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">{errorText}</div>
            <Button onClick={() => fetchGraph()}>重试</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="text-sm text-muted-foreground">
              {structuredMode ? "暂无分层图谱数据，可尝试关闭“分层”或先上传文档" : "暂无图谱数据，请先上传文档"}
            </div>
            <Button onClick={() => fetchGraph()}>刷新</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!visibleGraph || visibleGraph.nodes.length === 0) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">暂无可视图谱数据</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#f0f2f5] overflow-hidden">
      <GlowPanel className="absolute z-10 top-5 left-5 w-[540px] max-w-[calc(100%-40px)]">
      <Card className="bg-transparent border-0 shadow-none">
        <CardContent className="pt-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Share2 size={20} className="text-blue-600" />
              <span>知识图谱</span>
            </div>
            <div className="text-sm text-muted-foreground">基于文档实体提取的知识网络</div>
            <div className="pt-2">
              <Input 
                placeholder="搜索实体..." 
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap pt-2">
              <Button variant="outline" size="icon" title="居中视图" onClick={resetView}>
                <Target size={16} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="放大"
                onClick={() => graphRef.current?.zoom(graphRef.current.zoom() * 1.2, 400)}
              >
                <Maximize size={16} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="缩小"
                onClick={() => graphRef.current?.zoom(graphRef.current.zoom() / 1.2, 400)}
              >
                <Minimize size={16} />
              </Button>
              <div className="mx-1 w-px h-8 bg-border" />
              <Button
                variant={collapsedMode ? "default" : "outline"}
                onClick={() => {
                  setCollapsedMode((v) => !v);
                  setExpandedNodes(new Set());
                }}
              >
                折叠{collapsedMode ? "开" : "关"}
              </Button>
              <Button
                variant={structuredMode ? "default" : "outline"}
                onClick={() => {
                  setStructuredMode((v) => !v);
                  setExpandedNodes(new Set());
                  setSelectedNode(null);
                }}
              >
                分层{structuredMode ? "开" : "关"}
              </Button>
              <GradientButton className="!min-w-0 !px-4 !py-2" onClick={() => fetchGraph()}>
                刷新数据
              </GradientButton>
            </div>
          </div>
        </CardContent>
      </Card>
      </GlowPanel>

      <Card className="absolute bottom-5 left-5 z-10 bg-white/80">
        <CardContent className="pt-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-[10px] h-[10px] rounded-full bg-[#999]" />
            <span>DOC/标题/实体（颜色按类型）</span>
          </div>
        </CardContent>
      </Card>

      <ForceGraph2D
        ref={graphRef}
        graphData={visibleGraph}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#f0f2f5"
        nodeLabel={(node: any) => `${displayNodeText(node)}\n类型: ${String((node as any)?.label || "")}`}
        nodeAutoColorBy="label"
        nodeRelSize={5}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.005}
        linkWidth={1}
        linkColor={() => "#d9d9d9"}
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const label = displayNodeText(node);
          const scale = Math.max(1, Number(globalScale) || 1);
          const fontSize = 14 / scale;
          ctx.font = `${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          const nodeLabel = String((node as any)?.label || "");
          const isMatch = searchMatches.has(node.id);
          const isDimmed = searchMatches.size > 0 && !isMatch;
          
          const showLabel = isMatch || (nodeLabel === "DOC" || nodeLabel === "SECTION" ? scale <= 2.2 : scale <= 1.4);
          
          ctx.globalAlpha = isDimmed ? 0.2 : 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.val ? Math.sqrt(node.val) * 3 : 5, 0, 2 * Math.PI, false);
          ctx.fillStyle = node.color;
          ctx.fill();
          
          if (isMatch) {
            ctx.strokeStyle = "#ffeb3b";
            ctx.lineWidth = 2 / scale;
            ctx.stroke();
          }

          if (showLabel) {
            const safeLabel = label.length > 60 ? `${label.slice(0, 60)}…` : label;
            const textWidth = ctx.measureText(safeLabel).width;
            const padding = fontSize * 0.4;
            const bckgDimensions = [textWidth + padding, fontSize + padding];
            ctx.fillStyle = isMatch ? "rgba(255, 235, 59, 0.9)" : "rgba(255, 255, 255, 0.9)";
            ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y + fontSize * 1.2, bckgDimensions[0], bckgDimensions[1]);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#333";
            ctx.fillText(safeLabel, node.x, node.y + fontSize * 1.2 + bckgDimensions[1] / 2);
            node.__bckgDimensions = bckgDimensions;
          }
          ctx.globalAlpha = 1;
        }}
      />

      {selectedNode ? (
        <div className="absolute right-0 top-0 h-full w-[420px] bg-background border-l border-border z-20 overflow-y-auto">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <Info size={18} className="text-blue-600" />
              <span>实体详情</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelectedNode(null)}>
              关闭
            </Button>
          </div>
          <div className="p-4 space-y-5">
            <div>
              <div className="text-2xl font-bold mb-2">{selectedNode.name || selectedNode.id}</div>
              <Badge variant="secondary">{selectedNode.label}</Badge>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">基本信息</div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">关联强度</span><span>{selectedNode.val || 1}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">实体类型</span><span>{selectedNode.label}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">关系数量</span><span>{selectedNode.degree ?? 0}</span></div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">关联文档</div>
              <div className="max-h-[260px] overflow-y-auto">
                {(selectedNode.sources || []).length > 0 ? (
                  (selectedNode.sources || []).map((src: string, index: number) => (
                    <div
                      key={index}
                      className={`py-2 flex items-center gap-2 ${index === (selectedNode.sources || []).length - 1 ? "" : "border-b border-border"}`}
                    >
                      <FileText size={14} className="text-muted-foreground" />
                      <span className="text-sm truncate">{src}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground py-4">暂无关联文档数据</div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">实体关系</div>
              <div className="max-h-[320px] overflow-y-auto">
                {(() => {
                  const id = selectedNode.id;
                  const allLinks = data?.links || [];
                  const related = allLinks
                    .filter((l) => toNodeId(l.source) === id || toNodeId(l.target) === id)
                    .map((l) => {
                      const s = toNodeId(l.source);
                      const t = toNodeId(l.target);
                      const otherId = s === id ? t : s;
                      return { otherId, weight: l.weight ?? 1, sources: l.sources || [] };
                    })
                    .sort((a, b) => b.weight - a.weight);

                  if (related.length === 0) return <div className="text-sm text-muted-foreground py-4">暂无关系数据</div>;

                  return related.map((r, idx) => (
                    <div
                      key={`${r.otherId}-${idx}`}
                      className={`py-2 flex items-center justify-between gap-3 cursor-pointer ${idx === related.length - 1 ? "" : "border-b border-border"}`}
                      onClick={() => {
                        const other = toNode(r.otherId);
                        if (!other) return;
                        setSelectedNode(other);
                        if (collapsedMode) {
                          setExpandedNodes((prev) => {
                            const next = new Set(prev);
                            next.add(other.id);
                            next.add(id);
                            return next;
                          });
                        }
                        const v = visibleGraph?.nodes.find((n) => n.id === other.id);
                        if (graphRef.current && v?.x != null && v?.y != null) {
                          graphRef.current.centerAt(v.x, v.y, 800);
                          graphRef.current.zoom(2, 800);
                        }
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{toNode(r.otherId)?.name || r.otherId}</div>
                        <div className="text-xs text-muted-foreground">
                          权重: {r.weight}
                          {r.sources.length
                            ? ` · 来源: ${r.sources.slice(0, 2).join("、")}${r.sources.length > 2 ? "…" : ""}`
                            : ""}
                        </div>
                      </div>
                      <ChevronRight size={16} />
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {collapsedMode ? (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    const id = selectedNode.id;
                    const neighbors = neighborsById.get(id);
                    if (!neighbors) return;
                    setExpandedNodes((prev) => {
                      const next = new Set(prev);
                      next.add(id);
                      for (const n of neighbors) next.add(n);
                      return next;
                    });
                  }}
                >
                  <ChevronDown size={16} className="mr-1" />
                  展开邻居
                </Button>
              ) : null}
              {collapsedMode ? (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    const id = selectedNode.id;
                    const neighbors = neighborsById.get(id);
                    if (!neighbors) return;
                    setExpandedNodes((prev) => {
                      const next = new Set(prev);
                      for (const n of neighbors) next.delete(n);
                      next.delete(id);
                      return next;
                    });
                  }}
                >
                  <ChevronUp size={16} className="mr-1" />
                  收起邻居
                </Button>
              ) : null}
              <Button className="w-full" onClick={() => handleNodeClick(selectedNode)}>
                <Target size={16} className="mr-1" />
                聚焦此节点
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default KnowledgeGraph;

import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlowPanel, MetricGlowCard } from "@/components/ui/twenty-first";
import { FeaturesSectionWithHoverEffects } from "@/components/feature-section-with-hover-effects";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { notify } from "@/lib/notify";
import { Skeleton } from "@/components/ui/skeleton";

type Overview = {
  window_days: number;
  documents_count: number;
  chunks_count: number;
  questions_total: number;
  questions_last_7_days: number;
  focus_minutes_today: number;
  focus_minutes_7d: number;
  flashcards_total: number;
  flashcards_due_today: number;
  reviews_7d: number;
  accuracy_7d: number;
  quizzes_7d: number;
  avg_score_7d: number;
};

type TimeseriesPoint = { date: string; value: number };
type Timeseries = { metric: string; days: number; points: TimeseriesPoint[] };

const API_BASE = "http://localhost:8000";

function notifyError(text: string) {
  notify(text, "error");
}

function MiniLineChart({ points }: { points: TimeseriesPoint[] }) {
  const w = 320;
  const h = 72;
  const pad = 8;
  const values = points.map((p) => Number(p.value) || 0);
  const maxV = Math.max(1, ...values);
  const minV = Math.min(0, ...values);
  const range = Math.max(1e-6, maxV - minV);

  const coords = points.map((p, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
    const v = Number(p.value) || 0;
    const y = pad + (h - pad * 2) * (1 - (v - minV) / range);
    return { x, y };
  });

  const d = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.9" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="2.2" fill="currentColor" opacity="0.9" />
      ))}
    </svg>
  );
}

function formatMinutes(mins: number) {
  const m = Math.max(0, Math.floor(mins || 0));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} 小时 ${r} 分钟`;
}

function StatCard({ title, value, suffix, className }: { title: string; value: string | number; suffix?: string; className?: string }) {
  const isLoading = value === "-" || value === undefined;
  
  return (
    <MetricGlowCard
      className={className}
      title={title}
      value={isLoading ? <Skeleton className="h-8 w-24" /> : value}
      suffix={isLoading ? undefined : suffix}
    />
  );
}

function FocusTimer({ onTracked }: { onTracked: () => void }) {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preset, setPreset] = useState<"25/5" | "50/10" | "自定义">("25/5");
  const [customMinutes, setCustomMinutes] = useState(25);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    tickRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [running]);

  const targetMinutes = useMemo(() => {
    if (preset === "25/5") return 25;
    if (preset === "50/10") return 50;
    return Math.max(5, Math.min(120, customMinutes));
  }, [preset, customMinutes]);

  const currentMinutes = Math.floor(seconds / 60);
  const pct = Math.min(100, Math.round((currentMinutes / Math.max(1, targetMinutes)) * 100));

  const endSession = async () => {
    const minutes = Math.max(0, Math.round(seconds / 60));
    setRunning(false);
    setSeconds(0);
    if (minutes <= 0) return;
    try {
      await axios.post(`${API_BASE}/events/track`, { event: "focus_end", payload: { minutes } });
      onTracked();
    } catch {
      notifyError("写入专注记录失败");
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>专注计时</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {(["25/5", "50/10", "自定义"] as const).map((item) => (
            <Button key={item} variant={preset === item ? "default" : "outline"} onClick={() => setPreset(item)}>
              {item}
            </Button>
          ))}
        </div>
        {preset === "自定义" ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">时长</span>
            <Input
              type="number"
              value={customMinutes}
              min={5}
              max={120}
              onChange={(e) => setCustomMinutes(Number(e.target.value))}
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">分钟</span>
          </div>
        ) : null}
        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <div className="text-2xl font-bold">{formatMinutes(currentMinutes)}</div>
            <div className="text-sm text-muted-foreground">{pct}%</div>
          </div>
          <Progress value={pct} />
          <div className="text-xs text-muted-foreground">目标 {targetMinutes} 分钟</div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setRunning(true)} disabled={running}>
            开始
          </Button>
          <Button variant="outline" onClick={() => setRunning(false)} disabled={!running}>
            暂停
          </Button>
          <Button variant="destructive" onClick={endSession} disabled={seconds <= 0}>
            结束并记录
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const Dashboard: React.FC = () => {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trendMetric, setTrendMetric] = useState<"focus" | "questions">("focus");
  const [trend, setTrend] = useState<Timeseries | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshInFlight = useRef(false);
  const [cardManageOpen, setCardManageOpen] = useState(false);
  const [cardManageLoading, setCardManageLoading] = useState(false);
  const [cardManageItems, setCardManageItems] = useState<any[]>([]);
  const [cardManageQuery, setCardManageQuery] = useState("");
  const [cardManageDeletingId, setCardManageDeletingId] = useState<number | null>(null);
  const [pendingDeleteCardId, setPendingDeleteCardId] = useState<number | null>(null);

  const refresh = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    try {
      const [oRes, tRes] = await Promise.all([
        axios.get(`${API_BASE}/stats/overview`, { params: { days: 7 } }),
        axios.get(`${API_BASE}/stats/timeseries`, { params: { metric: trendMetric, days: 7 } }),
      ]);
      setOverview(oRes.data as Overview);
      setTrend(tRes.data as Timeseries);
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, [trendMetric]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refresh().catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [trendMetric]);

  const loadCardManage = async (q?: string) => {
    setCardManageLoading(true);
    try {
      const query = (q ?? cardManageQuery).trim();
      const res = query
        ? await axios.get(`${API_BASE}/flashcards/search`, { params: { q: query, limit: 200 } })
        : await axios.get(`${API_BASE}/flashcards/list`, { params: { limit: 200, offset: 0 } });
      const cards = Array.isArray(res.data?.cards) ? res.data.cards : [];
      setCardManageItems(cards);
    } catch {
      notifyError("加载卡片列表失败");
    } finally {
      setCardManageLoading(false);
    }
  };

  useEffect(() => {
    if (cardManageOpen) {
      loadCardManage("").catch(() => {});
    }
  }, [cardManageOpen]);

  const deleteFlashcard = async (id: number) => {
    setCardManageDeletingId(id);
    try {
      await axios.delete(`${API_BASE}/flashcards/${id}`);
      setCardManageItems((prev) => prev.filter((c) => Number(c.id) !== id));
      refresh().catch(() => {});
    } catch {
      notifyError("删除卡片失败");
    } finally {
      setCardManageDeletingId(null);
    }
  };

  return (
    <div className="p-5 h-full overflow-y-auto space-y-4 bg-grid-white/[0.05]">
      <GlowPanel className="p-4">
        <div className="flex justify-between items-end">
        <h2 className="text-2xl font-bold">学习仪表盘</h2>
        <GradientButton onClick={() => refresh()} disabled={loading} className="!min-w-0 !px-4 !py-2">
          {loading ? "刷新中..." : "刷新"}
        </GradientButton>
      </div>
      </GlowPanel>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="文档数" value={overview ? overview.documents_count : "-"} />
        <StatCard title="Chunk 数" value={overview ? overview.chunks_count : "-"} />
        <StatCard title="提问总数" value={overview ? overview.questions_total : "-"} />
        <StatCard title="近7天提问" value={overview ? overview.questions_last_7_days : "-"} />
        <StatCard title="今日专注" value={overview ? overview.focus_minutes_today : "-"} suffix={overview ? "分钟" : undefined} />
        <StatCard title="近7天专注" value={overview ? overview.focus_minutes_7d : "-"} suffix={overview ? "分钟" : undefined} />
        <Card className="cursor-pointer hover:scale-[1.02] transition-transform duration-200" onClick={() => setCardManageOpen(true)}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">卡片总数（可点击管理）</CardTitle></CardHeader>
          <CardContent>
            {overview ? (
              <div className="text-2xl font-bold">{overview.flashcards_total}</div>
            ) : (
              <Skeleton className="h-8 w-24" />
            )}
          </CardContent>
        </Card>
        <StatCard title="今日到期卡" value={overview ? overview.flashcards_due_today : "-"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <GlowPanel>
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>近7天趋势</CardTitle>
            <div className="flex gap-2">
              <Button variant={trendMetric === "focus" ? "default" : "outline"} onClick={() => setTrendMetric("focus")}>专注</Button>
              <Button variant={trendMetric === "questions" ? "default" : "outline"} onClick={() => setTrendMetric("questions")}>提问</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-4 items-stretch">
              <div className="text-foreground">
                {trend ? (
                  <MiniLineChart points={trend.points} />
                ) : (
                  <div className="w-full h-[72px] flex items-end gap-1">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <Skeleton key={i} className="flex-1 rounded-t-sm" style={{ height: `${Math.random() * 60 + 20}%` }} />
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {trend ? (
                  trend.points.slice().reverse().map((p, idx) => (
                    <div key={`${p.date}-${idx}`} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
                      <span className="text-xs text-muted-foreground">{p.date}</span>
                      <span className="text-sm font-bold">{trendMetric === "focus" ? `${Math.round(p.value)} 分钟` : `${Math.round(p.value)} 次`}</span>
                    </div>
                  ))
                ) : (
                  Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-[38px] w-full rounded-md" />
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        </GlowPanel>
        <FocusTimer onTracked={() => refresh()} />
      </div>

      <GlowPanel className="px-2">
        <FeaturesSectionWithHoverEffects
          items={[
            { title: "知识图谱联动", description: "问答、文档、图谱与测验的数据互通。", icon: <span>🧠</span> },
            { title: "复习任务驱动", description: "根据到期卡片自动生成今日复习节奏。", icon: <span>⏱️</span> },
            { title: "测验闭环反馈", description: "作答成绩实时回流到学习统计面板。", icon: <span>📊</span> },
            { title: "本地可控模型", description: "支持本地与云端模型的自由切换。", icon: <span>🤖</span> },
            { title: "文档摘要沉淀", description: "文档解析后形成结构化知识摘要。", icon: <span>📝</span> },
            { title: "阶段趋势追踪", description: "专注时长与提问量趋势可视化。", icon: <span>📈</span> },
            { title: "MCP 工具扩展", description: "通过 MCP 调试页快速验证工具链。", icon: <span>🔌</span> },
            { title: "渐进式界面升级", description: "已从 antd 完成迁移并进入 21st 设计接入。", icon: <span>✨</span> },
          ]}
        />
      </GlowPanel>

      <Modal open={cardManageOpen} onClose={() => setCardManageOpen(false)} title="卡片管理" maxWidthClassName="max-w-3xl">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={cardManageQuery}
              onChange={(e) => setCardManageQuery(e.target.value)}
              placeholder="搜索卡片（按问题或答案）"
            />
            <Button onClick={() => loadCardManage(cardManageQuery)}>搜索</Button>
          </div>
          {cardManageLoading ? <div className="text-sm text-muted-foreground">加载中...</div> : null}
          {!cardManageLoading && cardManageItems.length === 0 ? <div className="text-sm text-muted-foreground">暂无卡片</div> : null}
          <div className="space-y-2">
            {cardManageItems.map((it: any) => (
              <Card key={String(it.id)}>
                <CardContent className="pt-5">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="font-semibold">{String(it.front || "")}</div>
                      <div className="text-sm">{String(it.back || "")}</div>
                      <div className="text-xs text-muted-foreground">
                        id={String(it.id)} {it?.source_doc ? ` · ${String(it.source_doc)}` : ""}
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      {it?.source_doc ? <Badge variant="secondary">{String(it.source_doc)}</Badge> : null}
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={cardManageDeletingId === Number(it.id)}
                        onClick={() => setPendingDeleteCardId(Number(it.id))}
                      >
                        {cardManageDeletingId === Number(it.id) ? "删除中..." : "删除"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDeleteCardId !== null}
        title="确认删除卡片"
        description="删除后将无法恢复，是否继续？"
        confirmText="确认删除"
        cancelText="取消"
        danger
        onCancel={() => setPendingDeleteCardId(null)}
        onConfirm={() => {
          if (pendingDeleteCardId === null) return;
          const id = pendingDeleteCardId;
          setPendingDeleteCardId(null);
          deleteFlashcard(id).catch(() => {});
        }}
      />
    </div>
  );
};

export default Dashboard;

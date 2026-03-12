import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlowPanel, MetricGlowCard } from "@/components/ui/twenty-first";
import { RadioGroup } from "@/components/ui/radio-group";
import { notify } from "@/lib/notify";

const API_BASE = "http://localhost:8000";

type Overview = {
  flashcards_total: number;
  flashcards_due_today: number;
  reviews_7d: number;
  accuracy_7d: number;
  quizzes_7d: number;
  avg_score_7d: number;
};

type CardFormat =
  | { type: "mcq"; prompt?: string; options: string[]; answer: number }
  | { type: "cloze"; text: string; answer: string };

type DueCard = {
  id: number;
  front: string;
  back: string;
  tags: string[];
  format?: CardFormat | null;
};

function normalize(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, "")
    .replace(/[，。；：、,.!?！？"'“”‘’（）()【】\[\]{}<>]/g, "");
}

function isCorrectFill(user: string, expected: string) {
  const u = normalize(user);
  const e = normalize(expected);
  if (!u || !e) return false;
  if (u === e) return true;
  if (u.length >= 3 && e.includes(u)) return true;
  if (e.length >= 3 && u.includes(e)) return true;
  return false;
}

export default function TodayTasks() {
  const [cards, setCards] = useState<DueCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [answerChoice, setAnswerChoice] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; expected: string; back: string; front: string } | null>(null);
  const [backExpanded, setBackExpanded] = useState(false);
  const refreshInFlight = useRef(false);
  const overviewInFlight = useRef(false);
  const startedRef = useRef(started);
  const loadingRef = useRef(loading);
  const checkingRef = useRef(checking);

  const refreshOverview = async () => {
    if (overviewInFlight.current) return;
    overviewInFlight.current = true;
    try {
      const res = await axios.get(`${API_BASE}/stats/overview`, { params: { days: 7 } });
      setOverview(res.data as Overview);
    } catch {} finally {
      overviewInFlight.current = false;
    }
  };

  const refresh = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/flashcards/due`, { params: { limit: 100 } });
      const list = Array.isArray(res.data?.cards) ? res.data.cards : [];
      setCards(
        list.map((c: any) => ({
          id: Number(c.id),
          front: String(c.front || ""),
          back: String(c.back || ""),
          tags: Array.isArray(c.tags) ? c.tags.map((t: any) => String(t)) : [],
          format: c.format || null,
        }))
      );
      setStarted(false);
      setIdx(0);
      setSessionTotal(0);
      setCompletedCount(0);
      setLastResult(null);
      setBackExpanded(false);
    } catch {
      notify("加载今日任务失败，请检查后端服务", "error");
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  };

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    checkingRef.current = checking;
  }, [checking]);

  useEffect(() => {
    refresh().catch(() => {});
    refreshOverview().catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshOverview().catch(() => {});
      if (!startedRef.current && !loadingRef.current && !checkingRef.current) {
        refresh().catch(() => {});
      }
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);

  const current = cards[idx] || null;

  const fmt = useMemo(() => {
    if (!current) return null;
    const f: any = current.format;
    if (!f || typeof f !== "object") return null;
    if (f.type === "mcq" && Array.isArray(f.options) && f.options.length === 4 && typeof f.answer === "number") {
      return {
        type: "mcq" as const,
        prompt: String(f.prompt || current.front),
        options: f.options.map((x: any) => String(x)),
        answer: Number(f.answer),
      };
    }
    if (f.type === "cloze" && typeof f.text === "string" && typeof f.answer === "string") {
      return { type: "cloze" as const, text: String(f.text), answer: String(f.answer) };
    }
    return null;
  }, [current]);

  const cardMode: "mcq" | "cloze" | "legacy" = useMemo(() => {
    if (!current) return "legacy";
    if (!fmt) return "legacy";
    return fmt.type;
  }, [current, fmt]);

  const resetAnswer = () => {
    setAnswerText("");
    setAnswerChoice(null);
  };

  const startNewSession = () => {
    setStarted(true);
    setSessionTotal(cards.length);
    setCompletedCount(0);
    setIdx(0);
    setLastResult(null);
    setBackExpanded(false);
    resetAnswer();
  };

  const continueSession = () => {
    setStarted(true);
    setLastResult(null);
    setBackExpanded(false);
    resetAnswer();
  };

  const restartSession = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/flashcards/due`, { params: { limit: 100 } });
      const list = Array.isArray(res.data?.cards) ? res.data.cards : [];
      setCards(
        list.map((c: any) => ({
          id: Number(c.id),
          front: String(c.front || ""),
          back: String(c.back || ""),
          tags: Array.isArray(c.tags) ? c.tags.map((t: any) => String(t)) : [],
          format: c.format || null,
        }))
      );
      setIdx(0);
      setSessionTotal(list.length);
      setCompletedCount(0);
      setStarted(true);
      setLastResult(null);
      setBackExpanded(false);
      resetAnswer();
      refreshOverview().catch(() => {});
    } catch {
      notify("重新开始失败，请检查后端服务", "error");
    } finally {
      setLoading(false);
    }
  };

  const submitReview = async (cardId: number, ok: boolean) => {
    const grade = ok ? 5 : 1;
    await axios.post(`${API_BASE}/flashcards/${cardId}/review`, { grade });
  };

  const checkAnswer = async () => {
    if (!current) return;
    if (!started) {
      notify("请先点击“开始复习”", "warning");
      return;
    }
    setChecking(true);
    try {
      const currentId = current.id;
      const currentIdx = idx;
      if (cardMode === "mcq" && fmt?.type === "mcq") {
        const chosen = answerChoice;
        if (chosen === null || chosen === undefined) {
          notify("请选择一个选项", "warning");
          return;
        }
        const ok = Number(chosen) === fmt.answer;
        const expected = fmt.options[fmt.answer];
        await submitReview(currentId, ok);
        setLastResult({ ok, expected, back: current.back, front: current.front });
        setBackExpanded(false);
        setCompletedCount((c) => c + 1);
        setCards((prev) => {
          const next = prev.filter((x) => x.id !== currentId);
          const nextIdx = Math.min(currentIdx, Math.max(0, next.length - 1));
          setIdx(nextIdx);
          return next;
        });
        resetAnswer();
        refreshOverview().catch(() => {});
        return;
      }
      if (cardMode === "cloze" && fmt?.type === "cloze") {
        const ok = isCorrectFill(answerText, fmt.answer);
        const expected = fmt.answer;
        await submitReview(currentId, ok);
        setLastResult({ ok, expected, back: current.back, front: current.front });
        setBackExpanded(false);
        setCompletedCount((c) => c + 1);
        setCards((prev) => {
          const next = prev.filter((x) => x.id !== currentId);
          const nextIdx = Math.min(currentIdx, Math.max(0, next.length - 1));
          setIdx(nextIdx);
          return next;
        });
        resetAnswer();
        refreshOverview().catch(() => {});
        return;
      }
      const ok = isCorrectFill(answerText, current.back);
      const expected = current.back;
      await submitReview(currentId, ok);
      setLastResult({ ok, expected, back: current.back, front: current.front });
      setBackExpanded(false);
      setCompletedCount((c) => c + 1);
      setCards((prev) => {
        const next = prev.filter((x) => x.id !== currentId);
        const nextIdx = Math.min(currentIdx, Math.max(0, next.length - 1));
        setIdx(nextIdx);
        return next;
      });
      resetAnswer();
      refreshOverview().catch(() => {});
    } finally {
      setChecking(false);
    }
  };

  const remaining = started ? Math.max(0, sessionTotal - completedCount) : cards.length;
  const sessionPercent = started && sessionTotal ? Math.round((completedCount / Math.max(1, sessionTotal)) * 100) : 0;
  const duePercent = overview?.flashcards_total
    ? Math.min(100, Math.round(((overview.flashcards_due_today || 0) / Math.max(1, overview.flashcards_total)) * 100))
    : 0;

  return (
    <div className="p-5 h-full overflow-y-auto space-y-4 bg-grid-white/[0.05]">
      <GlowPanel className="p-4">
      <div className="flex justify-between items-end">
        <h2 className="text-2xl font-bold m-0">今日任务</h2>
        <GradientButton onClick={() => refresh()} disabled={loading} className="!min-w-0 !px-4 !py-2">
          {loading ? "刷新中..." : "刷新"}
        </GradientButton>
      </div>
      </GlowPanel>

      <GlowPanel>
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle>学习概览</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-sm text-muted-foreground mb-1">今日到期卡片占比</div>
            <Progress value={duePercent} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex justify-between"><span>到期卡片</span><span className="font-extrabold">{overview?.flashcards_due_today ?? 0}</span></div>
            <div className="flex justify-between"><span>卡片总数</span><span className="font-extrabold">{overview?.flashcards_total ?? 0}</span></div>
            <div className="flex justify-between"><span>近7天复习</span><span className="font-extrabold">{overview?.reviews_7d ?? 0}</span></div>
            <div className="flex justify-between"><span>近7天正确率</span><span className="font-extrabold">{overview?.accuracy_7d ?? 0}%</span></div>
            <div className="flex justify-between"><span>近7天测验</span><span className="font-extrabold">{overview?.quizzes_7d ?? 0} 次</span></div>
            <div className="flex justify-between"><span>近7天均分</span><span className="font-extrabold">{overview?.avg_score_7d ?? 0}%</span></div>
          </div>
        </CardContent>
      </Card>
      </GlowPanel>

      <GlowPanel>
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle>今日复习进度</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between"><span className="text-muted-foreground">今日待复习</span><span className="font-extrabold">{remaining}</span></div>
          <Progress value={sessionPercent} />
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">复习进度：{started ? completedCount : 0}/{started ? sessionTotal : cards.length}</span>
            <div className="flex gap-2">
              {started ? (
                <Button variant="outline" onClick={() => setStarted(false)}>
                  暂停
                </Button>
              ) : null}
              <GradientButton
                onClick={() => {
                  if (started) {
                    restartSession().catch(() => {});
                    return;
                  }
                  if (completedCount > 0 && remaining > 0) {
                    continueSession();
                    return;
                  }
                  startNewSession();
                }}
                disabled={cards.length === 0}
                className="!min-w-0 !px-4 !py-2"
              >
                {started ? "重新开始" : completedCount > 0 && remaining > 0 ? "继续" : "开始"}
              </GradientButton>
            </div>
          </div>
        </CardContent>
      </Card>
      </GlowPanel>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricGlowCard title="到期卡片" value={overview?.flashcards_due_today ?? 0} />
        <MetricGlowCard title="近7天复习" value={overview?.reviews_7d ?? 0} />
        <MetricGlowCard title="近7天正确率" value={overview?.accuracy_7d ?? 0} suffix="%" />
        <MetricGlowCard title="近7天均分" value={overview?.avg_score_7d ?? 0} suffix="%" />
      </div>

      {lastResult ? (
        <Card className={lastResult.ok ? "border-emerald-500/40" : "border-red-500/40"}>
          <CardContent className="pt-5 space-y-2">
            <div className="flex justify-between gap-2 items-center">
              <div className="font-black">{lastResult.ok ? "回答正确" : "回答不正确"}</div>
              <Badge variant={lastResult.ok ? "success" : "destructive"}>{lastResult.ok ? "正确" : "错误"}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">{lastResult.front}</div>
            <div><span className="text-muted-foreground">标准答案：</span><span className="font-extrabold">{lastResult.expected}</span></div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">解析</span>
              <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => setBackExpanded((v) => !v)}>
                {backExpanded ? "收起" : "再看一眼解析"}
              </Button>
            </div>
            {backExpanded ? <div className="font-extrabold whitespace-pre-wrap">{lastResult.back}</div> : null}
          </CardContent>
        </Card>
      ) : null}

      {!started ? (
        <Card>
          <CardContent className="pt-5 text-muted-foreground">点击“开始复习”后，以填空/选择题形式逐张完成今日到期卡片。</CardContent>
        </Card>
      ) : null}

      {started && !current ? (
        <Card>
          <CardContent className="pt-5">今天的复习任务已完成。</CardContent>
        </Card>
      ) : null}

      {started && current ? (
        <Card>
          <CardHeader>
            <div className="flex justify-between gap-2">
              <div className="flex gap-2 items-center flex-wrap">
                <Badge variant={cardMode === "mcq" ? "default" : cardMode === "cloze" ? "secondary" : "outline"}>
                  {cardMode === "mcq" ? "选择题" : cardMode === "cloze" ? "填空" : "未升级"}
                </Badge>
                <div className="font-extrabold">{cardMode === "mcq" ? (fmt?.type === "mcq" ? fmt.prompt : current.front) : current.front}</div>
              </div>
              <span className="text-xs text-muted-foreground">{idx + 1}/{cards.length}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {cardMode === "mcq" && fmt?.type === "mcq" ? (
              <RadioGroup
                value={answerChoice === null ? undefined : String(answerChoice)}
                options={fmt.options.map((op: string, i: number) => ({ label: op, value: String(i) }))}
                onValueChange={(v) => setAnswerChoice(Number(v))}
              />
            ) : (
              <>
                {cardMode === "cloze" && fmt?.type === "cloze" ? <div className="text-[15px] leading-7">{fmt.text}</div> : null}
                <Input value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder="请输入你的答案" onKeyDown={(e) => {
                  if (e.key === "Enter") checkAnswer().catch(() => {});
                }} />
                {cardMode === "legacy" ? (
                  <div className="text-xs text-muted-foreground">
                    这张卡还没有 format（旧卡片），暂按 back 对照判定；建议重新在聊天里“生成卡片”获得升级题型。
                  </div>
                ) : null}
              </>
            )}

            <Button
              onClick={() => checkAnswer().catch(() => {})}
              disabled={checking || (cardMode === "mcq" ? answerChoice === null : !String(answerText || "").trim())}
            >
              {checking ? "提交中..." : "提交"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

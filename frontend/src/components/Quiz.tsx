import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlowPanel } from "@/components/ui/twenty-first";
import { notify } from "@/lib/notify";

const API_BASE = "http://localhost:8000";

type QuizQuestion =
  | { id: string; type: "mcq"; prompt: string; options: string[]; answer: number; explanation?: string }
  | { id: string; type: "short"; prompt: string; answer: string; explanation?: string };

type QuizData = { title: string; topic: string; questions: QuizQuestion[] };

type SubmitResult = {
  attempt_id: number;
  score: number;
  total: number;
  accuracy: number;
  details: { id: string; type: string; correct: boolean; correct_answer: any; explanation: string }[];
};

const Quiz: React.FC = () => {
  const { llmConfig } = useStore();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(6);
  const [quizId, setQuizId] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [topicOptions, setTopicOptions] = useState<string[]>([]);

  const loadHistory = async () => {
    try {
      const res = await axios.get(`${API_BASE}/quiz/history`, { params: { limit: 12 } });
      setHistory(Array.isArray(res.data?.history) ? res.data.history : []);
    } catch {}
  };

  useEffect(() => {
    loadHistory().catch(() => {});
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadHistory().catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadTopics = async () => {
      try {
        const res = await axios.get(`${API_BASE}/documents/graph`);
        const nodes = Array.isArray(res.data?.nodes) ? res.data.nodes : [];
        const opts = nodes
          .map((n: any) => String(n?.id || "").trim())
          .filter(Boolean)
          .slice(0, 500);
        setTopicOptions(opts);
      } catch {}
    };
    loadTopics().catch(() => {});
  }, []);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    setAnswers({});
    try {
      const res = await axios.post(`${API_BASE}/quiz/generate`, {
        topic: topic.trim() || null,
        count: Math.max(3, Math.min(12, count)),
        llm: {
          base_url: llmConfig.baseUrl,
          api_key: llmConfig.apiKey,
          model: llmConfig.model,
        },
      });
      setQuizId(Number(res.data?.quiz_id));
      setQuiz(res.data?.quiz as QuizData);
      notify("测验已生成", "success");
      loadHistory().catch(() => {});
    } catch {
      notify("生成测验失败，请检查后端与模型配置/文档是否已入库", "error");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!quizId) return;
    setSubmitting(true);
    try {
      const res = await axios.post(`${API_BASE}/quiz/${quizId}/submit`, { answers });
      setResult(res.data as SubmitResult);
      loadHistory().catch(() => {});
    } catch {
      notify("提交测验失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const detailMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const d of result?.details || []) m[d.id] = d;
    return m;
  }, [result]);

  return (
    <div className="p-5 h-full overflow-y-auto space-y-4 bg-grid-white/[0.05]">
      <GlowPanel className="p-4">
        <h2 className="text-2xl font-bold">学习测验</h2>
      </GlowPanel>

      <GlowPanel>
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle>生成小测</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <Input
              value={topic}
              list="quiz-topic-options"
              onChange={(e) => setTopic(e.target.value)}
              placeholder="主题（可选，可从知识图谱节点选择/搜索）"
              className="min-w-[260px] flex-1"
            />
            <datalist id="quiz-topic-options">
              {topicOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <Input
              type="number"
              value={count}
              min={3}
              max={12}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-[140px]"
            />
            <GradientButton onClick={() => generate()} disabled={loading} className="!min-w-0 !px-4 !py-2">
              {loading ? "生成中..." : "生成"}
            </GradientButton>
          </div>
          <p className="text-xs text-muted-foreground">题目基于已入库文档片段生成；提交后会记录统计到仪表盘。</p>
        </CardContent>
      </Card>
      </GlowPanel>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="min-w-0">
          {quiz ? (
            <Card>
              <CardHeader className="flex flex-row justify-between items-center gap-3">
                <div className="flex gap-2 items-center flex-wrap">
                  <CardTitle>{quiz.title || "小测"}</CardTitle>
                  {quiz.topic ? <Badge variant="secondary">{quiz.topic}</Badge> : null}
                </div>
                <GradientButton onClick={() => submit()} disabled={!quizId || submitting} className="!min-w-0 !px-4 !py-2">
                  {submitting ? "提交中..." : "提交"}
                </GradientButton>
              </CardHeader>
              <CardContent className="space-y-4">
                {quiz.questions.map((q, idx) => {
                  const d = detailMap[q.id];
                  return (
                    <Card key={q.id} className="border-border">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between gap-3">
                          <div className="font-semibold">{`${idx + 1}. ${q.prompt}`}</div>
                          {result ? (
                            <Badge variant={d?.correct ? "success" : "destructive"}>{d?.correct ? "正确" : "错误"}</Badge>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {q.type === "mcq" ? (
                          <div className="flex flex-col gap-2">
                            {q.options.map((op, i) => {
                              const selected = Number(answers[q.id]) === i;
                              return (
                                <Button
                                  key={i}
                                  type="button"
                                  variant={selected ? "default" : "outline"}
                                  className="justify-start h-auto py-2 px-3"
                                  onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: i }))}
                                  disabled={!!result}
                                >
                                  <span className="mr-2 text-xs opacity-80">{String.fromCharCode(65 + i)}.</span>
                                  <span className="text-sm text-left whitespace-normal">{op}</span>
                                </Button>
                              );
                            })}
                          </div>
                        ) : (
                          <Input
                            value={answers[q.id] ?? ""}
                            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                            disabled={!!result}
                            placeholder="输入你的答案"
                          />
                        )}

                        {result ? (
                          <div className="pt-1">
                            <div className="text-xs text-muted-foreground">正确答案：{String(d?.correct_answer ?? "")}</div>
                            {d?.explanation ? <div className="text-sm mt-1">{d.explanation}</div> : null}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-5 text-sm text-muted-foreground">先生成一套小测，然后在这里作答与提交。</CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle>历史记录</CardTitle>
              <Button variant="outline" onClick={() => loadHistory()}>
                刷新
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {history.length === 0 ? (
                  <div className="text-sm text-muted-foreground">暂无测验记录</div>
                ) : (
                  history.map((it: any, idx: number) => {
                    const pct = it?.total ? Math.round((Number(it.score) / Number(it.total)) * 100) : 0;
                    const variant = pct >= 80 ? "success" : pct >= 60 ? "secondary" : "destructive";
                    return (
                      <Card key={`${it?.attempt_id ?? idx}`} className="shadow-none">
                        <CardContent className="pt-5">
                          <div className="flex flex-col w-full gap-1">
                            <div className="flex justify-between gap-2">
                              <div className="font-semibold truncate">{it?.title || `测验 #${it?.quiz_id}`}</div>
                              <Badge variant={variant as any}>{pct}%</Badge>
                            </div>
                            {it?.topic ? <div className="text-sm text-muted-foreground">{it.topic}</div> : null}
                            <div className="text-xs text-muted-foreground">
                              quiz_id={it?.quiz_id} attempt_id={it?.attempt_id}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Quiz;

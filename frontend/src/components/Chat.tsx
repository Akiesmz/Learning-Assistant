import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Send, BookOpen, Copy, Check, Sparkles, User, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import { useStore } from '../store/useStore';
import { Button as UIButton } from '@/components/ui/button';
import { GradientButton } from "@/components/ui/gradient-button";
import { Textarea } from '@/components/ui/textarea';
import { Card as UICard, CardContent as UICardContent, CardHeader as UICardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { Segmented } from '@/components/ui/segmented';
import { Drawer } from '@/components/ui/drawer';
import { notify } from '@/lib/notify';

const MODE_STORAGE_KEY = 'ai-learning-assistant-chat-mode';

const messageApi = {
  success: (text: string) => notify(text, 'success'),
  error: (text: string) => notify(text, 'error'),
  warning: (text: string) => notify(text, 'warning'),
};

const Text: React.FC<any> = ({ children, type, strong, ellipsis, style }) => (
  <span
    style={{
      ...(type === 'secondary' ? { color: 'var(--muted-fg)' } : {}),
      ...(strong ? { fontWeight: 700 } : {}),
      ...(ellipsis ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
      ...(style || {}),
    }}
  >
    {children}
  </span>
);

const getSourceDocLabel = (sources: any[]) => {
  const names = Array.from(
    new Set(
      (Array.isArray(sources) ? sources : [])
        .map((s: any) => String(s?.source || '').trim())
        .filter(Boolean)
    )
  );
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')} 等${names.length}篇`;
};

const Button: React.FC<any> = ({ type, danger, icon, loading, children, style, size, ...props }) => {
  const variant =
    danger ? 'destructive' : type === 'primary' ? 'default' : type === 'text' || type === 'link' ? 'ghost' : 'outline';
  const btnSize = size === 'small' ? 'sm' : size === 'large' ? 'lg' : 'default';
  return (
    <UIButton variant={variant as any} size={btnSize as any} disabled={loading || props.disabled} style={style} {...props}>
      {loading ? <span>...</span> : icon}
      {children}
    </UIButton>
  );
};

const Input: React.FC<any> = ({ onPressEnter, onChange, ...props }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [props.value]);

  return (
    <Textarea
      ref={textareaRef}
      {...props}
      onChange={onChange}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onPressEnter?.(e);
        }
        props.onKeyDown?.(e);
      }}
      className="min-h-[44px] max-h-[200px] resize-none py-2.5 rounded-xl"
      style={{ overflow: 'hidden' }}
    />
  );
};

const Card: React.FC<any> = ({ title, children, styles, style, hoverable, onClick }) => (
  <UICard
    style={{ ...(style || {}), ...(hoverable ? { transition: 'box-shadow 0.2s ease' } : {}) }}
    onClick={onClick}
  >
    {title ? <UICardHeader>{title}</UICardHeader> : null}
    <UICardContent style={{ ...(styles?.body || {}), paddingTop: title ? 0 : undefined }}>{children}</UICardContent>
  </UICard>
);

const Tag: React.FC<any> = ({ color, children, style }) => {
  const variant = color === 'red' || color === 'error' ? 'destructive' : color === 'green' || color === 'success' ? 'success' : color === 'default' ? 'outline' : 'secondary';
  return (
    <Badge variant={variant as any} style={style}>
      {children}
    </Badge>
  );
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
  relatedQuestions?: string[];
  no_cards?: boolean;
  no_references?: boolean;
};

const CodeBlock = React.memo((props: any) => {
  const { inline, className, children } = props || {};
  const raw = String(children ?? '').replace(/\n$/, '');
  if (inline) {
    return <code>{raw}</code>;
  }
  const m = /language-(\w+)/.exec(className || '');
  const lang = (m?.[1] || 'text').toLowerCase();
  const highlighted = useMemo(() => {
    const grammar = (Prism as any).languages?.[lang] || (Prism as any).languages?.markup;
    return grammar ? Prism.highlight(raw, grammar, lang) : raw;
  }, [raw, lang]);
  const lines = useMemo(() => highlighted.split('\n'), [highlighted]);

  return (
    <div className="code-block">
      <div className="code-toolbar">
        <div className="code-lang">{lang}</div>
        <Button
          type="text"
          size="small"
          icon={<Copy size={14} />}
          onClick={() => {
            navigator.clipboard.writeText(raw);
            messageApi.success('代码已复制');
          }}
        >
          复制
        </Button>
      </div>
      <pre className={`code-pre language-${lang}`}>
        <code className="code-lines">
          {lines.map((line: string, i: number) => (
            <div className="code-line" key={i}>
              <span className="code-lineno">{i + 1}</span>
              <span className="code-linecontent" dangerouslySetInnerHTML={{ __html: line || ' ' }} />
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
});

const MarkdownMessage = React.memo(({ content }: { content: string }) => {
  const mdComponents = useMemo(
    () => ({
      code: CodeBlock as any,
    }),
    []
  );
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
});

const MessageList = React.memo(
  ({
    messages,
    copiedId,
    onCopy,
    onOpenSources,
    onCreateFlashcards,
    creatingCardIndex,
    sanitizeRelatedQuestion,
    onRelatedClick,
    onRelatedSetInput,
    scrollRef,
    onSpeak,
    speakingIndex,
  }: {
    messages: ChatMessage[];
    copiedId: number | null;
    onCopy: (text: string, index: number) => void;
    onOpenSources: (sources: any[]) => void;
    onCreateFlashcards: (answer: string, index: number) => void;
    creatingCardIndex: number | null;
    sanitizeRelatedQuestion: (text: unknown) => string;
    onRelatedClick: (safeQuestion: string) => void;
    onRelatedSetInput: (safeQuestion: string) => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onSpeak: (text: string, index: number) => void;
    speakingIndex: number | null;
  }) => {
    return (
      <>
        {messages.map((item, index) => (
          <div
            key={index}
            style={{
              display: 'flex',
              flexDirection: item.role === 'user' ? 'row-reverse' : 'row',
              marginBottom: '24px',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: item.role === 'user' ? 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)' : '#f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: item.role === 'user' ? '#fff' : '#4b5563',
                flexShrink: 0,
                marginTop: '4px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              }}
            >
              {item.role === 'user' ? <User size={18} /> : <Sparkles size={18} />}
            </div>
            <div
              style={{
                maxWidth: '85%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: item.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <Card
                size="small"
                style={{
                  background: item.role === 'user' 
                    ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' 
                    : 'var(--bubble-ai-bg, #ffffff)',
                  borderRadius: item.role === 'user' ? '20px 4px 20px 20px' : '4px 20px 20px 20px',
                  border: item.role === 'user' ? 'none' : '1px solid rgba(0,0,0,0.05)',
                  boxShadow: item.role === 'user' 
                    ? '0 4px 12px rgba(37, 99, 235, 0.2)' 
                    : '0 2px 8px rgba(0,0,0,0.04)',
                  position: 'relative',
                }}
                styles={{ body: { padding: '14px 18px' } }}
              >
                <div
                  style={{
                    color: item.role === 'user' ? '#ffffff' : 'var(--bubble-ai-fg, #1f2937)',
                    fontSize: '15px',
                    lineHeight: '1.7',
                  }}
                  className={`markdown-body ${item.role === 'user' ? 'text-white' : ''}`}
                >
                  <MarkdownMessage content={item.content} />
                </div>

                {item.role === 'assistant' && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: '12px',
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {!item.no_cards && (
                        <Button
                          type="link"
                          size="small"
                          style={{
                            padding: 0,
                            height: 'auto',
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          icon={<Sparkles size={14} />}
                          loading={creatingCardIndex === index}
                          onClick={() => onCreateFlashcards(item.content, index)}
                        >
                          生成卡片
                        </Button>
                      )}
                      {!item.no_references && item.sources && item.sources.length > 0 && (
                        <>
                          {(() => {
                            const docLabel = getSourceDocLabel(item.sources || []);
                            return (
                          <Button
                            type="link"
                            size="small"
                            style={{
                              padding: 0,
                              height: 'auto',
                              fontSize: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                            icon={<BookOpen size={14} />}
                            onClick={() => onOpenSources(item.sources || [])}
                          >
                            参考来源 ({item.sources.length}){docLabel ? `（${docLabel}）` : ''}
                          </Button>
                            );
                          })()}
                          <Text type="secondary" style={{ fontSize: '11px', color: 'var(--muted-fg)' }}>
                            答案由AI生成
                          </Text>
                        </>
                      )}
                      {(!item.sources || item.sources.length === 0) && (
                        <Text type="secondary" style={{ fontSize: '11px', color: 'var(--muted-fg)' }}>
                          答案由AI生成
                        </Text>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <Tooltip title={speakingIndex === index ? '停止语音' : '语音朗读'}>
                        <Button 
                          type="text" 
                          size="small" 
                          icon={speakingIndex === index ? <VolumeX size={14} /> : <Volume2 size={14} />} 
                          onClick={() => onSpeak(item.content, index)}
                        />
                      </Tooltip>
                      <Tooltip title={copiedId === index ? '已复制' : '复制内容'}>
                        <Button type="text" size="small" icon={copiedId === index ? <Check size={14} color="#52c41a" /> : <Copy size={14} />} onClick={() => onCopy(item.content, index)} />
                      </Tooltip>
                    </div>
                  </div>
                )}
              </Card>
              <div style={{ fontSize: '11px', color: 'var(--muted-fg)', marginTop: '4px', padding: '0 4px' }}>
                {item.role === 'user' ? '你' : '助手'}
              </div>
              {item.role === 'assistant' && Array.isArray(item.relatedQuestions) && item.relatedQuestions.length > 0 && (
                <div style={{ marginTop: '10px', width: '100%' }}>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    猜你想问
                  </Text>
                  <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                    {item.relatedQuestions.slice(0, 3).map((q: string, idx: number) => (
                      <Card
                        key={idx}
                        size="small"
                        hoverable
                        style={{ borderRadius: 10, cursor: 'pointer', border: '1px solid var(--border-color)' }}
                        styles={{ body: { padding: '10px 12px' } }}
                        onClick={() => {
                          const safe = sanitizeRelatedQuestion(q);
                          if (!safe) return;
                          onRelatedSetInput(safe);
                          onRelatedClick(safe);
                          requestAnimationFrame(() => {
                            if (scrollRef.current) {
                              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                            }
                          });
                        }}
                      >
                        <Text ellipsis style={{ display: 'block' }}>
                          {q}
                        </Text>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </>
    );
  }
);

const Chat: React.FC = () => {
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<any[]>([]);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [creatingCardIndex, setCreatingCardIndex] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [mode, setMode] = useState<'qa' | 'summary' | 'code'>(() => {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === 'qa' || saved === 'summary' || saved === 'code') return saved;
    return 'qa';
  });
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const { sessions, activeSessionId, addMessage, updateLastMessage, isLoading, setLoading, deepThinkEnabled, setDeepThinkEnabled, llmConfig, authToken, clearAuth } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const voiceTextRef = useRef<string>('');
  const voiceSentRef = useRef<boolean>(false);
  const speechRef = useRef<any>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const authHeader = useMemo(() => {
    const h: Record<string, string> = {};
    const t = (authToken || '').trim();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }, [authToken]);

  const handleCopy = useCallback((text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(index);
    messageApi.success('已复制到剪贴板');
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeSession?.messages]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {}
  }, [mode]);

  const sanitizeRelatedQuestion = useCallback((text: unknown): string => {
    const t = String(text ?? '');
    const stripped = t.replace(/<[^>]*>/g, '').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!stripped) return '';
    return stripped.length > 120 ? stripped.slice(0, 120).trim() : stripped;
  }, []);

  const trackRelatedClick = useCallback((question: string) => {
    const payload = {
      event: 'related_question_click',
      ts_ms: Date.now(),
      payload: {
        question,
        mode,
        session_id: activeSessionId,
      },
    };
    const url = 'http://localhost:8000/events/track';
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [activeSessionId, authHeader, mode]);

  const handleSend = async (overrideText?: string) => {
    if (!activeSessionId) return;
    const userMsg = (overrideText ?? input).trim();
    if (!userMsg) return;
    const noThink = !deepThinkEnabled;
    const queryToSend = noThink ? `${userMsg} /no_think` : userMsg;
    setInput('');
    
    // 1. Add user message
    addMessage(activeSessionId, { role: 'user', content: userMsg });
    
    // 2. Add placeholder assistant message
    addMessage(activeSessionId, { role: 'assistant', content: '...' });
    
    setLoading(true);

    try {
      const response = await fetch('http://localhost:8000/chat/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          query: queryToSend,
          history: (activeSession?.messages || []).map(m => ({ role: m.role, content: m.content })),
          no_think: noThink,
          mode,
          llm: {
            base_url: llmConfig.baseUrl,
            api_key: llmConfig.apiKey,
            model: llmConfig.model,
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          try {
            clearAuth();
          } catch {}
          messageApi.error('登录已过期，请重新登录');
          updateLastMessage(activeSessionId, '登录已过期，请重新登录');
          return;
        }
        const t = await response.text().catch(() => '');
        updateLastMessage(activeSessionId, t || `请求失败：${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantMsg = '';
      let currentSources: any[] = [];
      let related: string[] | undefined;
      let flushTimer: number | null = null;
      let lastFlushedAt = 0;
      let sawDone = false;
      let noCards = false;
      let noReferences = false;

      const flush = (force = false) => {
        const now = Date.now();
        if (!force && now - lastFlushedAt < 40) return;
        lastFlushedAt = now;
        const rel = related && related.length ? related : undefined;
        updateLastMessage(activeSessionId, assistantMsg || '正在思考...', currentSources, rel, noCards, noReferences);
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flush();
        }, 50);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const dataLines = part
            .split('\n')
            .map((l) => l.trimEnd())
            .filter((l) => l.startsWith('data:'));
          for (const dl of dataLines) {
            const payloadText = dl.slice(5).trimStart();
            if (!payloadText) continue;
            try {
              const data = JSON.parse(payloadText);
              if (data.type === 'context') {
                currentSources = Array.isArray(data.chunks) ? data.chunks : [];
                scheduleFlush();
              } else if (data.type === 'content') {
                assistantMsg += String(data.delta || '');
                scheduleFlush();
              } else if (data.type === 'done') {
                  const usedIds: number[] = Array.isArray(data.used_chunk_ids) ? data.used_chunk_ids : [];
                  const citations: any[] = Array.isArray(data.citations) ? data.citations : [];
                  noCards = data.no_cards || false;
                  noReferences = data.no_references || false;
                  if (citations.length) {
                    const used = citations.map((c) => ({ ...c, used: true }));
                    const others = currentSources
                      .filter((s) => !usedIds.includes(s.id))
                      .slice(0, 3)
                      .map((s) => ({ ...s, used: false }));
                    currentSources = [...used, ...others];
                  } else {
                    const withUsed = currentSources.map((s) => ({ ...s, used: usedIds.includes(s.id) }));
                    const used = withUsed.filter((s) => s.used);
                    const others = withUsed.filter((s) => !s.used).slice(0, 3);
                    currentSources = [...used, ...others];
                  }
                  sawDone = true;
                  // 保存no_cards和no_references到消息中
                  (activeSession?.messages || []).forEach((msg) => {
                    if (msg.role === 'assistant' && msg.content === '...') {
                      msg.no_cards = noCards;
                      msg.no_references = noReferences;
                    }
                  });
                  flush(true);
                  setLoading(false);
              } else if (data.type === 'related_questions') {
                const relatedRaw: unknown[] = Array.isArray(data.related_questions) ? data.related_questions : [];
                related = relatedRaw.map(sanitizeRelatedQuestion).filter(Boolean).slice(0, 3);
                flush(true);
              } else if (data.type === 'error') {
                assistantMsg = `出错了: ${String(data.message || '')}`;
                flush(true);
                setLoading(false);
              }
            } catch (e) {
              console.error('Error parsing SSE data', e);
            }
          }
        }
      }

      if (!sawDone) {
        flush(true);
      }
    } catch (error) {
      console.error('Chat error', error);
      updateLastMessage(activeSessionId, '抱歉，系统响应失败，请检查后端服务。');
    } finally {
      setLoading(false);
    }
  };

  const createFlashcardsFromAnswer = useCallback(async (answer: string, index: number) => {
    if (!activeSessionId) return;
    const safeAnswer = (answer || '').trim();
    if (!safeAnswer || safeAnswer === '...') return;
    const msgs = activeSession?.messages || [];
    let query: string | undefined;
    for (let i = index - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user') {
        query = String(msgs[i]?.content || '').trim();
        break;
      }
    }
    setCreatingCardIndex(index);
    try {
      const res = await fetch('http://localhost:8000/flashcards/from_answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          answer: safeAnswer,
          query,
          count: 3,
          llm: {
            base_url: llmConfig.baseUrl,
            api_key: llmConfig.apiKey,
            model: llmConfig.model,
          },
        }),
      });
      if (res.status === 401) {
        try {
          clearAuth();
        } catch {}
        messageApi.error('登录已过期，请重新登录');
        return;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(t || 'request failed');
      }
      const data = await res.json();
      const n = Array.isArray(data?.created_ids) ? data.created_ids.length : 0;
      messageApi.success(`已生成并保存 ${n || 0} 张卡片`);
    } catch (e) {
      messageApi.error('生成卡片失败，请检查后端与模型配置');
    } finally {
      setCreatingCardIndex(null);
    }
  }, [activeSession?.messages, activeSessionId, authHeader, clearAuth, llmConfig.apiKey, llmConfig.baseUrl, llmConfig.model]);

  const openSourcesDrawer = useCallback((srcs: any[]) => {
    setSources(srcs || []);
    setDrawerVisible(true);
  }, []);

  const setInputFromRelated = useCallback((safe: string) => {
    setInput(safe);
  }, []);

  const startVoice = () => {
    if (isLoading) return;
    if (isListening) return;

    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      messageApi.warning('当前浏览器不支持语音识别，建议使用 Chrome/Edge。');
      return;
    }

    voiceTextRef.current = '';
    voiceSentRef.current = false;
    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      try {
        let transcript = '';
        const results = event.results;
        for (let i = 0; i < results.length; i++) {
          transcript += results[i][0]?.transcript ?? '';
        }
        transcript = transcript.trim();
        voiceTextRef.current = transcript;
        setInput(transcript);
      } catch (e) {
        console.error('Speech recognition result error', e);
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      recognitionRef.current = null;
      const err = String(event?.error ?? 'unknown');
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        messageApi.error('麦克风权限被拒绝，请允许浏览器使用麦克风后重试。');
      } else {
        messageApi.error(`语音识别失败: ${err}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      const text = (voiceTextRef.current || '').trim();
      if (text && !voiceSentRef.current) {
        voiceSentRef.current = true;
        handleSend(text);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      recognitionRef.current = null;
      setIsListening(false);
      messageApi.error('启动语音识别失败，请重试。');
    }
  };

  const stopVoice = () => {
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch (e) {
      recognitionRef.current = null;
      setIsListening(false);
    }
  };

  const handleSpeak = (text: string, index: number) => {
    // 停止当前正在播放的语音
    if (speechRef.current) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
    }

    // 检查浏览器是否支持语音合成
    if ('speechSynthesis' in window) {
      const speech = new SpeechSynthesisUtterance(text);
      speech.lang = 'zh-CN';
      speech.rate = 1;
      speech.pitch = 1;
      speech.volume = 1;

      // 设置语音结束时的回调
      speech.onend = () => {
        setSpeakingIndex(null);
        // 3分钟后清理（这里简化处理，实际可以使用setTimeout）
      };

      // 开始播放语音
      window.speechSynthesis.speak(speech);
      setSpeakingIndex(index);
      speechRef.current = speech;
    } else {
      messageApi.warning('当前浏览器不支持语音合成');
    }
  };



  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', marginBottom: '0', padding: '10px 10px 160px 10px' }}>
        <MessageList
          messages={(activeSession?.messages || []) as ChatMessage[]}
          copiedId={copiedId}
          onCopy={handleCopy}
          onOpenSources={openSourcesDrawer}
          onCreateFlashcards={createFlashcardsFromAnswer}
          creatingCardIndex={creatingCardIndex}
          sanitizeRelatedQuestion={sanitizeRelatedQuestion}
          onRelatedClick={trackRelatedClick}
          onRelatedSetInput={setInputFromRelated}
          scrollRef={scrollRef}
          onSpeak={handleSpeak}
          speakingIndex={speakingIndex}
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-white/80 backdrop-blur-md rounded-t-3xl border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] transition-all duration-300">
        <div className="flex items-end gap-3 w-full bg-gray-50/50 p-2 rounded-2xl border border-gray-200 focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100 transition-all duration-200">
          <Input 
            placeholder="输入您的问题..." 
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            onPressEnter={() => handleSend()}
            disabled={isLoading}
            className="!border-none !shadow-none !bg-transparent focus-visible:!ring-0 px-2"
          />
          <div className="flex gap-2 pb-1">
            <Tooltip title={isListening ? '停止语音输入' : '语音输入'}>
              <GradientButton
                onClick={isListening ? stopVoice : startVoice}
                disabled={isLoading}
                className={`!min-w-0 !px-0 !w-9 !h-9 !rounded-xl flex-shrink-0 transition-all duration-200 ${
                  isListening ? "!bg-red-500 hover:!bg-red-600" : "!bg-gray-200 hover:!bg-gray-300 !text-gray-600"
                }`}
              >
                {isListening ? <MicOff size={16} className="text-white" /> : <Mic size={16} />}
              </GradientButton>
            </Tooltip>
            <GradientButton 
              onClick={() => handleSend()} 
              disabled={isLoading || !input.trim()} 
              className={`!min-w-0 !px-0 !w-9 !h-9 !rounded-xl flex-shrink-0 transition-all duration-200 ${
                input.trim() 
                  ? "!bg-gradient-to-br !from-blue-500 !to-indigo-600 hover:!shadow-lg hover:!shadow-blue-500/30" 
                  : "!bg-gray-200 !text-gray-400 !cursor-not-allowed"
              }`}
            >
              {isLoading ? <span className="animate-pulse">...</span> : <Send size={16} className={input.trim() ? "text-white" : ""} />}
            </GradientButton>
          </div>
        </div>
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GradientButton
              onClick={() => setDeepThinkEnabled(!deepThinkEnabled)}
              className={`!min-w-0 !px-3 !py-1 !h-8 !rounded-full !text-xs font-medium transition-all duration-200 ${
                deepThinkEnabled 
                  ? "!bg-blue-600 !text-white hover:!bg-blue-700" 
                  : "!bg-white !text-gray-700 !border !border-gray-200 hover:!bg-gray-50"
              }`}
              style={{
                boxShadow: deepThinkEnabled ? '0 2px 8px rgba(37, 99, 235, 0.2)' : 'none',
                background: deepThinkEnabled ? undefined : 'white'
              }}
            >
              深度思考
            </GradientButton>
            <Segmented
              size="small"
              value={mode}
              options={[
                { label: '问答', value: 'qa' },
                { label: '摘要', value: 'summary' },
                { label: '代码', value: 'code' },
              ]}
              onChange={(val: "qa" | "summary" | "code") => setMode(val)}
            />
          </div>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            所有处理均在本地完成，保护您的隐私。
          </Text>
        </div>
      </div>

      <Drawer
        title="参考来源详情"
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        panelClassName="!bg-white !text-black"
        contentClassName="!bg-white"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {sources.map((src, index) => (
            <Card 
              key={index}
              size="small" 
              style={{ border: '1px solid #e5e7eb', background: '#ffffff' }}
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Tag color={src.used ? "green" : "blue"}>{src.used ? "已引用" : "检索"} [{src.id}]</Tag>
                    {typeof src.chunk_index === 'number' && (
                      <Tag color="default">第{src.chunk_index + 1}段</Tag>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Text type="secondary" style={{ fontSize: '12px', maxWidth: '240px' }} ellipsis>
                      {src.source}
                    </Text>
                    <GradientButton
                      onClick={() => {
                        navigator.clipboard.writeText(String(src.content || ''));
                        messageApi.success('已复制引用片段');
                      }}
                      className="!min-w-0 !px-2 !py-1 !h-auto !rounded-sm text-xs"
                    >
                      <Copy size={12} />
                    </GradientButton>
                  </div>
                </div>
              }
            >
              {(typeof src.rerank_score === 'number' || typeof src.recall_score === 'number') && (
                <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--muted-fg)' }}>
                  {typeof src.recall_score === 'number' ? `recall: ${src.recall_score.toFixed(4)}` : ''}
                  {typeof src.recall_score === 'number' && typeof src.rerank_score === 'number' ? ' · ' : ''}
                  {typeof src.rerank_score === 'number' ? `rerank: ${src.rerank_score.toFixed(4)}` : ''}
                </div>
              )}
              <Text style={{ fontSize: '14px', lineHeight: '1.6' }}>
                {src.full_content ? (
                  <div dangerouslySetInnerHTML={{ 
                    __html: src.full_content.replace(/([^\n。！？.!?]+)/g, '<span class="text-snippet">$1</span>') 
                  }} />
                ) : (
                  src.content
                )}
              </Text>
            </Card>
          ))}
          {sources.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted-fg)' }}>暂无参考来源</div>}
        </div>
      </Drawer>
    </div>
  );
};

export default React.memo(Chat);

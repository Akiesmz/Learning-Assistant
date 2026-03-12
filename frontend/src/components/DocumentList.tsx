import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload as UploadIcon,
  FileText,
  Trash2,
  CheckCircle,
  Loader2,
  Search,
  FileDown,
  Clock,
  HardDrive,
  AlertTriangle,
  RefreshCw,
  Key,
} from "lucide-react";
import axios from "axios";
import { useStore, type DocumentMeta } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlowPanel } from "@/components/ui/twenty-first";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { notify } from "@/lib/notify";
import { Skeleton } from "@/components/ui/skeleton";

const API_BASE = "http://localhost:8000";

function formatRelativeUpload(tsMs: number) {
  const ts = Number(tsMs) || 0;
  if (!ts) return "未知时间";
  const diffMs = Date.now() - ts;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "刚刚上传";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前上传`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前上传`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前上传`;
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} 上传`;
}

function formatSize(sizeBytes: number) {
  const b = Number(sizeBytes);
  if (!Number.isFinite(b) || b < 0) return "未知大小";
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

const DocumentList: React.FC = () => {
  const { documents, setDocuments, docParseMode, setDocParseMode } = useStore();
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pdfPwdOpen, setPdfPwdOpen] = useState(false);
  const [pdfPwdSubmitting, setPdfPwdSubmitting] = useState(false);
  const [pdfPwdFile, setPdfPwdFile] = useState<File | null>(null);
  const [pdfPwdValue, setPdfPwdValue] = useState("");
  const [pdfPwdError, setPdfPwdError] = useState<string | null>(null);
  const [pdfPwdMode, setPdfPwdMode] = useState<"upload" | "retry">("upload");
  const [pdfPwdRetryFilename, setPdfPwdRetryFilename] = useState<string | null>(null);
  const [pdfPwdRetryStage, setPdfPwdRetryStage] = useState<"all" | "index" | "kg" | "summary">("index");
  const [searchText, setSearchText] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDoc, setSummaryDoc] = useState<DocumentMeta | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<"idle" | "loading" | "pending" | "ready" | "failed">("idle");
  const [summaryText, setSummaryText] = useState("");
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const [deleteFilename, setDeleteFilename] = useState<string | null>(null);
  const [mineruConfigOpen, setMineruConfigOpen] = useState(false);
  const [mineruToken, setMineruToken] = useState("");
  const [mineruTokenMasked, setMineruTokenMasked] = useState<string | null>(null);
  const [mineruSaving, setMineruSaving] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const fetchDocuments = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/documents/`);
      const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
      setDocuments(docs);
    } catch (e) {
      console.error("Failed to fetch documents", e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadMineruConfig = async () => {
    try {
      const res = await axios.get(`${API_BASE}/config/mineru`);
      if (res.data?.has_token) {
        setMineruTokenMasked(res.data.token_masked);
      } else {
        setMineruTokenMasked(null);
      }
    } catch (e) {
      console.error("Failed to load mineru config", e);
    }
  };

  const saveMineruConfig = async () => {
    setMineruSaving(true);
    try {
      await axios.post(`${API_BASE}/config/mineru`, { token: mineruToken });
      notify("MinerU 配置已保存", "success");
      setMineruConfigOpen(false);
      setMineruToken("");
      loadMineruConfig();
    } catch (e) {
      notify("保存失败", "error");
    } finally {
      setMineruSaving(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
    loadMineruConfig();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchDocuments(true).catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleSelectFile(file).catch(() => {});
    }
  };

  const filteredDocs = documents.filter((doc) =>
    String(doc?.filename || "").toLowerCase().includes(searchText.toLowerCase())
  );

  const handleDelete = async (filename: string) => {
    try {
      await axios.delete(`${API_BASE}/documents/${filename}`);
      notify(`文件 ${filename} 已删除`, "success");
      if (summaryDoc?.filename === filename) {
        setSummaryOpen(false);
        setSummaryDoc(null);
        setSummaryStatus("idle");
        setSummaryText("");
      }
      fetchDocuments();
    } catch {
      notify("删除失败", "error");
    }
  };

  const loadSummary = async (filename: string) => {
    setSummaryStatus("loading");
    setSummaryText("");
    try {
      const res = await axios.get(`${API_BASE}/documents/${encodeURIComponent(filename)}/summary`);
      const status = String(res.data?.status || "");
      if (status === "ready" && typeof res.data?.summary === "string" && res.data.summary.trim()) {
        setSummaryStatus("ready");
        setSummaryText(res.data.summary.trim());
        fetchDocuments().catch(() => {});
        return;
      }
      if (status === "pending") {
        setSummaryStatus("pending");
        fetchDocuments().catch(() => {});
        return;
      }
      setSummaryStatus("failed");
    } catch {
      setSummaryStatus("failed");
    }
  };

  const openSummary = (doc: DocumentMeta) => {
    setSummaryDoc(doc);
    setSummaryOpen(true);
    loadSummary(doc.filename).catch(() => {});
  };

  const uploadDocument = async (file: File, password?: string) => {
    const form = new FormData();
    form.append("file", file);
    const pwd = (password || "").trim();
    if (pwd) form.append("password", pwd);
    if (docParseMode && docParseMode !== "auto") form.append("parser", docParseMode);
    return axios.post(`${API_BASE}/documents/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  };

  const retryWithPassword = async () => {
    if (pdfPwdMode === "upload") {
      if (!pdfPwdFile) return;
    } else if (!pdfPwdRetryFilename) {
      return;
    }
    const pwd = (pdfPwdValue || "").trim();
    if (!pwd) {
      setPdfPwdError("请输入密码");
      return;
    }
    setPdfPwdSubmitting(true);
    setPdfPwdError(null);
    try {
      if (pdfPwdMode === "upload") {
        setIsUploading(true);
        await uploadDocument(pdfPwdFile!, pwd);
        setPdfPwdOpen(false);
        setPdfPwdFile(null);
        setPdfPwdRetryFilename(null);
        setPdfPwdValue("");
        setPdfPwdError(null);
        notify(`${pdfPwdFile!.name} 上传成功并已处理`, "success");
        fetchDocuments().catch(() => {});
      } else {
        setRetryingKey(`${pdfPwdRetryFilename}:${pdfPwdRetryStage}`);
        await axios.post(`${API_BASE}/documents/${encodeURIComponent(pdfPwdRetryFilename!)}/retry`, {
          stage: pdfPwdRetryStage,
          password: pwd,
          parser: docParseMode && docParseMode !== "auto" ? docParseMode : undefined,
        });
        setPdfPwdOpen(false);
        setPdfPwdFile(null);
        setPdfPwdRetryFilename(null);
        setPdfPwdValue("");
        setPdfPwdError(null);
        notify("已提交重试任务", "success");
        fetchDocuments().catch(() => {});
      }
    } catch (e: any) {
      const code = e?.response?.data?.detail;
      if (code === "pdf_password_incorrect") {
        setPdfPwdError("密码不正确，请重试");
        return;
      }
      if (code === "pdf_password_required") {
        setPdfPwdError("该 PDF 需要密码，请输入后继续");
        return;
      }
      if (code === "already_running") {
        setPdfPwdError(null);
        notify("任务正在进行中，请稍后再试", "warning");
        setPdfPwdOpen(false);
        return;
      }
      setPdfPwdOpen(false);
      setPdfPwdFile(null);
      setPdfPwdRetryFilename(null);
      setPdfPwdValue("");
      setPdfPwdError(null);
      notify(pdfPwdMode === "upload" ? `${pdfPwdFile?.name || "文件"} 上传失败` : "重试失败", "error");
    } finally {
      setPdfPwdSubmitting(false);
      setIsUploading(false);
      setRetryingKey(null);
    }
  };

  const handleSelectFile = async (fileObj: File) => {
    setIsUploading(true);
    setLoading(true);
    try {
      await uploadDocument(fileObj);
      notify(`${fileObj.name} 上传成功并已处理`, "success");
      fetchDocuments().catch(() => {});
    } catch (e: any) {
      const code = e?.response?.data?.detail;
      if (code === "pdf_password_required") {
        setPdfPwdFile(fileObj);
        setPdfPwdValue("");
        setPdfPwdError(null);
        setPdfPwdMode("upload");
        setPdfPwdOpen(true);
        return;
      }
      if (code === "pdf_password_incorrect") {
        setPdfPwdFile(fileObj);
        setPdfPwdError("密码不正确，请重试");
        setPdfPwdMode("upload");
        setPdfPwdOpen(true);
        return;
      }
      notify(`${fileObj.name} 上传失败`, "error");
    } finally {
      setIsUploading(false);
      setLoading(false);
    }
  };

  const retryDocument = async (filename: string, stage: "all" | "index" | "kg" | "summary") => {
    const key = `${filename}:${stage}`;
    setRetryingKey(key);
    try {
      await axios.post(`${API_BASE}/documents/${encodeURIComponent(filename)}/retry`, {
        stage,
        parser: docParseMode && docParseMode !== "auto" ? docParseMode : undefined,
      });
      notify("已提交重试任务", "success");
      fetchDocuments().catch(() => {});
    } catch (e: any) {
      const code = e?.response?.data?.detail;
      if (code === "already_running") {
        notify("任务正在进行中，请稍后再试", "warning");
        return;
      }
      notify(`重试失败：${String(code || e?.message || e)}`, "error");
    } finally {
      setRetryingKey(null);
    }
  };

  const stageTag = useMemo(() => {
    const render = (opts: {
      label: string;
      status?: string | null;
      error?: string | null;
      readyText?: string;
      pendingText?: string;
      failedText?: string;
    }) => {
      const st = String(opts.status || "").trim().toLowerCase();
      if (st === "ready") {
        return (
          <Badge variant="success" title={opts.error || ""} className="mr-2 mt-2">
            <CheckCircle size={10} className="mr-1" />
            {opts.readyText || `${opts.label}已就绪`}
          </Badge>
        );
      }
      if (st === "pending") {
        return (
          <Badge variant="warning" className="mr-2 mt-2">
            <Loader2 size={10} className="mr-1 animate-spin" />
            {opts.pendingText || `${opts.label}处理中`}
          </Badge>
        );
      }
      if (st === "failed") {
        const t = opts.failedText || `${opts.label}失败`;
        return (
          <Badge variant="destructive" title={opts.error || ""} className="mr-2 mt-2">
            <AlertTriangle size={10} className="mr-1" />
            {t}
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="mr-2 mt-2">
          {`${opts.label}状态未知`}
        </Badge>
      );
    };
    return { render };
  }, []);

  return (
    <div
      className="w-full h-full flex flex-col bg-grid-white/[0.05] relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary m-4 rounded-xl flex items-center justify-center pointer-events-none animate-in fade-in zoom-in-95">
          <div className="bg-background/80 p-6 rounded-xl shadow-xl flex flex-col items-center gap-3">
            <UploadIcon size={48} className="text-primary animate-bounce" />
            <div className="text-xl font-bold text-primary">释放以上传文件</div>
          </div>
        </div>
      )}
      <GlowPanel className="mb-6 p-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold m-0">文档库管理</h2>
          <p className="text-sm text-muted-foreground">上传并管理您的学习资料，所有文件均本地加密处理</p>
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setMineruConfigOpen(true);
              setMineruToken("");
              loadMineruConfig();
            }}
            title="配置 MinerU API Key"
          >
            <Key size={16} className={mineruTokenMasked ? "text-green-500" : "text-muted-foreground"} />
          </Button>
          <Select
            value={docParseMode}
            onChange={(e) => setDocParseMode(e.target.value as any)}
            className="w-[220px]"
          >
            <option value="fallback">轻量解析（原方案）</option>
            <option value="mineru">高质量解析（MinerU）</option>
            <option value="auto">自动（优先 MinerU）</option>
          </Select>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索文档..."
              className="w-[250px] pl-9"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                handleSelectFile(f).catch(() => {});
              }
              e.currentTarget.value = "";
            }}
          />
          <GradientButton
            onClick={() => uploadInputRef.current?.click()}
            disabled={isUploading}
            className="!min-w-0 !px-4 !py-2"
          >
            {isUploading ? <Loader2 className="animate-spin mr-1" size={16} /> : <UploadIcon className="mr-1" size={16} />}
            {isUploading ? "上传中..." : "上传文档"}
          </GradientButton>
        </div>
      </div>
      </GlowPanel>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-[140px]">
                <CardContent className="pt-6 h-full flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div className="flex items-start gap-3 w-full">
                      <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                      <div className="space-y-2 w-full">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-4">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <div className="flex gap-2">
                      <Skeleton className="h-8 w-8 rounded-md" />
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : filteredDocs.length > 0 ? (
            filteredDocs.map((doc) => (
              <Card key={doc.filename} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-5">
                  <div
                    className="flex gap-4 items-start cursor-pointer"
                    onClick={() => openSummary(doc)}
                  >
                    <div className="w-12 h-12 rounded-[10px] bg-blue-100 flex items-center justify-center text-blue-600">
                      <FileText size={24} />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="font-semibold truncate">{doc.filename}</div>
                      <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                        <Clock size={12} />
                        <span>{formatRelativeUpload(doc.uploaded_ts_ms)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                        <HardDrive size={12} />
                        <span>
                          {formatSize(doc.size_bytes)} ·{" "}
                          {String(doc.index_status || "").toLowerCase() === "ready"
                            ? "本地索引已就绪"
                            : String(doc.index_status || "").toLowerCase() === "pending"
                            ? "索引构建中"
                            : String(doc.index_status || "").toLowerCase() === "failed"
                            ? "索引失败"
                            : "索引状态未知"}
                        </span>
                      </div>

                      <div className="mt-2">
                        {stageTag.render({ label: "解析", status: doc.parse_status, error: doc.parse_error, readyText: "已解析" })}
                        {stageTag.render({ label: "索引", status: doc.index_status, error: doc.index_error, readyText: "RAG 就绪", pendingText: "索引中" })}
                        {stageTag.render({ label: "图谱", status: doc.kg_status, error: doc.kg_error, readyText: "图谱已就绪", pendingText: "图谱生成中" })}
                        {doc.summary_status === "ready" ? <Badge variant="secondary" className="mr-2 mt-2">摘要已就绪</Badge> : null}
                        {doc.summary_status === "pending" ? <Badge variant="warning" className="mr-2 mt-2">摘要生成中</Badge> : null}
                        {doc.summary_status === "failed" ? (
                          <Badge variant="destructive" className="mr-2 mt-2" title="摘要生成失败，可重试">
                            <AlertTriangle size={10} className="mr-1" />
                            摘要失败
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-2 flex gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retryingKey === `${doc.filename}:index`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const err = String(doc.parse_error || doc.index_error || "");
                            if (err === "pdf_password_required" || err === "pdf_password_incorrect") {
                              setPdfPwdMode("retry");
                              setPdfPwdRetryFilename(doc.filename);
                              setPdfPwdRetryStage("index");
                              setPdfPwdFile(null);
                              setPdfPwdValue("");
                              setPdfPwdError(err === "pdf_password_incorrect" ? "密码不正确，请重新输入" : "该 PDF 需要密码，请输入后继续");
                              setPdfPwdOpen(true);
                              return;
                            }
                            retryDocument(doc.filename, "index").catch(() => {});
                          }}
                        >
                          <RefreshCw size={14} className="mr-1" />
                          重建索引
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retryingKey === `${doc.filename}:kg`}
                          onClick={(e) => {
                            e.stopPropagation();
                            retryDocument(doc.filename, "kg").catch(() => {});
                          }}
                        >
                          <RefreshCw size={14} className="mr-1" />
                          重建图谱
                        </Button>
                        {doc.summary_status === "failed" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={retryingKey === `${doc.filename}:summary`}
                            onClick={(e) => {
                              e.stopPropagation();
                              retryDocument(doc.filename, "summary").catch(() => {});
                            }}
                          >
                            <RefreshCw size={14} className="mr-1" />
                            重试摘要
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" title="下载原文（待接入）" onClick={(e) => e.stopPropagation()}>
                      <FileDown size={18} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="删除文档"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteFilename(doc.filename);
                      }}
                    >
                      <Trash2 size={18} className="text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="col-[1/-1] py-24 text-center text-muted-foreground">
              {searchText ? "未找到匹配的文档" : "您的文档库空空如也"}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={mineruConfigOpen}
        onClose={() => setMineruConfigOpen(false)}
        title="配置 MinerU API Key"
        maxWidthClassName="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            配置 MinerU API Key 以启用高质量 PDF 解析功能。
            <br />
            您的密钥将加密存储在本地。
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">API Token</label>
            <Input
              type="password"
              placeholder={mineruTokenMasked || "请输入您的 Token"}
              value={mineruToken}
              onChange={(e) => setMineruToken(e.target.value)}
            />
            {mineruTokenMasked && !mineruToken && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle size={12} />
                当前已配置: {mineruTokenMasked}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMineruToken("");
                saveMineruConfig();
              }}
              className="text-red-500 hover:text-red-600"
            >
              清除配置
            </Button>
            <Button disabled={mineruSaving} onClick={saveMineruConfig}>
              {mineruSaving ? "保存中..." : "保存配置"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={summaryOpen}
        onClose={() => {
          setSummaryOpen(false);
          setSummaryDoc(null);
          setSummaryStatus("idle");
          setSummaryText("");
        }}
        title={summaryDoc ? `文档摘要：${summaryDoc.filename}` : "文档摘要"}
        maxWidthClassName="max-w-[720px]"
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (summaryDoc) loadSummary(summaryDoc.filename).catch(() => {});
              }}
              disabled={!summaryDoc || summaryStatus === "loading"}
            >
              刷新
            </Button>
          </div>
          {summaryStatus === "loading" ? (
            <div className="py-6 flex justify-center">
              <Loader2 className="animate-spin" />
            </div>
          ) : null}
          {summaryStatus === "pending" ? (
            <div className="text-sm text-muted-foreground">摘要生成中（首次打开或刚上传时需要一点时间），稍后点“刷新”。</div>
          ) : null}
          {summaryStatus === "failed" ? (
            <div className="text-sm text-muted-foreground">摘要生成失败，请检查大模型服务是否可用后重试。</div>
          ) : null}
          {summaryStatus === "ready" ? <div className="whitespace-pre-wrap leading-7">{summaryText}</div> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteFilename}
        title="确认删除文档"
        description="删除后相关知识点会从向量库与图谱移除，此操作不可撤销。"
        confirmText="确认删除"
        cancelText="取消"
        danger
        onCancel={() => setDeleteFilename(null)}
        onConfirm={() => {
          if (!deleteFilename) return;
          const filename = deleteFilename;
          setDeleteFilename(null);
          handleDelete(filename).catch(() => {});
        }}
      />

      <Modal
        open={pdfPwdOpen}
        onClose={() => {
          setPdfPwdOpen(false);
          setPdfPwdSubmitting(false);
          setPdfPwdFile(null);
          setPdfPwdRetryFilename(null);
          setPdfPwdValue("");
          setPdfPwdError(null);
        }}
        title={
          pdfPwdMode === "upload"
            ? pdfPwdFile
              ? `请输入 PDF 密码：${pdfPwdFile.name}`
              : "请输入 PDF 密码"
            : pdfPwdRetryFilename
            ? `请输入 PDF 密码：${pdfPwdRetryFilename}`
            : "请输入 PDF 密码"
        }
        maxWidthClassName="max-w-md"
      >
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="输入密码"
            value={pdfPwdValue}
            onChange={(e) => setPdfPwdValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") retryWithPassword().catch(() => {});
            }}
            autoFocus
          />
          {pdfPwdError ? <div className="text-sm text-red-500">{pdfPwdError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPdfPwdOpen(false);
                setPdfPwdSubmitting(false);
                setPdfPwdFile(null);
                setPdfPwdRetryFilename(null);
                setPdfPwdValue("");
                setPdfPwdError(null);
              }}
            >
              取消
            </Button>
            <Button disabled={pdfPwdSubmitting} onClick={() => retryWithPassword().catch(() => {})}>
              {pdfPwdSubmitting ? "处理中..." : "继续解析"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default DocumentList;

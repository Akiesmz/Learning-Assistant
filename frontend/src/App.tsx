import React, { Suspense, lazy, useEffect, useState } from "react";
import Chat from "./components/Chat";
import LayoutComponent from "./components/Layout";
import { useStore } from "./store/useStore";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/lib/notify";
import { Toaster } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

const Dashboard = lazy(() => import("./components/Dashboard"));
const TodayTasks = lazy(() => import("./components/TodayTasks"));
const Quiz = lazy(() => import("./components/Quiz"));
const DocumentList = lazy(() => import("./components/DocumentList"));
const KnowledgeGraph = lazy(() => import("./components/KnowledgeGraph"));
const McpDebug = lazy(() => import("./components/McpDebug"));
const Settings = lazy(() => import("./components/Settings"));

const LoadingPanel: React.FC = () => (
  <div style={{ padding: 20, height: "100%", overflow: "auto" }}>
    <div className="grid gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[60px] w-full rounded-xl" />
      ))}
    </div>
  </div>
);

type ErrorBoundaryState = { hasError: boolean };

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <Card>
            <CardHeader>
              <CardTitle>页面渲染失败</CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ marginBottom: 16, color: "var(--muted-fg)" }}>
                请刷新页面重试。如果持续出现，可能是接口返回异常或数据格式不兼容。
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={() => window.location.reload()}>刷新页面</Button>
                <Button variant="outline" onClick={() => this.setState({ hasError: false })}>
                  重试
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState("chat");
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const { authToken, setAuth, themeMode } = useStore();
  const [confirmPassword, setConfirmPassword] = useState("");

  const { sessions, hasHydrated, addSession, authUsername, clearAuth } =
    useStore();

  useEffect(() => {
    if (hasHydrated && sessions.length === 0) {
      addSession("新会话");
    }
  }, [hasHydrated, sessions.length]);

  useEffect(() => {
    // Sync theme
    const theme = useStore.getState().themeMode;
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // Subscribe to store changes for theme
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      if (state.themeMode === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.setAttribute("data-theme", "light");
        document.documentElement.classList.remove("dark");
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (authUsername) return;
    if (!authToken) return;
    axios
      .get("http://localhost:8000/auth/me")
      .then((resp) => {
        const u = String(resp.data?.username || "");
        if (u) setAuth(authToken, u);
      })
      .catch((e) => {
        if (e?.response?.status === 401) clearAuth();
      });
  }, [authUsername, authToken, setAuth, clearAuth]);

  const openUserModal = () => {
    setUserModalOpen(true);
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const saveUserPassword = async () => {
    if (!authToken) {
      notify("未登录");
      return;
    }
    if (!oldPassword) {
      notify("请输入旧密码");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      notify("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      notify("两次输入的新密码不一致");
      return;
    }
    try {
      const resp = await axios.post("http://localhost:8000/auth/change-password", {
        old_password: oldPassword,
        new_password: newPassword,
      });
      const token = String(resp.data?.token || "");
      const username = String(resp.data?.username || authUsername || "");
      if (token) setAuth(token, username);
      notify("密码已更新");
      setUserModalOpen(false);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (detail === "old_password_incorrect") {
        notify("旧密码不正确");
      } else {
        notify(`修改失败：${String(detail || e?.message || e)}`);
      }
    }
  };

  return (
    <>
      <Toaster position="top-right" theme={themeMode === "dark" ? "dark" : "light"} />
      <LayoutComponent activeTab={activeTab} setActiveTab={setActiveTab} openUserModal={openUserModal}>
        <ErrorBoundary>
          {activeTab === "chat" && <Chat />}
          {activeTab !== "chat" ? (
            <Suspense fallback={<LoadingPanel />}>
              {activeTab === "dashboard" && <Dashboard />}
              {activeTab === "tasks" && <TodayTasks />}
              {activeTab === "quiz" && <Quiz />}
              {activeTab === "documents" && <DocumentList />}
              {activeTab === "graph" && <KnowledgeGraph />}
              {activeTab === "mcp_debug" && <McpDebug />}
              {activeTab === "settings" && <Settings />}
            </Suspense>
          ) : null}
        </ErrorBoundary>
      </LayoutComponent>



      <Modal open={userModalOpen} onClose={() => setUserModalOpen(false)} title="用户信息" maxWidthClassName="max-w-[560px]">
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            当前用户：<span className="font-semibold text-foreground">{authUsername || "未知"}</span>
          </div>
          <div>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  if (authToken) await axios.post("http://localhost:8000/auth/logout");
                } catch {}
                clearAuth();
                setUserModalOpen(false);
              }}
            >
              退出登录
            </Button>
          </div>
          <div className="space-y-1">
            <div className="text-sm">旧密码</div>
            <Input type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-sm">新密码</div>
            <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-sm">确认新密码</div>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setUserModalOpen(false)}>
              关闭
            </Button>
            <Button onClick={() => saveUserPassword().catch(() => {})}>保存密码</Button>
          </div>
        </div>
      </Modal>



      <style>{`
        .session-item:hover {
          background: #f0f7ff !important;
        }
        .session-item:hover .delete-icon {
          opacity: 1 !important;
        }
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #ddd;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #ccc;
        }
      `}</style>
    </>
  );
};

export default App;

import React from "react";
import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Settings,
  Github,
  Expand,
  Compass,
  Plus,
  MessageSquare,
  Trash2,
  BarChart3,
  ListTodo,
  ClipboardList,
  FileText,
  Share2,
  Bot,
  Menu,
  User,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer as Sheet } from "@/components/ui/drawer";

interface LayoutProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  openUserModal: () => void;
  children: ReactNode;
}

const LayoutComponent: React.FC<LayoutProps> = ({ activeTab, setActiveTab, openUserModal, children }) => {
  const { sessions, activeSessionId, addSession, setActiveSession, deleteSession, densityMode, setDensityMode } = useStore();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = React.useState<string | null>(null);

  const menuItems = [
    { key: "dashboard", icon: <BarChart3 size={18} />, label: "仪表盘" },
    { key: "tasks", icon: <ListTodo size={18} />, label: "今日任务" },
    { key: "chat", icon: <MessageSquare size={18} />, label: "智能问答" },
    { key: "quiz", icon: <ClipboardList size={18} />, label: "测验" },
    { key: "documents", icon: <FileText size={18} />, label: "知识库" },
    { key: "graph", icon: <Share2 size={18} />, label: "知识图谱" },
    { key: "mcp_debug", icon: <Bot size={18} />, label: "MCP 调试" },
  ];

  return (
    <div className="min-h-screen flex bg-[var(--app-bg)]">
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex border-r border-[var(--border-color)] bg-[var(--surface-bg)] sticky top-0 h-screen z-[100] flex-col transition-all"
        style={{ width: collapsed ? 80 : 280 }}
      >
        <div className="p-4 border-b border-[var(--border-color)] text-center">
          {!collapsed ? (
            <Button className="w-full h-11 rounded-[10px]" onClick={() => addSession(`新会话 ${sessions.length + 1}`)}>
              <Plus size={18} className="mr-1" />
              新建会话
            </Button>
          ) : (
            <Button size="icon" onClick={() => addSession(`新会话 ${sessions.length + 1}`)}>
              <Plus size={18} />
            </Button>
          )}
        </div>

        <div className="p-2 flex-1 overflow-y-auto">
          {sessions.map((item) => {
            const active = activeSessionId === item.id;
            return (
              <div
                key={item.id}
                className="session-item cursor-pointer rounded-lg mb-1 flex items-center transition-all border"
                style={{
                  background: active ? "#e6f4ff" : "transparent",
                  padding: collapsed ? "12px 0" : "12px 16px",
                  justifyContent: collapsed ? "center" : "space-between",
                  color: active ? "#1677ff" : "#555",
                  borderColor: active ? "#1677ff33" : "transparent",
                }}
                onClick={() => {
                  setActiveSession(item.id);
                  setActiveTab("chat");
                }}
              >
                <div className="flex items-center gap-[10px] overflow-hidden">
                  <MessageSquare size={16} />
                  {!collapsed ? (
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ fontWeight: active ? 600 : 400 }}>
                      {item.name}
                    </div>
                  ) : null}
                </div>
                {!collapsed ? (
                  <Trash2
                    size={14}
                    className="delete-icon"
                    style={{ color: "#ff4d4f", opacity: active ? 1 : 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteSessionId(item.id);
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-[var(--border-color)] flex justify-end">
          <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </Button>
        </div>
      </aside>

      {/* Mobile Drawer Sidebar */}
      <Sheet open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} title="导航菜单">
        <div className="flex flex-col h-full">
          <div className="mb-4">
            <Button className="w-full h-11 rounded-[10px]" onClick={() => {
              addSession(`新会话 ${sessions.length + 1}`);
              setMobileMenuOpen(false);
            }}>
              <Plus size={18} className="mr-1" />
              新建会话
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto -mx-2 px-2">
            {sessions.map((item) => {
              const active = activeSessionId === item.id;
              return (
                <div
                  key={item.id}
                  className="session-item cursor-pointer rounded-lg mb-1 flex items-center transition-all border p-3 justify-between"
                  style={{
                    background: active ? "#e6f4ff" : "transparent",
                    color: active ? "#1677ff" : "#555",
                    borderColor: active ? "#1677ff33" : "transparent",
                  }}
                  onClick={() => {
                    setActiveSession(item.id);
                    setActiveTab("chat");
                    setMobileMenuOpen(false);
                  }}
                >
                  <div className="flex items-center gap-[10px] overflow-hidden">
                    <MessageSquare size={16} />
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ fontWeight: active ? 600 : 400 }}>
                      {item.name}
                    </div>
                  </div>
                  <Trash2
                    size={14}
                    className="text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteSessionId(item.id);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </Sheet>

      <div className="min-w-0 flex-1 flex flex-col">
        <header
          className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--surface-bg)] sticky top-0 z-10 h-16 px-4 md:px-6 gap-3"
        >
          <div className="flex items-center min-w-0 flex-1">
            <Button variant="ghost" size="icon" className="md:hidden mr-2 -ml-2" onClick={() => setMobileMenuOpen(true)}>
              <Menu size={20} />
            </Button>
            <div
              className="font-extrabold text-xl mr-4 md:mr-8 whitespace-nowrap shrink-0 hidden sm:block"
              style={{ color: "#1677ff", letterSpacing: "-0.5px" }}
            >
              AI Learning Assistant
            </div>
            <div className="flex flex-wrap gap-1 md:gap-2 min-w-0 flex-1 overflow-x-auto no-scrollbar">
              {menuItems.map((m) => (
                <Button
                  key={m.key}
                  variant={activeTab === m.key ? "default" : "ghost"}
                  className="h-9"
                  onClick={() => setActiveTab(m.key)}
                >
                  {m.icon}
                  <span className="ml-1">{m.label}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 shrink-0 items-center ml-4">
            <Button
              variant="ghost"
              size="icon"
              title={densityMode === "compact" ? "切换到舒适模式" : "切换到紧凑模式"}
              onClick={() => setDensityMode(densityMode === "compact" ? "comfortable" : "compact")}
            >
              {densityMode === "compact" ? <Expand size={20} /> : <Compass size={20} />}
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a href="https://github.com" target="_blank" rel="noreferrer">
                <Github size={20} />
              </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setActiveTab("settings")}>
              <Settings size={20} />
            </Button>
            <Button variant="ghost" size="icon" onClick={openUserModal}>
              <User size={20} />
            </Button>
          </div>
        </header>

        <main className="p-4 flex-1 min-h-0 bg-[var(--app-bg)] overflow-hidden flex flex-col">
          <div
            className="bg-[var(--surface-bg)] flex-1 min-h-0 rounded-lg flex flex-col overflow-hidden text-[var(--surface-fg)] transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
            style={{ padding: activeTab === "graph" || activeTab === "mcp_debug" ? 0 : 20 }}
          >
            {children}
          </div>
        </main>
      </div>
      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        title="确认删除会话"
        description="删除后该会话中的消息将不可恢复。"
        confirmText="确认删除"
        cancelText="取消"
        danger
        onCancel={() => setPendingDeleteSessionId(null)}
        onConfirm={() => {
          if (!pendingDeleteSessionId) return;
          deleteSession(pendingDeleteSessionId);
          setPendingDeleteSessionId(null);
        }}
      />
    </div>
  );
};

export default LayoutComponent;

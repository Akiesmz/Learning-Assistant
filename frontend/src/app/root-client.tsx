"use client";

import { useEffect, useRef } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import App from "@/App";
import { useStore } from "@/store/useStore";
import LoginPage from "@/components/animated-sign-in";
import { notify } from "@/lib/notify";

const THEME_STORAGE_KEY = "ai-learning-assistant-theme";
const interceptorsInstalledKey = "__ai_assistant_axios_installed__";

export default function ClientRoot() {
  const hasHydrated = useStore((s) => s.hasHydrated);
  const authToken = useStore((s) => s.authToken);
  const installedRef = useRef(false);

  useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;

    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
      const theme =
        saved === "light" || saved === "dark" ? saved : prefersDark ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", theme);
    } catch {}

    const w = window as any;
    if (w[interceptorsInstalledKey]) return;
    w[interceptorsInstalledKey] = true;

    axios.interceptors.request.use((config) => {
      const token = useStore.getState().authToken;
      if (token) {
        config.headers = config.headers || {};
        (config.headers as any).Authorization = `Bearer ${token}`;
      }
      return config;
    });

    axios.interceptors.response.use(
      (resp) => resp,
      (err) => {
        const status = err?.response?.status;
        if (status === 401) {
          try {
            const currentToken = useStore.getState().authToken;
            if (currentToken) {
              notify("登录已过期，请重新登录", "warning");
            }
            useStore.getState().clearAuth();
          } catch {}
        }
        return Promise.reject(err);
      }
    );
  }, []);

  if (!hasHydrated) {
    return (
      <div
        style={{
          padding: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!authToken) {
    return <LoginPage />;
  }

  return <App />;
}

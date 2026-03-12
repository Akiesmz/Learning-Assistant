import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import App from './App.tsx';
import AnimatedLogin from './components/AnimatedLogin.tsx';
import 'katex/dist/katex.min.css';
import 'prism-themes/themes/prism-vsc-dark-plus.css';
import './style.css';
import { notify } from './lib/notify';
import { useStore } from './store/useStore.ts';

const STORAGE_KEY = 'ai-learning-assistant-theme';
(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    const theme = saved === 'light' || saved === 'dark' ? saved : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch {}
})();

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
          notify('登录已过期，请重新登录', 'warning');
        }
        useStore.getState().clearAuth();
      } catch {}
    }
    return Promise.reject(err);
  }
);

const Root: React.FC = () => {
  const hasHydrated = useStore((s) => s.hasHydrated);
  const authToken = useStore((s) => s.authToken);
  if (!hasHydrated) {
    return (
      <div style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!authToken) {
    return <AnimatedLogin />;
  }
  return <App />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

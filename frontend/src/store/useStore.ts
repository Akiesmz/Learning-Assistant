import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
  relatedQuestions?: string[];
  no_cards?: boolean;
  no_references?: boolean;
}

interface ChatSession {
  id: string;
  name: string;
  messages: Message[];
}

interface LlmConfig {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface DocumentMeta {
  filename: string;
  uploaded_ts_ms: number;
  size_bytes: number;
  summary_status?: string | null;
  parse_status?: string | null;
  parse_error?: string | null;
  index_status?: string | null;
  index_error?: string | null;
  kg_status?: string | null;
  kg_error?: string | null;
}

interface AppState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  documents: DocumentMeta[];
  isLoading: boolean;
  docParseMode: 'auto' | 'mineru' | 'fallback';
  deepThinkEnabled: boolean;
  llmConfig: LlmConfig;
  hasHydrated: boolean;
  authToken: string;
  authUsername: string;
  themeMode: 'light' | 'dark';
  densityMode: 'compact' | 'comfortable';
  
  // Actions
  addSession: (name: string) => void;
  deleteSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateLastMessage: (sessionId: string, content: string, sources?: any[], relatedQuestions?: string[], noCards?: boolean, noReferences?: boolean) => void;
  setDocuments: (docs: DocumentMeta[]) => void;
  setLoading: (loading: boolean) => void;
  setDocParseMode: (mode: 'auto' | 'mineru' | 'fallback') => void;
  setDeepThinkEnabled: (enabled: boolean) => void;
  setLlmConfig: (config: LlmConfig) => void;
  setHasHydrated: (hydrated: boolean) => void;
  setAuth: (token: string, username: string) => void;
  clearAuth: () => void;
  setThemeMode: (mode: 'light' | 'dark') => void;
  setDensityMode: (mode: 'compact' | 'comfortable') => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      sessions: [],
      activeSessionId: null,
      documents: [],
      isLoading: false,
      docParseMode: 'fallback',
      deepThinkEnabled: true,
      llmConfig: {
        providerName: '本地（LM Studio）',
        baseUrl: 'http://localhost:1234/v1',
        apiKey: 'lm-studio',
        model: '',
      },
      hasHydrated: false,
      authToken: '',
      authUsername: '',
      themeMode: 'light',
      densityMode: 'comfortable',

      addSession: (name) => set((state) => {
        const newSession = {
          id: Date.now().toString(),
          name,
          messages: [],
        };
        return {
          sessions: [...state.sessions, newSession],
          activeSessionId: newSession.id,
        };
      }),

      deleteSession: (id) => set((state) => {
        const remainingSessions = state.sessions.filter((s) => s.id !== id);
        return {
          sessions: remainingSessions,
          activeSessionId: state.activeSessionId === id 
            ? (remainingSessions[0]?.id || null) 
            : state.activeSessionId,
        };
      }),

      setActiveSession: (id) => set({ activeSessionId: id }),

      addMessage: (sessionId, message) => set((state) => ({
        sessions: state.sessions.map((s) => 
          s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s
        ),
      })),

      updateLastMessage: (sessionId: string, content: string, sources?: any[], relatedQuestions?: string[], noCards?: boolean, noReferences?: boolean) => set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id === sessionId && s.messages.length > 0) {
            const newMessages = [...s.messages];
            const lastMsg = { ...newMessages[newMessages.length - 1] };
            lastMsg.content = content;
            if (sources) lastMsg.sources = sources;
            if (relatedQuestions) lastMsg.relatedQuestions = relatedQuestions;
            if (noCards !== undefined) lastMsg.no_cards = noCards;
            if (noReferences !== undefined) lastMsg.no_references = noReferences;
            newMessages[newMessages.length - 1] = lastMsg;
            return { ...s, messages: newMessages };
          }
          return s;
        }),
      })),

      setDocuments: (docs) => set({ documents: docs }),
      
      setLoading: (loading) => set({ isLoading: loading }),
      setDocParseMode: (mode) => set({ docParseMode: mode }),
      setDeepThinkEnabled: (enabled) => set({ deepThinkEnabled: enabled }),
      setLlmConfig: (config) => set({ llmConfig: config }),
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      setAuth: (token, username) => set({ authToken: token || '', authUsername: username || '' }),
      clearAuth: () => set({ authToken: '', authUsername: '' }),
      setThemeMode: (mode) => set({ themeMode: mode }),
      setDensityMode: (mode) => set({ densityMode: mode }),
    }),
    {
      name: 'ai-learning-assistant-storage',
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages.slice(-50),
        })),
        activeSessionId: state.activeSessionId,
        docParseMode: state.docParseMode,
        deepThinkEnabled: state.deepThinkEnabled,
        llmConfig: state.llmConfig,
        authToken: state.authToken,
        authUsername: state.authUsername,
        themeMode: state.themeMode,
        densityMode: state.densityMode,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

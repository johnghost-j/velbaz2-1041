import { create } from 'zustand';
import { api, onTokenUpdate } from './api';
import { getDeviceId } from './beta';

interface User {
  id: string;
  email: string;
  name: string;
  plan: string;
  tokens: number;
  role?: string;
}

// Admin allowlist (miroir du backend ADMIN_EMAILS). Money Maker = bêta privée admin.
const ADMIN_EMAILS = ['johnemadmansour1@gmail.com'];
export function isAdminUser(user: { email?: string | null; role?: string | null } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) return true;
  return false;
}

interface AuthStore {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  updateTokens: (tokens: number) => void;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  init: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  user: null,
  loading: true,

  setUser: (user) => set({ user }),
  updateTokens: (tokens) => set((s) => s.user ? { user: { ...s.user, tokens } } : {}),

  login: async (email, password) => {
    try {
      const res = await api.auth.login({ email, password });
      if (res.error) return { error: res.error };
      if (res.token) {
        localStorage.setItem('velbaz_token', res.token);
        set({ user: res.user });
      }
      return {};
    } catch (e: any) {
      return { error: e.message || 'Network error' };
    }
  },

  register: async (name, email, password) => {
    try {
      const res = await api.auth.register({ name, email, password, deviceId: getDeviceId() });
      if (res.error) return { error: res.error };
      if (res.token) {
        localStorage.setItem('velbaz_token', res.token);
        set({ user: res.user });
      }
      return {};
    } catch (e: any) {
      return { error: e.message || 'Network error' };
    }
  },

  logout: async () => {
    try { await api.auth.logout(); } catch {}
    localStorage.removeItem('velbaz_token');
    set({ user: null });
  },

  init: async () => {
    const token = localStorage.getItem('velbaz_token');
    if (!token) { set({ loading: false }); return; }
    try {
      const res = await api.auth.me();
      if (res.user) {
        set({ user: res.user, loading: false });
      } else {
        // Token invalid/expired — clean up
        localStorage.removeItem('velbaz_token');
        set({ user: null, loading: false });
      }
    } catch (e) {
      // Network error — keep token, retry on next load
      // Don't remove token on transient failures
      console.warn('Auth init failed, will retry:', e);
      set({ loading: false });
    }
  },
}));

// ─── Auto-sync tokens from every API response ───────────────────────────────
onTokenUpdate((tokens) => {
  const { user } = useAuth.getState();
  if (user && user.tokens !== tokens) {
    useAuth.getState().updateTokens(tokens);
  }
});

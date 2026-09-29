import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from './lib/api';
import { IS_DEMO } from './lib/config';
import { DEMO_USERS, demoSession } from './lib/demo';
import { supabase } from './lib/supabase';
import type { Employee, Profile, Role } from './lib/types';

interface AuthState {
  loading: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  employee: Employee | null;
  error: string | null;
}

interface AuthContext extends AuthState {
  isAdmin: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  demoSignIn(role: Role): Promise<void>;
  resetPassword(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthContext | null>(null);

const EMPTY: AuthState = { loading: false, userId: null, email: null, profile: null, employee: null, error: null };

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...EMPTY, loading: true });

  const loadUser = useCallback(async (userId: string | null, email: string | null) => {
    if (!userId) return setState(EMPTY);
    try {
      const [profile, employees] = await Promise.all([
        api.profiles.get(userId),
        api.employees.list({ eq: { user_id: userId } }),
      ]);
      setState({ loading: false, userId, email: email ?? profile?.email ?? null, profile, employee: employees[0] ?? null, error: null });
    } catch (e) {
      setState({ ...EMPTY, userId, email, error: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    if (IS_DEMO) {
      loadUser(demoSession.get(), null);
      return;
    }
    const { data } = sb().auth.onAuthStateChange((event, session) => {
      if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return;
      // Diferido: no se debe llamar a Supabase dentro del propio callback
      setTimeout(() => loadUser(session?.user.id ?? null, session?.user.email ?? null), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [loadUser]);

  const value: AuthContext = {
    ...state,
    isAdmin: state.profile?.role === 'admin',

    async signIn(email, password) {
      const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(errorMessage(error));
    },

    async signUp(name, email, password) {
      const { data, error } = await sb().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin },
      });
      if (error) throw new Error(errorMessage(error));
      return { needsConfirmation: !data.session };
    },

    async signOut() {
      if (IS_DEMO) {
        demoSession.set(null);
        setState(EMPTY);
        return;
      }
      await sb().auth.signOut();
    },

    async demoSignIn(role) {
      const id = role === 'admin' ? DEMO_USERS.admin : DEMO_USERS.worker;
      demoSession.set(id);
      await loadUser(id, null);
    },

    async resetPassword(email) {
      const { error } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/perfil` });
      if (error) throw new Error(errorMessage(error));
    },

    async updatePassword(password) {
      if (IS_DEMO) return;
      const { error } = await sb().auth.updateUser({ password });
      if (error) throw new Error(errorMessage(error));
    },

    refresh: () => loadUser(state.userId, state.email),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

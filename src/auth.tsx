import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from './lib/api';
import { IS_DEMO } from './lib/config';
import { DEMO_USERS, demoSession } from './lib/demo';
import { OPENED_FROM_RECOVERY_LINK, supabase } from './lib/supabase';
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
  /** Ha entrado con el enlace de "He olvidado la contraseña": tiene que elegir una nueva */
  recovering: boolean;
  finishRecovery(): void;
  isAdmin: boolean;
  /** Relaciones públicas: ficha como un trabajador y gestiona reservados */
  isRrpp: boolean;
  /** Camarero/a de bandeja: como un camarero, y además ve los reservados (sin cambiarlos) */
  isTray: boolean;
  signIn(email: string, password: string): Promise<void>;
  /** Registro de un trabajador: camarero/a de barra ('worker') o de bandeja ('tray'), RRPP ('rrpp') o DJ / técnico ('tech') */
  signUp(name: string, email: string, password: string, role: Exclude<Role, 'admin'>): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  demoSignIn(role: Role): Promise<void>;
  resetPassword(email: string): Promise<void>;
  /**
   * Cambia la contraseña. Con la actual, antes se vuelve a iniciar sesión: Supabase puede exigir
   * una sesión reciente para cambiarla ("Secure password change") y así nunca falla por eso.
   */
  updatePassword(password: string, currentPassword?: string): Promise<void>;
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
  const [recovering, setRecovering] = useState(OPENED_FROM_RECOVERY_LINK);

  const loadUser = useCallback(async (userId: string | null, email: string | null) => {
    if (!userId) return setState(EMPTY);
    try {
      const profile = await api.profiles.get(userId);
      // El trabajador recibe su ficha sin la tarifa €/h; el administrador, la ficha completa
      let employee =
        profile?.role === 'admin'
          ? (await api.employees.list({ eq: { user_id: userId } }))[0] ?? null
          : await api.myEmployee(userId);
      // Sin ficha vinculada: se vincula sola con la ficha sin cuenta que tenga su mismo email
      if (!employee && profile?.role !== 'admin' && (await api.linkMyEmployee())) employee = await api.myEmployee(userId);
      setState({ loading: false, userId, email: email ?? profile?.email ?? null, profile, employee, error: null });
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
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'PASSWORD_RECOVERY'].includes(event)) return;
      // Diferido: no se debe llamar a Supabase dentro del propio callback
      setTimeout(() => loadUser(session?.user.id ?? null, session?.user.email ?? null), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [loadUser]);

  const value: AuthContext = {
    ...state,
    isAdmin: state.profile?.role === 'admin',
    isRrpp: state.profile?.role === 'rrpp',
    isTray: state.profile?.role === 'tray',
    recovering: recovering && !!state.userId,
    finishRecovery: () => setRecovering(false),

    async signIn(email, password) {
      const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(errorMessage(error));
    },

    async signUp(name, email, password, role) {
      const { data, error } = await sb().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim(), role }, emailRedirectTo: window.location.origin },
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
      const id = DEMO_USERS[role];
      demoSession.set(id);
      await loadUser(id, null);
    },

    async resetPassword(email) {
      // A la raíz de la app (la dirección que seguro está permitida en Supabase); la app detecta el enlace sola
      const { error } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      if (error) throw new Error(errorMessage(error));
    },

    async updatePassword(password, currentPassword) {
      if (IS_DEMO) return;
      if (currentPassword !== undefined) {
        const email = state.email ?? (await sb().auth.getUser()).data.user?.email;
        if (!email) throw new Error('No se ha podido comprobar tu cuenta. Cierra sesión y vuelve a entrar.');
        const { error } = await sb().auth.signInWithPassword({ email, password: currentPassword });
        if (error) throw new Error(/invalid login credentials/i.test(error.message) ? 'La contraseña actual no es correcta.' : errorMessage(error));
      }
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

import { IS_DEMO } from './config';
import { normalizeCategory } from './constants';
import { demoClockIn, demoClockOut, demoRepo, type TableName } from './demo';
import { supabase } from './supabase';
import type { Availability, ClubEvent, Employee, LeaveRequest, Profile, Shift, TimeEntry, Transaction } from './types';

type Scalar = string | number | boolean | null;

export interface Query {
  eq?: Record<string, Scalar>;
  in?: [string, string[]];
  gte?: [string, string];
  lt?: [string, string];
  order?: [string, 'asc' | 'desc'];
  limit?: number;
}

export interface Repo<T extends { id: string }> {
  list(q?: Query): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(values: Partial<T>): Promise<T>;
  createMany(values: Partial<T>[]): Promise<T[]>;
  update(id: string, patch: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

// ---------- Mensajes de error legibles ----------

const ERRORS: [RegExp, string][] = [
  [/EMAIL_NOT_AUTHORIZED/i, 'Este email no está autorizado. Pide al administrador que te dé de alta primero.'],
  [/Database error saving new user/i, 'No se ha podido crear la cuenta. Inténtalo de nuevo o avisa al administrador.'],
  [/ALREADY_CLOCKED_IN|time_entries_one_open/i, 'Ya hay un fichaje abierto para este empleado.'],
  [/NOT_CLOCKED_IN/i, 'No tienes ningún fichaje abierto.'],
  [/NO_EMPLOYEE/i, 'Tu usuario no está vinculado a ninguna ficha de empleado activa.'],
  [/Invalid login credentials/i, 'Email o contraseña incorrectos.'],
  [/User already registered/i, 'Ya existe una cuenta con este email.'],
  [/Email not confirmed/i, 'Confirma tu email antes de iniciar sesión (revisa tu bandeja de entrada).'],
  [/Password should be at least/i, 'La contraseña debe tener al menos 6 caracteres.'],
  [/employees_email_unique/i, 'Ya existe un empleado con ese email.'],
  [/out_after_in|end_after_start/i, 'La hora de salida debe ser posterior a la de entrada.'],
  [/public.availability/i, 'Falta crear la tabla de disponibilidad en Supabase (ejecuta la migración 20260930130000_availability.sql).'],
  [/availability_one_per_day/i, 'Ya hay disponibilidad guardada para ese día.'],
  [/row-level security|permission denied/i, 'No tienes permisos para realizar esta acción.'],
  [/Failed to fetch|NetworkError/i, 'Sin conexión con el servidor. Revisa tu conexión a internet.'],
];

export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
  return ERRORS.find(([re]) => re.test(raw))?.[1] ?? raw;
}

const fail = (e: { message: string }) => new Error(errorMessage(e));

// ---------- Implementación Supabase ----------

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
}

function sbRepo<T extends { id: string }>(table: TableName): Repo<T> {
  const PAGE = 1000;
  return {
    async list(q = {}) {
      const out: T[] = [];
      for (let page = 0; ; page++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = sb().from(table).select('*');
        for (const [k, v] of Object.entries(q.eq ?? {})) query = v === null ? query.is(k, null) : query.eq(k, v);
        if (q.in) query = query.in(q.in[0], q.in[1]);
        if (q.gte) query = query.gte(q.gte[0], q.gte[1]);
        if (q.lt) query = query.lt(q.lt[0], q.lt[1]);
        if (q.order) query = query.order(q.order[0], { ascending: q.order[1] !== 'desc' });
        query = query.order('id');
        const from = page * PAGE;
        const to = q.limit ? Math.min(q.limit, from + PAGE) - 1 : from + PAGE - 1;
        const { data, error } = await query.range(from, to);
        if (error) throw fail(error);
        out.push(...(data as T[]));
        if (data.length < PAGE || (q.limit && out.length >= q.limit)) break;
      }
      return out;
    },
    async get(id) {
      const { data, error } = await sb().from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw fail(error);
      return data as T | null;
    },
    async create(values) {
      const { data, error } = await sb().from(table).insert(values as never).select().single();
      if (error) throw fail(error);
      return data as T;
    },
    async createMany(values) {
      if (!values.length) return [];
      const { data, error } = await sb().from(table).insert(values as never).select();
      if (error) throw fail(error);
      return data as T[];
    },
    async update(id, patch) {
      const { data, error } = await sb().from(table).update(patch as never).eq('id', id).select().single();
      if (error) throw fail(error);
      return data as T;
    },
    async remove(id) {
      const { error } = await sb().from(table).delete().eq('id', id);
      if (error) throw fail(error);
    },
  };
}

async function sbRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw fail(error);
  return data as T;
}

// ---------- API pública ----------

const repo = <T extends { id: string }>(table: TableName) => (IS_DEMO ? demoRepo<T>(table) : sbRepo<T>(table));

/** Aplica `fix` a todo lo que devuelve un repositorio (p. ej. renombrar categorías antiguas). */
function mapped<T extends { id: string }>(r: Repo<T>, fix: (row: T) => T): Repo<T> {
  return {
    ...r,
    list: async (q) => (await r.list(q)).map(fix),
    get: async (id) => {
      const row = await r.get(id);
      return row && fix(row);
    },
    create: async (v) => fix(await r.create(v)),
    createMany: async (v) => (await r.createMany(v)).map(fix),
    update: async (id, p) => fix(await r.update(id, p)),
  };
}

const withCurrentCategory = (t: Transaction) => {
  const category = normalizeCategory(t.category);
  return category === t.category ? t : { ...t, category };
};

export const api = {
  profiles: repo<Profile>('profiles'),
  employees: repo<Employee>('employees'),
  events: repo<ClubEvent>('events'),
  timeEntries: repo<TimeEntry>('time_entries'),
  shifts: repo<Shift>('shifts'),
  transactions: mapped(repo<Transaction>('transactions'), withCurrentCategory),
  requests: repo<LeaveRequest>('leave_requests'),
  availability: repo<Availability>('availability'),

  /** Fichar entrada del usuario conectado (hora del servidor). */
  clockIn: (notes?: string) =>
    IS_DEMO ? demoClockIn(notes) : sbRpc<TimeEntry>('clock_in', { p_notes: notes ?? null }),

  /** Fichar salida del usuario conectado (hora del servidor). */
  clockOut: (notes?: string) =>
    IS_DEMO ? demoClockOut(notes) : sbRpc<TimeEntry>('clock_out', { p_notes: notes ?? null }),
};

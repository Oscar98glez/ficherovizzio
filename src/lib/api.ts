import { IS_DEMO } from './config';
import { normalizeCategory } from './constants';
import { demoClockIn, demoClockOut, demoFiles, demoRepo, demoReservationStaff, demoSession, type TableName } from './demo';
import { blobToDataUrl } from './image';
import { uid } from './utils';
import { supabase } from './supabase';
import type { Availability, ClubEvent, Employee, Invoice, LeaveRequest, Profile, Reservation, Shift, StaffOption, Supplier, TicketSale, TimeEntry, Transaction, VipTable, CommissionRate } from './types';

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
  [/email rate limit exceeded|over_email_send_rate_limit/i, 'Ahora mismo no se pueden enviar más emails de confirmación. Espera unos minutos y vuelve a intentarlo, o avisa al administrador.'],
  [/rate limit|too many requests/i, 'Demasiados intentos seguidos. Espera un par de minutos y vuelve a intentarlo.'],
  [/Invalid login credentials/i, 'Email o contraseña incorrectos.'],
  [/User already registered/i, 'Ya existe una cuenta con este email.'],
  [/Email not confirmed/i, 'Confirma tu email antes de iniciar sesión (revisa tu bandeja de entrada).'],
  [/Password should be at least/i, 'La contraseña debe tener al menos 6 caracteres.'],
  [/employees_email_unique/i, 'Ya existe un empleado con ese email.'],
  [/out_after_in|end_after_start/i, 'La hora de salida debe ser posterior a la de entrada.'],
  [/public.availability/i, 'Falta crear la tabla de disponibilidad en Supabase (ejecuta la migración 20260930130000_availability.sql).'],
  [/suppliers_name_unique/i, 'Ya existe un proveedor con ese nombre.'],
  [/public.suppliers|supplier_id/i, 'Falta aplicar en Supabase la migración de proveedores (20261006130000_suppliers.sql).'],
  [/public.invoices/i, 'Falta crear el apartado de facturas en Supabase (ejecuta la migración 20260930160000_invoices.sql).'],
  [/Bucket not found|set_my_photo|photo_url/i, 'Falta aplicar en Supabase la última migración (fotos de perfil).'],
  [/exceeded the maximum allowed size|Payload too large/i, 'El archivo es demasiado grande (máximo 15 MB).'],
  [/mime type .* is not supported/i, 'Tipo de archivo no permitido. Sube un PDF o una imagen (JPG, PNG, WEBP o HEIC).'],
  [/reservations_table_night/i, 'Ese reservado ya tiene una reserva esa noche. Elige otro o deja la reserva sin reservado asignado.'],
  [/rrpp_bottle_pct|rrpp_ticket_pct|rrpp_list_fee|list_fee|list_quantity/i, 'Falta aplicar en Supabase la migración de comisiones propias de RRPP (20261005180000_rrpp_personal_commissions.sql).'],
  [/rrpp_commission_rates|rrpp_ticket_sales/i, 'Falta aplicar en Supabase la migración de comisiones de RRPP (20261005170000_rrpp_commissions.sql).'],
  [/rrpp_origin/i, 'Falta aplicar en Supabase la migración de origen de reservas (20261005160000_reservation_origin.sql).'],
  [/reservation_staff|host_rrpp/i, 'Falta aplicar en Supabase la migración de "RRPP que atiende" (20261005150000_reservation_host_rrpp.sql).'],
  [/map_x|total_amount|bottles|mixers/i, 'Falta aplicar en Supabase la migración del mapa de reservados (20261005130000_vip_map_and_orders.sql).'],
  [/public.reservations|public.vip_tables|profiles_role_check/i, 'Falta aplicar en Supabase la migración de RRPP y reservados (20261005120000_rrpp_reservations.sql).'],
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

function sbRepo<T extends { id: string }>(table: TableName | 'my_time_entries'): Repo<T> {
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

// ---------- Archivos (almacenamiento privado de Supabase) ----------

const BUCKET = 'invoices';

export const files = {
  async upload(path: string, file: File) {
    if (IS_DEMO) return demoFiles.upload(path, file);
    const { error } = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw fail(error);
  },
  /** Enlace temporal (1 hora) para ver o descargar el archivo */
  async url(path: string, download?: string) {
    if (IS_DEMO) {
      const blob = await demoFiles.get(path);
      if (!blob) throw new Error('Archivo no encontrado');
      return URL.createObjectURL(blob);
    }
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 3600, download ? { download } : undefined);
    if (error) throw fail(error);
    return data.signedUrl;
  },
  async remove(path: string) {
    if (IS_DEMO) return demoFiles.remove(path);
    const { error } = await sb().storage.from(BUCKET).remove([path]);
    if (error) throw fail(error);
  },
};

// ---------- Datos propios del trabajador (sin la tarifa €/h) ----------

/** Si aún no se ha aplicado la migración de las vistas, se usan las tablas como antes */
const missingView = (e: unknown) => /my_employee|my_time_entries|schema cache|does not exist/i.test(e instanceof Error ? e.message : String(e));
const withoutRate = <T extends { hourly_rate?: number }>(x: T): T => ({ ...x, hourly_rate: 0 });

/** Ficha del trabajador conectado, sin la tarifa ni las notas internas */
async function myEmployee(userId: string): Promise<Employee | null> {
  let emp: Employee | null = null;
  if (IS_DEMO) emp = (await demoRepo<Employee>('employees').list({ eq: { user_id: userId } }))[0] ?? null;
  else {
    const { data, error } = await sb().from('my_employee').select('*').maybeSingle();
    if (error && !missingView(error)) throw fail(error);
    emp = error ? (await sbRepo<Employee>('employees').list({ eq: { user_id: userId } }))[0] ?? null : (data as Employee | null);
  }
  return emp && { ...withoutRate(emp), notes: null };
}

/** Fichajes del trabajador conectado, sin la tarifa aplicada */
async function myTimeEntries(q: Query = {}): Promise<TimeEntry[]> {
  if (IS_DEMO) return (await demoRepo<TimeEntry>('time_entries').list(q)).map(withoutRate);
  try {
    return (await sbRepo<TimeEntry>('my_time_entries').list(q)).map(withoutRate);
  } catch (e) {
    if (!missingView(e)) throw e;
    return (await sbRepo<TimeEntry>('time_entries').list(q)).map(withoutRate);
  }
}

// ---------- Fotos de perfil ----------

const AVATARS = 'avatars';

export const avatars = {
  /** Sube la foto (ya recortada) y devuelve su URL */
  async upload(employeeId: string, image: Blob): Promise<string> {
    if (IS_DEMO) return blobToDataUrl(image);
    const path = `${employeeId}/${uid()}.jpg`;
    const { error } = await sb().storage.from(AVATARS).upload(path, image, { contentType: 'image/jpeg', upsert: false });
    if (error) throw fail(error);
    return sb().storage.from(AVATARS).getPublicUrl(path).data.publicUrl;
  },
  /** Borra el archivo de una foto anterior (si es de nuestro almacenamiento) */
  async remove(url: string | null | undefined) {
    if (IS_DEMO || !url) return;
    const marker = `/object/public/${AVATARS}/`;
    const i = url.indexOf(marker);
    if (i < 0) return;
    await sb().storage.from(AVATARS).remove([decodeURIComponent(url.slice(i + marker.length))]);
  },
};

/** El trabajador cambia (o quita) su propia foto */
async function setMyPhoto(url: string | null) {
  if (IS_DEMO) {
    const userId = demoSession.get();
    const [emp] = await demoRepo<Employee>('employees').list({ eq: { user_id: userId } });
    if (emp) await demoRepo<Employee>('employees').update(emp.id, { photo_url: url });
    return;
  }
  await sbRpc<null>('set_my_photo', { p_url: url });
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
  invoices: repo<Invoice>('invoices'),
  suppliers: repo<Supplier>('suppliers'),
  vipTables: repo<VipTable>('vip_tables'),
  reservations: repo<Reservation>('reservations'),
  commissionRates: repo<CommissionRate>('rrpp_commission_rates'),
  ticketSales: repo<TicketSale>('rrpp_ticket_sales'),

  /** Fichar entrada del usuario conectado (hora del servidor). */
  clockIn: (notes?: string) =>
    IS_DEMO ? demoClockIn(notes) : sbRpc<TimeEntry>('clock_in', { p_notes: notes ?? null }),

  /** Fichar salida del usuario conectado (hora del servidor). */
  clockOut: (notes?: string) =>
    IS_DEMO ? demoClockOut(notes) : sbRpc<TimeEntry>('clock_out', { p_notes: notes ?? null }),

  myEmployee,
  myTimeEntries,
  setMyPhoto,

  /** RRPP que se pueden elegir en una reserva (sólo id y nombre) */
  reservationStaff: (): Promise<StaffOption[]> => (IS_DEMO ? demoReservationStaff() : sbRpc<StaffOption[]>('reservation_staff', {})),
};

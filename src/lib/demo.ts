/**
 * Modo demo: base de datos local en localStorage con datos de ejemplo.
 * Se usa automáticamente mientras no haya credenciales de Supabase.
 */
import type { Query, Repo } from './api';
import { CLUB_TABLES } from './club-map';
import { PAYROLL_CATEGORY } from './constants';
import { distanceM, isOutside, type Position } from './geo';
import { menuPrice } from './menu';
import { addDays, addMonths, businessDate, businessToday, isoDate, monthKey, startOfDay, startOfMonth, startOfWeek } from './dates';
import type {
  Availability,
  ClubEvent,
  CommissionRate,
  ContractType,
  Department,
  Employee,
  FourvenuesRrppNight,
  LeaveRequest,
  Message,
  MessageRecipient,
  MessageReply,
  PaymentMethod,
  Profile,
  Reservation,
  ReservationStatus,
  RrppNightDetail,
  Shift,
  ShiftResponse,
  Supplier,
  TicketSale,
  TimeEntry,
  Transaction,
  VenueLocation,
  VipTable,
} from './types';
import { entryCost, sumBy, uid } from './utils';

export type TableName =
  | 'profiles'
  | 'employees'
  | 'events'
  | 'time_entries'
  | 'shifts'
  | 'transactions'
  | 'leave_requests'
  | 'availability'
  | 'invoices'
  | 'vip_tables'
  | 'reservations'
  | 'rrpp_commission_rates'
  | 'rrpp_ticket_sales'
  | 'fourvenues_rrpp_nights'
  | 'suppliers'
  | 'claude_connectors'
  | 'messages'
  | 'message_recipients'
  | 'message_replies'
  | 'venue_location';

type DB = Record<TableName, Record<string, unknown>[]>;

const DB_KEY = 'vizzio.demo.db.v28';
const SESSION_KEY = 'vizzio.demo.session';

export const DEMO_USERS = {
  admin: 'demo-admin',
  worker: 'demo-worker',
  rrpp: 'demo-rrpp',
  tech: 'demo-tech',
  tray: 'demo-tray',
} as const;

// ---------- Sesión demo ----------

export const demoSession = {
  get(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(userId: string | null) {
    try {
      if (userId) localStorage.setItem(SESSION_KEY, userId);
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* almacenamiento no disponible */
    }
  },
};

// ---------- Archivos (modo demo: se guardan en IndexedDB del navegador) ----------

const FILES_DB = 'vizzio-demo-files';

function filesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILES_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function filesOp<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await filesDb();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction('files', mode).objectStore('files'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const demoFiles = {
  upload: async (path: string, file: Blob) => void (await filesOp('readwrite', (s) => s.put(file, path))),
  get: (path: string) => filesOp<Blob | undefined>('readonly', (s) => s.get(path) as IDBRequest<Blob | undefined>),
  remove: async (path: string) => void (await filesOp('readwrite', (s) => s.delete(path))),
};

// ---------- Almacenamiento ----------

let db: DB | null = null;

function getDb(): DB {
  if (db) return db;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return (db = JSON.parse(raw) as DB);
  } catch {
    /* datos corruptos: se regeneran */
  }
  db = seed();
  persist();
  return db;
}

function persist() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* sin almacenamiento: la demo funciona en memoria */
  }
}

export function resetDemoData() {
  db = seed();
  persist();
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const wait = () => new Promise((r) => setTimeout(r, 80));

function matches(row: Record<string, unknown>, q: Query) {
  if (q.eq) for (const [k, v] of Object.entries(q.eq)) if ((row[k] ?? null) !== v) return false;
  if (q.in && !q.in[1].includes(row[q.in[0]] as string)) return false;
  if (q.gte && !((row[q.gte[0]] as string) >= q.gte[1])) return false;
  if (q.lt && !((row[q.lt[0]] as string) < q.lt[1])) return false;
  return true;
}

export function demoRepo<T extends { id: string }>(table: TableName): Repo<T> {
  const rows = () => (getDb()[table] ??= []);
  return {
    async list(q = {}) {
      await wait();
      let out = rows().filter((r) => matches(r, q));
      if (q.order) {
        const [col, dir] = q.order;
        const m = dir === 'desc' ? -1 : 1;
        out = [...out].sort((a, b) => (String(a[col] ?? '') > String(b[col] ?? '') ? m : -m));
      }
      if (q.limit) out = out.slice(0, q.limit);
      return clone(out) as unknown as T[];
    },
    async get(id) {
      await wait();
      const r = rows().find((x) => x.id === id);
      return r ? (clone(r) as unknown as T) : null;
    },
    async create(values) {
      const [r] = await this.createMany([values]);
      return r;
    },
    async createMany(values) {
      await wait();
      const created = values.map((v) => ({ id: uid(), created_at: new Date().toISOString(), ...v }));
      if (table === 'reservations') created.forEach((c) => reservationRules(c as unknown as Reservation, true));
      if (table === 'time_entries') {
        for (const c of created as unknown as TimeEntry[]) {
          if (!c.clock_out && rows().some((r) => r.employee_id === c.employee_id && !r.clock_out))
            throw new Error('ALREADY_CLOCKED_IN');
        }
      }
      rows().push(...created);
      if (table === 'time_entries') created.forEach((c) => syncShiftEnd(c as unknown as TimeEntry));
      if (table === 'shifts') created.forEach((c) => fillShiftEnd(c as unknown as Shift));
      persist();
      return clone(created) as unknown as T[];
    },
    async update(id, patch) {
      await wait();
      const r = rows().find((x) => x.id === id);
      if (!r) throw new Error('Registro no encontrado');
      if (table === 'reservations') reservationRules({ ...(r as unknown as Reservation), ...(patch as Partial<Reservation>) }, false);
      // Como el trigger de Supabase: si cambia la hora o la persona del turno, la respuesta deja de valer
      if (table === 'shifts') {
        const p = patch as Partial<Shift>;
        const sh = r as unknown as Shift;
        if ((p.start_at && p.start_at !== sh.start_at) || (p.employee_id && p.employee_id !== sh.employee_id))
          Object.assign(r, { response: null, responded_at: null, response_note: null });
      }
      Object.assign(r, patch);
      if (table === 'reservations') Object.assign(r, reservationRules(r as unknown as Reservation, false));
      if (table === 'time_entries') syncShiftEnd(r as unknown as TimeEntry);
      persist();
      return clone(r) as unknown as T;
    },
    async remove(id) {
      await wait();
      getDb()[table] = rows().filter((x) => x.id !== id);
      // Como "on delete cascade": al borrar un mensaje se borran sus destinatarios
      if (table === 'messages') {
        const gone = new Set((getDb().message_recipients ?? []).filter((x) => x.message_id === id).map((x) => x.id));
        getDb().message_recipients = (getDb().message_recipients ?? []).filter((x) => x.message_id !== id);
        getDb().message_replies = (getDb().message_replies ?? []).filter((x) => !gone.has(x.recipient_id as string));
      }
      persist();
    },
  };
}

/** Reglas de las reservas (como el trigger y el índice único de Supabase). */
function reservationRules(res: Reservation, isNew: boolean): Reservation {
  const d = getDb();
  const userId = demoSession.get();
  const isAdmin = d.profiles.some((p) => p.id === userId && p.role === 'admin');
  if (isNew && !isAdmin) {
    res.created_by = userId;
    if (!res.rrpp_origin) res.rrpp_id ??= (d.employees.find((e) => e.user_id === userId)?.id as string) ?? null;
  }
  const nameOf = (id: string | null) => {
    const emp = d.employees.find((e) => e.id === id) as Employee | undefined;
    return emp ? `${emp.first_name} ${emp.last_name}`.trim() : null;
  };
  if (res.rrpp_origin) res.rrpp_id = null;
  res.rrpp_name = res.rrpp_origin ? (res.rrpp_origin === 'empresa' ? 'Empresa' : 'Otros') : nameOf(res.rrpp_id);
  res.host_rrpp_name = nameOf(res.host_rrpp_id ?? null);
  res.updated_at = new Date().toISOString();
  const active = (x: Reservation) => x.status !== 'cancelled' && x.status !== 'no_show';
  if (
    res.table_id &&
    active(res) &&
    (d.reservations as unknown as Reservation[]).some((x) => x.id !== res.id && x.table_id === res.table_id && x.date === res.date && active(x))
  )
    throw new Error('reservations_table_night');
  return res;
}

/** RRPP que se pueden elegir en una reserva (como la función reservation_staff de Supabase) */
export async function demoReservationStaff() {
  const d = getDb();
  const roles = new Map(d.profiles.map((p) => [p.id, p.role]));
  await wait();
  return (d.employees as unknown as Employee[])
    .filter((e) => e.active && (e.department === 'relaciones' || ['rrpp', 'admin'].includes(String(roles.get(e.user_id ?? '') ?? ''))))
    .map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Copia la hora de salida fichada al turno de esa noche (como el trigger de Supabase). */
function syncShiftEnd(entry: TimeEntry) {
  if (!entry.clock_out) return;
  const night = businessDate(entry.clock_in);
  for (const sh of getDb().shifts as unknown as Shift[]) {
    if (sh.employee_id === entry.employee_id && sh.status !== 'cancelled' && businessDate(sh.start_at) === night && entry.clock_out > sh.start_at)
      sh.end_at = entry.clock_out;
  }
}

/** Al crear un turno de una noche ya fichada, toma la salida del fichaje. */
function fillShiftEnd(shift: Shift) {
  if (shift.end_at) return;
  const night = businessDate(shift.start_at);
  const entry = (getDb().time_entries as unknown as TimeEntry[]).find(
    (e) => e.employee_id === shift.employee_id && e.clock_out && businessDate(e.clock_in) === night && e.clock_out > shift.start_at,
  );
  if (entry) shift.end_at = entry.clock_out;
}

function currentEmployee(): Employee {
  const userId = demoSession.get();
  const emp = getDb().employees.find((e) => e.user_id === userId && e.active) as Employee | undefined;
  if (!emp) throw new Error('NO_EMPLOYEE');
  return emp;
}

/** Como check_clock_location de Supabase: distancia al local y si está fuera */
function checkLocation(pos?: Position | null) {
  const venue = demoVenue();
  if (!venue || !pos) return { distance: null, outside: null, enforce: !!venue?.enforce };
  const distance = Math.round(distanceM(venue.lat, venue.lng, pos.lat, pos.lng));
  return { distance, outside: isOutside(distance, pos.accuracy, venue.radius_m), enforce: venue.enforce };
}

const demoVenue = () => ((getDb().venue_location ?? [])[0] as unknown as VenueLocation | undefined) ?? null;

/** Como fourvenues_rrpp_names de Supabase: nombre puesto a mano, que pasa al desglose de sus noches */
export async function demoSetRrppName(fourvenuesUserId: string, name: string): Promise<void> {
  for (const r of getDb().fourvenues_rrpp_nights ?? []) if (r.fourvenues_user_id === fourvenuesUserId) r.name = name;
  persist();
  await wait();
}

export async function demoGetVenue(): Promise<VenueLocation | null> {
  await wait();
  return clone(demoVenue());
}

export async function demoSaveVenue(v: VenueLocation | null): Promise<void> {
  getDb().venue_location = v ? [{ ...v, id: 'venue', updated_at: new Date().toISOString() }] : [];
  persist();
  await wait();
}

export async function demoClockIn(pos?: Position | null, notes?: string): Promise<TimeEntry> {
  const emp = currentEmployee();
  const d = getDb();
  if (d.time_entries.some((t) => t.employee_id === emp.id && !t.clock_out)) throw new Error('ALREADY_CLOCKED_IN');
  const loc = checkLocation(pos);
  if (loc.enforce && !pos) throw new Error('LOCATION_REQUIRED');
  if (loc.enforce && loc.outside) throw new Error(`OUTSIDE_VENUE:${loc.distance}`);
  const event = d.events.find((e) => e.date === businessDate(Date.now()));
  const entry: TimeEntry = {
    id: uid(),
    employee_id: emp.id,
    clock_in: new Date().toISOString(),
    clock_out: null,
    break_minutes: 0,
    hourly_rate: emp.hourly_rate,
    event_id: (event?.id as string) ?? null,
    source: 'app',
    notes: notes ?? null,
    created_at: new Date().toISOString(),
    clock_in_lat: pos?.lat ?? null,
    clock_in_lng: pos?.lng ?? null,
    clock_in_accuracy: pos?.accuracy ?? null,
    clock_in_distance: loc.distance,
    clock_in_outside: loc.outside,
  };
  d.time_entries.push(entry as unknown as Record<string, unknown>);
  persist();
  await wait();
  return clone(entry);
}

export async function demoClockOut(pos?: Position | null, notes?: string): Promise<TimeEntry> {
  const emp = currentEmployee();
  const open = getDb().time_entries.find((t) => t.employee_id === emp.id && !t.clock_out);
  if (!open) throw new Error('NOT_CLOCKED_IN');
  const loc = checkLocation(pos);
  open.clock_out = new Date().toISOString();
  Object.assign(open, {
    clock_out_lat: pos?.lat ?? null,
    clock_out_lng: pos?.lng ?? null,
    clock_out_accuracy: pos?.accuracy ?? null,
    clock_out_distance: loc.distance,
    clock_out_outside: loc.outside,
  });
  syncShiftEnd(open as unknown as TimeEntry);
  if (notes) open.notes = notes;
  persist();
  await wait();
  return clone(open) as unknown as TimeEntry;
}

/** Como mark_message_read de Supabase: el trabajador marca como leído un mensaje suyo */
export async function demoMarkMessageRead(recipientId: string): Promise<void> {
  const emp = currentEmployee();
  const r = ((getDb().message_recipients ?? []) as unknown as MessageRecipient[]).find((x) => x.id === recipientId && x.employee_id === emp.id);
  if (r && !r.read_at) {
    r.read_at = new Date().toISOString();
    persist();
  }
}

const demoIsAdmin = () => getDb().profiles.some((p) => p.id === demoSession.get() && p.role === 'admin');

/** Como reply_message de Supabase: el trabajador responde en su conversación; el administrador, en cualquiera */
export async function demoReplyMessage(recipientId: string, body: string): Promise<MessageReply> {
  const d = getDb();
  const admin = demoIsAdmin();
  const text = body.trim();
  if (!text) throw new Error('EMPTY_REPLY');
  const recs = (d.message_recipients ?? []) as unknown as MessageRecipient[];
  const r = recs.find((x) => x.id === recipientId && (admin || x.employee_id === currentEmployee().id));
  if (!r) throw new Error('MESSAGE_NOT_FOUND');
  const now = new Date().toISOString();
  const reply: MessageReply = { id: uid(), recipient_id: r.id, author_id: demoSession.get(), from_admin: admin, body: text.slice(0, 2000), created_at: now, read_at: null };
  const replies = (d.message_replies ??= []) as unknown as MessageReply[];
  replies.forEach((x) => x.recipient_id === r.id && x.from_admin !== admin && !x.read_at && (x.read_at = now));
  replies.push(reply);
  if (!admin) r.read_at ??= now;
  persist();
  await wait();
  return clone(reply);
}

/** Como mark_replies_read de Supabase: marca como leídas las respuestas del otro lado */
export async function demoMarkRepliesRead(recipientId: string): Promise<void> {
  const admin = demoIsAdmin();
  const now = new Date().toISOString();
  let changed = false;
  for (const x of (getDb().message_replies ?? []) as unknown as MessageReply[])
    if (x.recipient_id === recipientId && x.from_admin !== admin && !x.read_at) (x.read_at = now), (changed = true);
  if (changed) persist();
}

/** Como respond_task de Supabase: el trabajador acepta o rechaza una tarea suya */
export async function demoRespondTask(recipientId: string, response: ShiftResponse, note?: string): Promise<MessageRecipient> {
  const emp = currentEmployee();
  const d = getDb();
  const r = ((d.message_recipients ?? []) as unknown as MessageRecipient[]).find((x) => x.id === recipientId && x.employee_id === emp.id);
  const msg = r && ((d.messages ?? []) as unknown as Message[]).find((m) => m.id === r.message_id);
  if (!r || msg?.kind !== 'task') throw new Error('TASK_NOT_FOUND');
  const now = new Date().toISOString();
  Object.assign(r, { response, responded_at: now, response_note: response === 'declined' ? note?.trim() || null : null, read_at: r.read_at ?? now });
  persist();
  await wait();
  return clone(r);
}

/** Como respond_shift de Supabase: el trabajador acepta o rechaza su turno antes de que empiece */
export async function demoRespondShift(shiftId: string, response: ShiftResponse, note?: string): Promise<Shift> {
  const emp = currentEmployee();
  const sh = (getDb().shifts as unknown as Shift[]).find((x) => x.id === shiftId && x.employee_id === emp.id);
  if (!sh) throw new Error('SHIFT_NOT_FOUND');
  if (sh.status === 'cancelled' || Date.parse(sh.start_at) <= Date.now()) throw new Error('SHIFT_CLOSED');
  Object.assign(sh, {
    response,
    responded_at: new Date().toISOString(),
    response_note: response === 'declined' ? note?.trim() || null : null,
  });
  persist();
  await wait();
  return clone(sh) as unknown as Shift;
}

// ---------- Datos de ejemplo ----------

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seed(): DB {
  const r = rng(20260929);
  const between = (a: number, b: number) => a + r() * (b - a);
  const int = (a: number, b: number) => Math.round(between(a, b));
  const round = (n: number, step = 10) => Math.round(n / step) * step;

  const now = new Date();
  const nowMs = now.getTime();
  const today = startOfDay(now);
  const stamp = now.toISOString();

  // [nombre, apellido, puesto, departamento, contrato, €/h, color, inicio(h), duración(h), userId]
  type Row = [string, string, string, Department, ContractType, number, string, number, number, string?];
  const staff: Row[] = [
    ['Laura', 'Gómez', 'Gerente', 'direccion', 'fijo', 22, '#af52de', 22.5, 8, DEMO_USERS.admin],
    ['Carlos', 'Ruiz', 'Jefe de barra', 'barra', 'fijo', 16, '#0071e3', 23, 7],
    ['Lucía', 'Martín', 'Camarera', 'barra', 'fijo_discontinuo', 13, '#34c759', 23.5, 6.5, DEMO_USERS.worker],
    ['Javier', 'Sánchez', 'Camarero', 'barra', 'fijo_discontinuo', 13, '#30b0c7', 23.5, 6.5],
    ['Nerea', 'Ortiz', 'Barback', 'barra', 'temporal', 11.5, '#5856d6', 23.5, 6.5],
    ['Marta', 'López', 'Relaciones públicas', 'relaciones', 'autonomo', 14, '#ff9500', 23.5, 4.5, DEMO_USERS.rrpp],
    ['David', 'Fernández', 'Portero', 'seguridad', 'fijo', 17, '#8e8e93', 23, 7.5],
    ['Álvaro', 'Torres', 'Vigilante de seguridad', 'seguridad', 'temporal', 17, '#a2845e', 23, 7.5],
    ['Nacho', 'Vidal', 'DJ residente', 'cabina', 'autonomo', 45, '#ff2d55', 0.5, 5.5, DEMO_USERS.tech],
    ['Sara', 'Jiménez', 'Taquillera', 'taquilla', 'fijo_discontinuo', 12.5, '#5856d6', 23.5, 4.5],
    ['Paula', 'Navarro', 'Guardarropa', 'guardarropa', 'extra', 11, '#30b0c7', 23.5, 7],
    ['Irene', 'Castro', 'Limpieza', 'limpieza', 'fijo_discontinuo', 12, '#34c759', 29.5, 4],
    ['Hugo', 'Morales', 'Camarero', 'barra', 'extra', 12, '#ff3b30', 23.5, 6.5],
    ['Rocío', 'Vega', 'Camarera de bandeja', 'sala', 'fijo_discontinuo', 12.5, '#ff9500', 23.5, 6.5, DEMO_USERS.tray],
  ];

  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const employees: Employee[] = staff.map(([first, last, position, department, contract, rate, color, , , userId], i) => ({
    id: `emp-${i + 1}`,
    user_id: userId ?? null,
    first_name: first,
    last_name: last,
    email: `${slug(first)}.${slug(last)}@vizzio.club`,
    phone: `+34 6${String(10000000 + Math.floor(r() * 89999999)).slice(0, 8)}`,
    position,
    department,
    contract_type: contract,
    hourly_rate: rate,
    hire_date: isoDate(addDays(today, -int(90, 1100))),
    active: first !== 'Hugo',
    photo_url: null,
    color,
    notes: null,
    created_at: stamp,
  }));

  const profiles: Profile[] = [
    { id: DEMO_USERS.admin, email: 'laura.gomez@vizzio.club', full_name: 'Laura Gómez', role: 'admin', created_at: stamp },
    { id: DEMO_USERS.worker, email: 'lucia.martin@vizzio.club', full_name: 'Lucía Martín', role: 'worker', created_at: stamp },
    { id: DEMO_USERS.rrpp, email: 'marta.lopez@vizzio.club', full_name: 'Marta López', role: 'rrpp', created_at: stamp },
    { id: DEMO_USERS.tech, email: 'nacho.vidal@vizzio.club', full_name: 'Nacho Vidal', role: 'tech', created_at: stamp },
    { id: DEMO_USERS.tray, email: 'rocio.vega@vizzio.club', full_name: 'Rocío Vega', role: 'tray', created_at: stamp },
  ];

  const events: ClubEvent[] = [];
  const entries: TimeEntry[] = [];
  const shifts: Shift[] = [];
  const tx: Transaction[] = [];

  const txAdd = (t: Pick<Transaction, 'date' | 'kind' | 'category' | 'amount' | 'method'> & Partial<Transaction>) =>
    tx.push({ id: uid(), created_at: stamp, period: null, employee_id: null, event_id: null, ...t, description: t.description ?? null });

  const saturdayNames = ['Saturday Night', 'Noche Latina', 'Techno Session', 'Remember 2000s', 'Neon Party'];
  let satIdx = 0;
  const privateNames = ['Cena de empresa · Grupo Acme', 'Boda García-López', 'Cumpleaños 30 · Marta R.', 'Fiesta fin de curso · Universidad'];
  let privateIdx = 0;

  const HOUR = 3_600_000;
  const start = addDays(today, -63);
  const end = addDays(today, 28);

  for (let d = start; d < end; d = addDays(d, 1)) {
    const date = isoDate(d);
    const dow = d.getDay(); // 0 domingo
    const isNight = dow === 4 || dow === 5 || dow === 6;
    const privateEvent = dow === 3 && r() < 0.12;
    if (!isNight && !privateEvent) continue;

    let name = 'Jueves Universitario';
    let kind: ClubEvent['kind'] = 'sesion';
    let expected = int(350, 520);
    if (privateEvent) {
      name = 'Evento privado · Empresa';
      kind = 'evento_privado';
      expected = int(150, 300);
    } else if (dow === 5) {
      name = r() < 0.15 ? 'Concierto en directo' : 'Viernes Vizzio';
      kind = name.startsWith('Concierto') ? 'concierto' : 'sesion';
      expected = int(650, 900);
    } else if (dow === 6) {
      name = saturdayNames[satIdx++ % saturdayNames.length];
      kind = r() < 0.2 ? 'especial' : 'sesion';
      expected = int(850, 1200);
    }

    const event: ClubEvent = {
      id: uid(),
      name,
      date,
      kind,
      expected_attendance: expected,
      notes: null,
      created_at: stamp,
    };
    // Como si viniera de Fourvenues: entradas vendidas y QR gratis (los eventos privados no venden)
    if (kind !== 'evento_privado') {
      const paid = Math.round(expected * (0.15 + r() * 0.25));
      const free = Math.round(expected * (0.04 + r() * 0.08));
      Object.assign(event, { tickets_paid: paid, tickets_free: free, tickets_sold: paid + free });
    }
    events.push(event);

    const nightEnd = d.getTime() + 31 * HOUR; // 07:00 del día siguiente
    const past = nightEnd < nowMs;
    const attend = dow === 4 ? 0.55 : privateEvent ? 0.5 : 0.92;

    staff.forEach(([, , , dept, , rate, , startH, durH], i) => {
      const emp = employees[i];
      const alwaysOn = dept === 'direccion' && dow !== 4;
      if (!alwaysOn && r() > attend) return;
      if (!emp.active && d > addDays(today, -20)) return;

      const plannedStart = d.getTime() + startH * HOUR;
      // Turno planificado (últimas 2 semanas y próximas 4)
      if (d >= addDays(today, -14)) {
        shifts.push({
          id: uid(),
          employee_id: emp.id,
          event_id: event.id,
          start_at: new Date(plannedStart).toISOString(),
          end_at: new Date(plannedStart + durH * HOUR).toISOString(),
          position: emp.position,
          status: d < addDays(today, 7) ? 'confirmed' : 'planned',
          notes: null,
          created_at: stamp,
        });
      }
      if (!past) return;

      const inMs = plannedStart + between(-12, 15) * 60000;
      const outMs = inMs + durH * HOUR + between(-20, 35) * 60000;
      entries.push({
        id: uid(),
        employee_id: emp.id,
        clock_in: new Date(inMs).toISOString(),
        clock_out: new Date(outMs).toISOString(),
        break_minutes: r() < 0.4 ? 15 : r() < 0.2 ? 30 : 0,
        hourly_rate: rate,
        event_id: event.id,
        source: r() < 0.06 ? 'manual' : 'app',
        notes: null,
        created_at: stamp,
      });
    });

    if (!past) continue;

    // Ingresos de la noche
    const people = expected * between(0.78, 1.08);
    const door = round(people * 0.62 * between(12, 15));
    const bar = round(people * between(14, 21));
    const vip = privateEvent ? round(between(3000, 6000), 50) : round(dow === 4 ? between(250, 900) : between(1500, 5200), 50);
    const cloak = round(people * 0.45 * 2, 5);
    const cardShare = between(0.52, 0.68);
    const addIncome = (category: string, amount: number, method: PaymentMethod, description?: string) =>
      amount > 0 && txAdd({ date, kind: 'income', category, amount, method, event_id: event.id, description });
    // Reparto de la barra entre las tres barras del local
    const addBars = (total: number, method: PaymentMethod) =>
      [0.45, 0.35, 0.2].forEach((w, i) => addIncome(`Barra ${i + 1}`, round(total * w), method));

    if (privateEvent) {
      addIncome('Eventos privados', vip, 'transferencia', privateNames[privateIdx++ % privateNames.length]);
      addIncome('Barra 1', round(bar * 0.4), 'tarjeta');
    } else {
      addIncome('Taquilla', round(door * cardShare), 'tarjeta');
      addIncome('Taquilla', round(door * (1 - cardShare)), 'efectivo');
      addBars(bar * cardShare, 'tarjeta');
      addBars(bar * (1 - cardShare), 'efectivo');
      addIncome('Reservados VIP', vip, 'tarjeta');
      addIncome('Guardarropa', cloak, 'efectivo');
    }

    if (dow === 6 || kind === 'concierto') {
      txAdd({
        date,
        kind: 'expense',
        category: 'DJ / Artistas',
        amount: round(between(600, 2200), 50),
        method: 'transferencia',
        description: kind === 'concierto' ? 'Caché banda' : 'DJ invitado',
        event_id: event.id,
      });
      txAdd({ date, kind: 'expense', category: 'Seguridad externa', amount: 480, method: 'transferencia', event_id: event.id, description: 'Refuerzo seguridad' });
      txAdd({ date, kind: 'expense', category: 'Personal', amount: round(between(180, 260), 5), method: 'efectivo', event_id: event.id, description: '2 camareros extra' });
    }
  }

  // Gastos semanales y mensuales
  for (let d = start; d < today; d = addDays(d, 1)) {
    const date = isoDate(d);
    if (d.getDay() === 2)
      txAdd({ date, kind: 'expense', category: 'Proveedores bebida', amount: round(between(9000, 13500)), method: 'transferencia', description: 'Pedido semanal distribuidora' });
    if (d.getDate() === 1) {
      txAdd({ date, kind: 'expense', category: 'Alquiler', amount: 12000, method: 'transferencia', description: 'Alquiler local' });
      txAdd({ date, kind: 'expense', category: 'Licencias / SGAE', amount: 480, method: 'transferencia' });
    }
    if (d.getDate() === 5) {
      txAdd({ date, kind: 'expense', category: 'Suministros', amount: round(between(2600, 3600)), method: 'transferencia', description: 'Luz, agua y gas' });
      txAdd({ date, kind: 'expense', category: 'Marketing', amount: round(between(1500, 3000)), method: 'tarjeta', description: 'Campaña redes sociales' });
    }
    if (d.getDate() === 18)
      txAdd({ date, kind: 'expense', category: 'Mantenimiento', amount: round(between(180, 750)), method: 'tarjeta' });
  }

  // Nóminas de meses cerrados (pagadas el día 3 del mes siguiente)
  for (let m = startOfMonth(start); addMonths(m, 1) <= today; m = addMonths(m, 1)) {
    const key = monthKey(m);
    const payDate = addDays(addMonths(m, 1), 2);
    if (payDate > today) continue;
    for (const emp of employees) {
      const cost = entries
        .filter((e) => e.employee_id === emp.id && monthKey(businessDate(e.clock_in)) === key)
        .reduce((a, e) => a + entryCost(e), 0);
      if (cost > 0)
        txAdd({
          date: isoDate(payDate),
          kind: 'expense',
          category: PAYROLL_CATEGORY,
          amount: Math.round(cost * 100) / 100,
          method: 'transferencia',
          employee_id: emp.id,
          period: key,
          description: `Nómina ${key} · ${emp.first_name} ${emp.last_name}`,
        });
    }
  }

  for (const sh of shifts) {
    const night = businessDate(sh.start_at);
    const entry = entries.find((e) => e.employee_id === sh.employee_id && e.clock_out && businessDate(e.clock_in) === night);
    sh.end_at = entry?.clock_out ?? null;
  }

  // Personas fichadas ahora mismo (para ver el panel "En turno")
  const busy = new Set(entries.filter((e) => Date.parse(e.clock_out!) > nowMs - 4 * HOUR).map((e) => e.employee_id));
  ['emp-2', 'emp-4', 'emp-6', 'emp-7'].forEach((id) => {
    if (busy.has(id)) return;
    const emp = employees.find((e) => e.id === id)!;
    entries.push({
      id: uid(),
      employee_id: id,
      clock_in: new Date(nowMs - between(0.6, 3.2) * HOUR).toISOString(),
      clock_out: null,
      break_minutes: 0,
      hourly_rate: emp.hourly_rate,
      event_id: events.find((e) => e.date === businessDate(nowMs))?.id ?? null,
      source: 'app',
      notes: null,
      created_at: stamp,
    });
  });

  // Ubicación de los fichajes desde la app: casi todos en el local, alguno fuera
  const venue: VenueLocation = { lat: 40.42005, lng: -3.70578, radius_m: 150, enforce: false };
  const rl = rng(4242);
  const near = (outside: boolean): Position => {
    const dist = outside ? 1500 + rl() * 4000 : rl() * 70;
    const angle = rl() * 2 * Math.PI;
    return {
      lat: venue.lat + (dist * Math.cos(angle)) / 111_320,
      lng: venue.lng + (dist * Math.sin(angle)) / (111_320 * Math.cos((venue.lat * Math.PI) / 180)),
      accuracy: Math.round(8 + rl() * 40),
    };
  };
  const located = (pos: Position) => {
    const distance = Math.round(distanceM(venue.lat, venue.lng, pos.lat, pos.lng));
    return { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, distance, outside: isOutside(distance, pos.accuracy, venue.radius_m) };
  };
  for (const e of entries) {
    if (e.source !== 'app') continue;
    const i = located(near(e.employee_id === 'emp-7' && !e.clock_out));
    Object.assign(e, { clock_in_lat: i.lat, clock_in_lng: i.lng, clock_in_accuracy: i.accuracy, clock_in_distance: i.distance, clock_in_outside: i.outside });
    if (!e.clock_out) continue;
    const o = located(near(rl() < 0.05));
    Object.assign(e, { clock_out_lat: o.lat, clock_out_lng: o.lng, clock_out_accuracy: o.accuracy, clock_out_distance: o.distance, clock_out_outside: o.outside });
  }

  // Disponibilidad de esta semana y la siguiente (Lucía deja la próxima sin rellenar para probarlo)
  const availability: Availability[] = [];
  const weekStart = startOfWeek(today);
  for (const emp of employees.filter((e) => e.active)) {
    for (let i = 0; i < 14; i++) {
      if (emp.id === 'emp-3' && i >= 7) continue;
      if (r() < 0.12) continue; // sin indicar
      const day = addDays(weekStart, i);
      const dow = day.getDay();
      const clubNight = dow === 4 || dow === 5 || dow === 6;
      const available = r() < (clubNight ? 0.85 : 0.35);
      const late = available && r() < 0.2;
      availability.push({
        id: uid(),
        employee_id: emp.id,
        date: isoDate(day),
        available,
        start_time: late ? '01:00' : null,
        end_time: null,
        note: !available && r() < 0.3 ? 'Examen / compromiso personal' : late ? 'Llego más tarde' : null,
        updated_at: stamp,
      });
    }
  }

  const leave: LeaveRequest[] = [
    { id: uid(), employee_id: 'emp-3', kind: 'vacaciones', start_date: isoDate(addDays(today, 18)), end_date: isoDate(addDays(today, 21)), reason: 'Viaje familiar', status: 'pending', reviewed_at: null, created_at: stamp },
    { id: uid(), employee_id: 'emp-4', kind: 'cambio_turno', start_date: isoDate(addDays(today, 5)), end_date: isoDate(addDays(today, 5)), reason: 'Cambio con Nerea el viernes', status: 'pending', reviewed_at: null, created_at: stamp },
    { id: uid(), employee_id: 'emp-6', kind: 'ausencia', start_date: isoDate(addDays(today, -9)), end_date: isoDate(addDays(today, -9)), reason: 'Examen universidad', status: 'approved', reviewed_at: stamp, created_at: stamp },
    { id: uid(), employee_id: 'emp-8', kind: 'vacaciones', start_date: isoDate(addDays(today, -30)), end_date: isoDate(addDays(today, -24)), reason: null, status: 'rejected', reviewed_at: stamp, created_at: stamp },
  ];

  // Reservados del local (con su posición en el plano) y reservas de las noches cercanas
  const vipTables: VipTable[] = CLUB_TABLES.map((t, i) => ({
    id: `vip-${i + 1}`,
    name: t.name,
    zone: t.zone,
    capacity: t.capacity,
    min_spend: t.capacity === 16 ? 500 : t.zone === 'Zona DJ' ? 300 : 200,
    active: true,
    sort: i + 1,
    notes: null,
    map_x: t.x,
    map_y: t.y,
    map_w: t.w,
    map_h: t.h,
    created_at: stamp,
  }));
  const bottleNames = ['Grey Goose', 'Absolut', 'Beefeater', 'Tanqueray', 'Barceló', "Jack Daniel's", 'Moët Brut Impérial', 'Puerto de Indias Fresa'];
  const mixerNames = ['Coca-Cola', 'Coca-Cola Zero', 'Tónica', 'Fanta Limón', 'Red Bull', 'Monster'];
  const customers = ['Álex Romero', 'Grupo Sergio M.', 'Cumpleaños Andrea', 'Despedida Pablo', 'Iván Herrera', 'Claudia Ramos', 'Empresa Nexo', 'Mario & friends', 'Rocío Peña', 'Daniel Gil', 'Laura Méndez', 'Tomás Vega'];
  const rrpps = [employees[5], employees[0]]; // Marta (RRPP) y Laura (gerente)

  // Fourvenues: Marta está asociada a su usuario; "Pablo Ruiz" vende allí pero no tiene ficha en la app
  employees[5].fourvenues_user_id = 'fv-marta';
  // El último con código es de los que Fourvenues no da el nombre (se pone a mano desde la noche)
  const fvRrpp: [string, string | null][] = [['fv-marta', 'Marta López'], ['fv-pablo', 'Pablo Ruiz'], ['fv-dani', 'Dani Promo'], ['5f3a9c0e7b21d4a68e0c1f2b9d7a4e63', null], ['', null]];
  const fourvenuesRrppNights: FourvenuesRrppNight[] = [];
  for (const ev of events.filter((e) => e.tickets_paid != null)) {
    ev.fourvenues_id = `fv-${ev.date}`;
    // Reparto de las entradas y las listas de la noche entre los RRPP (lo que sobra, sin RRPP)
    ev.bookings = int(2, 9);
    let tLeft = ev.tickets_paid!;
    let lLeft = ev.tickets_free ?? 0;
    let bLeft = ev.bookings;
    fvRrpp.forEach(([fvId, name], i) => {
      const last = i === fvRrpp.length - 1;
      const t = last ? tLeft : Math.round(tLeft * (0.3 + r() * 0.3));
      const l = last ? lLeft : Math.round(lLeft * (0.3 + r() * 0.3));
      const bk = last ? bLeft : Math.round(bLeft * (0.3 + r() * 0.3));
      tLeft -= t;
      lLeft -= l;
      bLeft -= bk;
      // Desglose: entradas anticipadas (10 €) y de última hora (15 €), una lista y reservados de cortesía o pagados
      const early = Math.round(t * 0.7);
      const courtesy = Math.min(bk, Math.round(bk * 0.3));
      const detail: RrppNightDetail = {
        tickets: [
          { rate: 'Anticipada', price: 10, people: early, entered: Math.round(early * 0.8), amount: early * 10 },
          { rate: 'Última hora', price: 15, people: t - early, entered: Math.round((t - early) * 0.8), amount: (t - early) * 15 },
        ].filter((x) => x.people > 0),
        lists: l ? [{ rate: 'Lista gratis antes de la 1:30', people: l, entered: Math.round(l * 0.7) }] : [],
        bookings: [
          { kind: 'pagado' as const, zone: 'VIP', count: bk - courtesy, people: (bk - courtesy) * 8, amount: (bk - courtesy) * 300 },
          { kind: 'cortesia' as const, zone: 'VIP', count: courtesy, people: courtesy * 6, amount: 0 },
        ].filter((x) => x.count > 0),
      };
      fourvenuesRrppNights.push({ id: uid(), event_id: ev.id, fourvenues_user_id: fvId, name, tickets: t, lists: l, bookings: bk, detail, synced_at: stamp });
    });
  }
  const reservations: Reservation[] = [];
  for (const ev of events.filter((e) => e.date >= isoDate(addDays(today, -7)) && e.date <= isoDate(addDays(today, 14)))) {
    const isPast = ev.date < isoDate(businessToday());
    const count = int(3, 7);
    const picks = [...vipTables].sort(() => r() - 0.5).slice(0, count);
    picks.forEach((t, i) => {
      const rrpp = rrpps[r() < 0.7 ? 0 : 1];
      const nBottles = int(1, 3);
      const bottles = [...bottleNames].sort(() => r() - 0.5).slice(0, nBottles).map((name) => ({ name, qty: int(1, 2), price: menuPrice(name) }));
      const mixers = [...mixerNames].sort(() => r() - 0.5).slice(0, int(1, 3)).map((name) => ({ name, qty: int(2, 8), price: menuPrice(name) }));
      const status: ReservationStatus = isPast ? (r() < 0.85 ? 'arrived' : 'no_show') : r() < 0.6 ? 'confirmed' : 'pending';
      reservations.push({
        id: uid(),
        date: ev.date,
        table_id: t.id,
        customer_name: customers[(i + int(0, 11)) % customers.length],
        customer_phone: `+34 6${String(10000000 + Math.floor(r() * 89999999)).slice(0, 8)}`,
        guests: Math.max(2, Math.min(t.capacity ?? 6, int(4, 12))),
        arrival_time: ['00:30', '01:00', '01:30', '02:00'][int(0, 3)],
        min_spend: t.min_spend,
        deposit: r() < 0.6 ? round(between(50, 150), 10) : 0,
        bottles,
        mixers,
        total_amount: sumBy([...bottles, ...mixers], (x) => x.qty * (x.price ?? 0)),
        status,
        notes: r() < 0.25 ? 'Botella de bienvenida' : null,
        rrpp_id: rrpp.id,
        rrpp_name: `${rrpp.first_name} ${rrpp.last_name}`,
        rrpp_origin: null,
        host_rrpp_id: null,
        host_rrpp_name: null,
        created_by: rrpp.user_id,
        created_at: stamp,
        updated_at: stamp,
      });
    });
  }

  // Las reservas de cada noche también están en Fourvenues, a nombre de Marta; la primera es de cortesía
  // en la app (en Fourvenues figura con precio), para ver el cotejo con Reservados
  for (const ev of events) {
    const night = reservations.filter((x) => x.date === ev.date && x.status !== 'cancelled');
    const marta = fourvenuesRrppNights.find((x) => x.event_id === ev.id && x.fourvenues_user_id === 'fv-marta');
    if (!night.length || !marta?.detail) continue;
    const items = night.map((x) => ({
      name: x.customer_name.toUpperCase(),
      phone: (x.customer_phone ?? '').replace(/\D/g, '').slice(-9),
      zone: 'VIP',
      people: x.guests,
      price: x.total_amount ?? 0,
      courtesy: false,
    }));
    night[0].bottles = night[0].bottles.map((b) => ({ ...b, courtesy: true }));
    night[0].total_amount = 0;
    marta.bookings = items.length;
    marta.detail.bookingItems = items;
  }

  // Comisiones de RRPP: % por día de la semana y entradas vendidas por Marta en las noches pasadas
  const rateByDay: Record<number, [number, number]> = { 0: [0, 0], 1: [0, 0], 2: [0, 0], 3: [10, 5], 4: [10, 10], 5: [12, 10], 6: [15, 12] };
  const commissionRates: CommissionRate[] = Object.entries(rateByDay).map(([d, [b, t]]) => ({
    id: `rate-${d}`,
    weekday: Number(d),
    bottle_pct: b,
    ticket_pct: t,
    list_fee: b ? 1 : 0,
    updated_at: stamp,
  }));
  const ticketSales: TicketSale[] = events
    .filter((e) => e.date >= isoDate(addDays(today, -30)) && e.date < isoDate(businessToday()) && e.kind !== 'evento_privado')
    .map((e) => ({ id: uid(), date: e.date, employee_id: 'emp-6', quantity: int(8, 40), unit_price: 15, list_quantity: int(10, 60), notes: null, created_at: stamp }));

  const suppliers: Supplier[] = (
    [
      ['Distribuidora Martínez', 'Proveedores bebida', 'B12345678', 'Antonio Martínez', '+34 612 345 678'],
      ['Hielos del Sur', 'Proveedores bebida', 'B87654321', null, '+34 655 111 222'],
      ['Limpiezas Brillo', 'Mantenimiento', 'B11223344', 'Rosa', null],
      ['Iberdrola', 'Suministros', 'A95758389', null, null],
    ] as [string, string, string, string | null, string | null][]
  ).map(([name, category, tax_id, contact, phone], i) => ({ id: `sup-${i + 1}`, name, category, tax_id, contact, phone, email: null, notes: null, created_at: stamp }));

  // Mensajes y tareas de ejemplo (Lucía es emp-3; Nacho, emp-9)
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const messages: Message[] = [
    { id: 'msg-1', kind: 'task', title: 'Reponer la cámara de la barra 2', body: 'Antes de abrir, deja la cámara de la barra 2 llena (tónicas, refrescos y hielo).', due_date: isoDate(addDays(businessToday(), 1)), created_by: DEMO_USERS.admin, created_at: hoursAgo(3) },
    { id: 'msg-2', kind: 'message', title: 'Reunión de equipo el jueves', body: 'El jueves a las 22:30, antes de abrir, reunión de 15 minutos en la barra principal.', due_date: null, created_by: DEMO_USERS.admin, created_at: hoursAgo(26) },
    { id: 'msg-3', kind: 'task', title: 'Revisar las luces de la cabina', body: 'Una de las barras LED parpadea. Revísala antes del viernes.', due_date: isoDate(addDays(businessToday(), 2)), created_by: DEMO_USERS.admin, created_at: hoursAgo(50) },
  ];
  const rec = (id: string, message_id: string, employee_id: string, extra: Partial<MessageRecipient> = {}): MessageRecipient => ({
    id, message_id, employee_id, read_at: null, response: null, responded_at: null, response_note: null, created_at: stamp, ...extra,
  });
  const messageRecipients: MessageRecipient[] = [
    rec('rcp-1', 'msg-1', 'emp-3'),
    rec('rcp-2', 'msg-1', 'emp-9', { read_at: hoursAgo(2), response: 'accepted', responded_at: hoursAgo(2) }),
    ...['emp-2', 'emp-3', 'emp-4', 'emp-5', 'emp-9'].map((e, i) => rec(`rcp-m${i}`, 'msg-2', e, i % 2 ? { read_at: hoursAgo(20) } : {})),
    rec('rcp-3', 'msg-3', 'emp-9', { read_at: hoursAgo(40), response: 'declined', responded_at: hoursAgo(40), response_note: 'Este finde no estoy, mejor el lunes' }),
  ];
  // Conversaciones de ejemplo: Lucía pregunta por la reunión y la gerente le contesta; Nacho pregunta por las luces
  const reply = (id: string, recipient_id: string, from_admin: boolean, body: string, h: number, read: boolean): MessageReply => ({
    id, recipient_id, author_id: from_admin ? DEMO_USERS.admin : null, from_admin, body, created_at: hoursAgo(h), read_at: read ? hoursAgo(h - 0.5) : null,
  });
  const messageReplies: MessageReply[] = [
    reply('rpl-1', 'rcp-m1', false, '¿Hay que venir con el uniforme puesto?', 22, true),
    reply('rpl-2', 'rcp-m1', true, 'Sí, ya cambiados para empezar a las 23:00.', 21, false),
    reply('rpl-3', 'rcp-3', false, 'El lunes por la tarde puedo pasarme a revisarlas si os viene bien.', 39, false),
  ];

  return {
    profiles,
    employees,
    events,
    time_entries: entries,
    shifts,
    transactions: tx,
    leave_requests: leave,
    availability,
    vip_tables: vipTables,
    reservations,
    rrpp_commission_rates: commissionRates,
    rrpp_ticket_sales: ticketSales,
    suppliers,
    messages,
    message_recipients: messageRecipients,
    message_replies: messageReplies,
    fourvenues_rrpp_nights: fourvenuesRrppNights,
    venue_location: [{ id: 'venue', ...venue, updated_at: stamp }],
  } as unknown as DB;
}

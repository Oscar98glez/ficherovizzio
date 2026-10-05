/**
 * Modo demo: base de datos local en localStorage con datos de ejemplo.
 * Se usa automáticamente mientras no haya credenciales de Supabase.
 */
import type { Query, Repo } from './api';
import { CLUB_TABLES } from './club-map';
import { PAYROLL_CATEGORY } from './constants';
import { menuPrice } from './menu';
import { addDays, addMonths, businessDate, businessToday, isoDate, monthKey, startOfDay, startOfMonth, startOfWeek } from './dates';
import type {
  Availability,
  ClubEvent,
  ContractType,
  Department,
  Employee,
  LeaveRequest,
  PaymentMethod,
  Profile,
  Reservation,
  ReservationStatus,
  Shift,
  TimeEntry,
  Transaction,
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
  | 'reservations';

type DB = Record<TableName, Record<string, unknown>[]>;

const DB_KEY = 'vizzio.demo.db.v13';
const SESSION_KEY = 'vizzio.demo.session';

export const DEMO_USERS = {
  admin: 'demo-admin',
  worker: 'demo-worker',
  rrpp: 'demo-rrpp',
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
      Object.assign(r, patch);
      if (table === 'reservations') Object.assign(r, reservationRules(r as unknown as Reservation, false));
      if (table === 'time_entries') syncShiftEnd(r as unknown as TimeEntry);
      persist();
      return clone(r) as unknown as T;
    },
    async remove(id) {
      await wait();
      getDb()[table] = rows().filter((x) => x.id !== id);
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
    res.rrpp_id ??= (d.employees.find((e) => e.user_id === userId)?.id as string) ?? null;
  }
  const nameOf = (id: string | null) => {
    const emp = d.employees.find((e) => e.id === id) as Employee | undefined;
    return emp ? `${emp.first_name} ${emp.last_name}`.trim() : null;
  };
  res.rrpp_name = nameOf(res.rrpp_id);
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

export async function demoClockIn(notes?: string): Promise<TimeEntry> {
  const emp = currentEmployee();
  const d = getDb();
  if (d.time_entries.some((t) => t.employee_id === emp.id && !t.clock_out)) throw new Error('ALREADY_CLOCKED_IN');
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
  };
  d.time_entries.push(entry as unknown as Record<string, unknown>);
  persist();
  await wait();
  return clone(entry);
}

export async function demoClockOut(notes?: string): Promise<TimeEntry> {
  const emp = currentEmployee();
  const open = getDb().time_entries.find((t) => t.employee_id === emp.id && !t.clock_out);
  if (!open) throw new Error('NOT_CLOCKED_IN');
  open.clock_out = new Date().toISOString();
  syncShiftEnd(open as unknown as TimeEntry);
  if (notes) open.notes = notes;
  persist();
  await wait();
  return clone(open) as unknown as TimeEntry;
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
    ['Nacho', 'Vidal', 'DJ residente', 'cabina', 'autonomo', 45, '#ff2d55', 0.5, 5.5],
    ['Sara', 'Jiménez', 'Taquillera', 'taquilla', 'fijo_discontinuo', 12.5, '#5856d6', 23.5, 4.5],
    ['Paula', 'Navarro', 'Guardarropa', 'guardarropa', 'extra', 11, '#30b0c7', 23.5, 7],
    ['Irene', 'Castro', 'Limpieza', 'limpieza', 'fijo_discontinuo', 12, '#34c759', 29.5, 4],
    ['Hugo', 'Morales', 'Camarero', 'barra', 'extra', 12, '#ff3b30', 23.5, 6.5],
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
  const mixerNames = ['Coca-Cola', 'Coca-Cola Zero', 'Tónica', 'Fanta Limón', 'Red Bull', 'Agua'];
  const customers = ['Álex Romero', 'Grupo Sergio M.', 'Cumpleaños Andrea', 'Despedida Pablo', 'Iván Herrera', 'Claudia Ramos', 'Empresa Nexo', 'Mario & friends', 'Rocío Peña', 'Daniel Gil', 'Laura Méndez', 'Tomás Vega'];
  const rrpps = [employees[5], employees[0]]; // Marta (RRPP) y Laura (gerente)
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
        host_rrpp_id: null,
        host_rrpp_name: null,
        created_by: rrpp.user_id,
        created_at: stamp,
        updated_at: stamp,
      });
    });
  }

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
  } as unknown as DB;
}

/**
 * Modo demo: base de datos local en localStorage con datos de ejemplo.
 * Se usa automáticamente mientras no haya credenciales de Supabase.
 */
import type { Query, Repo } from './api';
import { PAYROLL_CATEGORY } from './constants';
import { addDays, addMonths, businessDate, isoDate, monthKey, startOfDay, startOfMonth } from './dates';
import type {
  ClubEvent,
  ContractType,
  Department,
  Employee,
  LeaveRequest,
  PaymentMethod,
  Profile,
  Shift,
  TimeEntry,
  Transaction,
} from './types';
import { entryCost, uid } from './utils';

export type TableName =
  | 'profiles'
  | 'employees'
  | 'events'
  | 'time_entries'
  | 'shifts'
  | 'transactions'
  | 'leave_requests';

type DB = Record<TableName, Record<string, unknown>[]>;

const DB_KEY = 'vizzio.demo.db.v3';
const SESSION_KEY = 'vizzio.demo.session';

export const DEMO_USERS = {
  admin: 'demo-admin',
  worker: 'demo-worker',
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
  const rows = () => getDb()[table];
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
      if (table === 'time_entries') {
        for (const c of created as unknown as TimeEntry[]) {
          if (!c.clock_out && rows().some((r) => r.employee_id === c.employee_id && !r.clock_out))
            throw new Error('ALREADY_CLOCKED_IN');
        }
      }
      rows().push(...created);
      persist();
      return clone(created) as unknown as T[];
    },
    async update(id, patch) {
      await wait();
      const r = rows().find((x) => x.id === id);
      if (!r) throw new Error('Registro no encontrado');
      Object.assign(r, patch);
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
    ['Marta', 'López', 'Relaciones públicas', 'relaciones', 'autonomo', 14, '#ff9500', 23.5, 4.5],
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
    color,
    notes: null,
    created_at: stamp,
  }));

  const profiles: Profile[] = [
    { id: DEMO_USERS.admin, email: 'laura.gomez@vizzio.club', full_name: 'Laura Gómez', role: 'admin', created_at: stamp },
    { id: DEMO_USERS.worker, email: 'lucia.martin@vizzio.club', full_name: 'Lucía Martín', role: 'worker', created_at: stamp },
  ];

  const events: ClubEvent[] = [];
  const entries: TimeEntry[] = [];
  const shifts: Shift[] = [];
  const tx: Transaction[] = [];

  const txAdd = (t: Pick<Transaction, 'date' | 'kind' | 'category' | 'amount' | 'method'> & Partial<Transaction>) =>
    tx.push({ id: uid(), created_at: stamp, period: null, employee_id: null, event_id: null, ...t, description: t.description ?? null });

  const saturdayNames = ['Saturday Night', 'Noche Latina', 'Techno Session', 'Remember 2000s', 'Neon Party'];
  let satIdx = 0;

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
    const addIncome = (category: string, amount: number, method: PaymentMethod) =>
      amount > 0 && txAdd({ date, kind: 'income', category, amount, method, event_id: event.id });

    if (privateEvent) {
      addIncome('Eventos privados', vip, 'transferencia');
      addIncome('Barra', round(bar * 0.4), 'tarjeta');
    } else {
      addIncome('Taquilla', round(door * cardShare), 'tarjeta');
      addIncome('Taquilla', round(door * (1 - cardShare)), 'efectivo');
      addIncome('Barra', round(bar * cardShare), 'tarjeta');
      addIncome('Barra', round(bar * (1 - cardShare)), 'efectivo');
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

  const leave: LeaveRequest[] = [
    { id: uid(), employee_id: 'emp-3', kind: 'vacaciones', start_date: isoDate(addDays(today, 18)), end_date: isoDate(addDays(today, 21)), reason: 'Viaje familiar', status: 'pending', reviewed_at: null, created_at: stamp },
    { id: uid(), employee_id: 'emp-4', kind: 'cambio_turno', start_date: isoDate(addDays(today, 5)), end_date: isoDate(addDays(today, 5)), reason: 'Cambio con Nerea el viernes', status: 'pending', reviewed_at: null, created_at: stamp },
    { id: uid(), employee_id: 'emp-6', kind: 'ausencia', start_date: isoDate(addDays(today, -9)), end_date: isoDate(addDays(today, -9)), reason: 'Examen universidad', status: 'approved', reviewed_at: stamp, created_at: stamp },
    { id: uid(), employee_id: 'emp-8', kind: 'vacaciones', start_date: isoDate(addDays(today, -30)), end_date: isoDate(addDays(today, -24)), reason: null, status: 'rejected', reviewed_at: stamp, created_at: stamp },
  ];

  return {
    profiles,
    employees,
    events,
    time_entries: entries,
    shifts,
    transactions: tx,
    leave_requests: leave,
  } as unknown as DB;
}

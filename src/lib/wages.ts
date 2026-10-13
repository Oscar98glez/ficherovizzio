/**
 * Sueldos de una semana ("sobres"): lo que ha trabajado y ganado cada persona cada noche,
 * agrupado como en la plantilla de sobres (camareras, bandejas, DJ y luces, embajadoras y porteros).
 */
import { addDays, businessDate, isoDate, parseDate, type Period } from './dates';
import type { Employee, Role, TimeEntry, Transaction } from './types';
import { entryCost, entryHours, fullName, groupBy, staffKind, sumBy } from './utils';

export type WageSectionKey = 'camareras' | 'bandejas' | 'dj' | 'embajadoras' | 'otros';

export const WAGE_SECTIONS: { key: WageSectionKey; label: string }[] = [
  { key: 'camareras', label: 'CAMARERAS' },
  { key: 'bandejas', label: 'BANDEJAS' },
  { key: 'dj', label: 'DJ y LUCES' },
  { key: 'embajadoras', label: 'EMBAJADORAS' },
  { key: 'otros', label: 'OTROS' },
];

/** Gastos de la noche que van en "Gastos extras" (DJ invitados, artistas…) */
export const EXTRA_CATEGORIES = ['DJ / Artistas'];

/** Valor de la hora de los porteros en la plantilla (se rellenan a mano) */
export const DOORMAN_RATE = 15;
export const IVA = 0.21;

/** Lunes a domingo, como en la plantilla (sin tilde en miércoles) */
const DAY_NAMES = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
/** Las noches que abre el local: siempre salen, aunque nadie trabaje */
const OPEN_DAYS = [2, 3, 4, 5];

export interface WageDay {
  date: string;
  /** "MIERCOLES" */
  name: string;
  /** "8/10" */
  short: string;
}

export interface WageCell {
  /** Primera entrada y última salida de la noche (null si sigue abierta) */
  clockIn: string;
  clockOut: string | null;
  hours: number;
  rate: number;
  amount: number;
  /** Un solo fichaje cerrado y sin pausa: en Excel las horas se calculan con la entrada y la salida */
  simple: boolean;
  guest: boolean;
}

export interface WageRow {
  employee: Employee;
  name: string;
  /** Tarifa de la ficha, para las noches que no ha venido */
  rate: number;
  cells: Record<string, WageCell | undefined>;
  hours: number;
  amount: number;
}

export interface WageSection {
  key: WageSectionKey;
  label: string;
  rows: WageRow[];
  hours: number;
  amount: number;
}

export interface WageExtra {
  date: string;
  description: string;
  amount: number;
}

export interface WageSheet {
  period: Period;
  days: WageDay[];
  sections: WageSection[];
  /** Personal de seguridad con fichajes (si no, la plantilla deja PORTERO 1–6 para rellenar) */
  doormen: WageRow[];
  extras: WageExtra[];
  hours: number;
  amount: number;
  extrasAmount: number;
  generatedAt: Date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const sectionOf = (e: Employee, role: Role): WageSectionKey | 'porteros' => {
  if (e.department === 'seguridad') return 'porteros';
  if (role === 'tray') return 'bandejas';
  if (role === 'tech') return 'dj';
  if (role === 'rrpp') return 'embajadoras';
  if (role === 'admin' || ['direccion', 'taquilla', 'guardarropa', 'limpieza'].includes(e.department)) return 'otros';
  return 'camareras';
};

function cellOf(entries: TimeEntry[], now: number): WageCell {
  const sorted = [...entries].sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  const closed = sorted.every((x) => x.clock_out);
  const hours = sumBy(sorted, (x) => entryHours(x, now));
  const amount = round2(sumBy(sorted, (x) => entryCost(x, now)));
  const rates = new Set(sorted.map((x) => x.hourly_rate));
  return {
    clockIn: sorted[0].clock_in,
    clockOut: closed ? sorted.map((x) => x.clock_out!).sort().reverse()[0] : null,
    hours,
    // Con varias tarifas en la misma noche se usa la media
    rate: rates.size === 1 ? sorted[0].hourly_rate : hours > 0 ? round2(amount / hours) : sorted[0].hourly_rate,
    amount,
    simple: sorted.length === 1 && closed && !sorted[0].break_minutes,
    guest: sorted.some((x) => x.guest),
  };
}

export function buildWageSheet({
  period,
  employees,
  roles,
  entries,
  transactions,
  now = Date.now(),
}: {
  period: Period;
  employees: Employee[];
  roles: Map<string, Role>;
  entries: TimeEntry[];
  transactions: Transaction[];
  now?: number;
}): WageSheet {
  const monday = parseDate(period.from);
  const nights = groupBy(entries, (x) => businessDate(x.clock_in));
  const days: WageDay[] = DAY_NAMES.map((name, i) => {
    const d = addDays(monday, i);
    return { date: isoDate(d), name, short: `${d.getDate()}/${d.getMonth() + 1}` };
  }).filter((d, i) => OPEN_DAYS.includes(i) || nights[d.date]?.length);

  const byEmp = groupBy(entries, (x) => x.employee_id);
  const buckets = new Map<WageSectionKey | 'porteros', WageRow[]>();
  for (const e of employees) {
    const own = byEmp[e.id] ?? [];
    const section = sectionOf(e, staffKind(e, roles));
    // Salen quienes han trabajado esa semana y el personal fijo por horas que está de alta
    const fixed = e.active && e.hourly_rate > 0 && (section === 'camareras' || section === 'bandejas' || section === 'dj');
    if (!own.length && !fixed) continue;
    const perNight = groupBy(own, (x) => businessDate(x.clock_in));
    const cells: WageRow['cells'] = {};
    for (const d of days) if (perNight[d.date]?.length) cells[d.date] = cellOf(perNight[d.date], now);
    const list = Object.values(cells) as WageCell[];
    const row: WageRow = {
      employee: e,
      name: fullName(e),
      rate: e.hourly_rate,
      cells,
      hours: sumBy(list, (c) => c.hours),
      amount: round2(sumBy(list, (c) => c.amount)),
    };
    buckets.set(section, [...(buckets.get(section) ?? []), row]);
  }
  const byName = (a: WageRow, b: WageRow) => a.name.localeCompare(b.name, 'es');

  const sections = WAGE_SECTIONS.map(({ key, label }) => {
    const rows = (buckets.get(key) ?? []).sort(byName);
    return { key, label, rows, hours: sumBy(rows, (r) => r.hours), amount: round2(sumBy(rows, (r) => r.amount)) };
  }).filter((s) => s.key !== 'otros' || s.rows.length);

  const dates = new Set(days.map((d) => d.date));
  const extras = transactions
    .filter((t) => t.kind === 'expense' && EXTRA_CATEGORIES.includes(t.category) && dates.has(t.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({ date: t.date, description: t.description?.trim() || t.category, amount: t.amount }));

  const doormen = (buckets.get('porteros') ?? []).filter((r) => r.hours > 0).sort(byName);
  const staffRows = [...sections.flatMap((s) => s.rows), ...doormen];
  return {
    period,
    days,
    sections,
    doormen,
    extras,
    hours: sumBy(staffRows, (r) => r.hours),
    amount: round2(sumBy(staffRows, (r) => r.amount)),
    extrasAmount: round2(sumBy(extras, (x) => x.amount)),
    generatedAt: new Date(),
  };
}

/** Total de una noche en una lista de filas */
export const dayAmount = (rows: WageRow[], date: string) => round2(sumBy(rows, (r) => r.cells[date]?.amount ?? 0));

/** sobres-vizzio-2026-10-05.xlsx (el lunes de la semana) */
export const wageFileName = (s: WageSheet, ext: 'xlsx' | 'pdf') => `sobres-vizzio-${s.period.from}.${ext}`;

export async function downloadWages(s: WageSheet, kind: 'xlsx' | 'pdf') {
  if (kind === 'pdf') {
    const { renderWagesPdf } = await import('./wages-pdf');
    return renderWagesPdf(s);
  }
  const { renderWagesXlsx } = await import('./wages-xlsx');
  return renderWagesXlsx(s);
}

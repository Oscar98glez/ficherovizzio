/**
 * Sueldos de una semana ("sobres"): lo que ha trabajado y ganado cada persona cada noche,
 * agrupado como en la plantilla de sobres (camareras, bandejas, DJ y luces, embajadoras y porteros).
 */
import { addDays, businessDate, isoDate, parseDate, type Period } from './dates';
import type { Employee, Role, TimeEntry, WageExtraEntry, WageSectionKey } from './types';
import { entryCost, entryHours, fullName, groupBy, staffKind, sumBy } from './utils';

export type { WageSectionKey };

/** Secciones del bloque "PERSONAL FIJO" (los porteros van en su propio bloque) */
export const WAGE_SECTIONS: { key: Exclude<WageSectionKey, 'porteros'>; label: string }[] = [
  { key: 'camareras', label: 'CAMARERAS' },
  { key: 'bandejas', label: 'BANDEJAS' },
  { key: 'dj', label: 'DJ y LUCES' },
  { key: 'embajadoras', label: 'EMBAJADORAS' },
  { key: 'otros', label: 'OTROS' },
];

export const SECTION_TITLE: Record<WageSectionKey, string> = {
  camareras: 'Camareras',
  bandejas: 'Bandejas',
  dj: 'DJ y luces',
  embajadoras: 'Embajadoras',
  otros: 'Otros',
  porteros: 'Porteros',
};

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
  /** Primera entrada y última salida de la noche (null si sigue abierta, o extra sin horario) */
  clockIn: string | null;
  clockOut: string | null;
  hours: number;
  rate: number;
  amount: number;
  /** Un solo fichaje cerrado y sin pausa: en Excel las horas se calculan con la entrada y la salida */
  simple: boolean;
  guest: boolean;
  /** Importe fijo de la noche (extras): no es horas × precio */
  fixed: boolean;
}

export interface WageRow {
  /** Clave única de la fila */
  key: string;
  /** Su ficha; null si es un extra sin ficha ni cuenta */
  employee: Employee | null;
  /** Extras: sus noches de la semana */
  extras: WageExtraEntry[];
  name: string;
  /** Tarifa de la ficha, para las noches que no ha venido */
  rate: number;
  cells: Record<string, WageCell | undefined>;
  hours: number;
  amount: number;
}

export interface WageSection {
  key: Exclude<WageSectionKey, 'porteros'>;
  label: string;
  rows: WageRow[];
  hours: number;
  amount: number;
}

export interface WageSheet {
  period: Period;
  days: WageDay[];
  sections: WageSection[];
  /** Porteros (seguridad con fichajes y extras): si no hay, la plantilla deja PORTERO 1–6 para rellenar */
  doormen: WageRow[];
  hours: number;
  amount: number;
  /** Extras sin ficha y cuántos no tienen todavía precio */
  extrasCount: number;
  unpriced: number;
  generatedAt: Date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const sectionOf = (e: Employee, role: Role): WageSectionKey => {
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
    fixed: false,
  };
}

/** Instante de una hora HH:MM de la noche `date` (antes de las 06:00 es del día siguiente) */
export function nightInstant(date: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = parseDate(date);
  if (h < 6) d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

const minutesOf = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Horas entre dos HH:MM de la misma noche (si la salida es anterior a la entrada, es del día siguiente) */
export function hoursBetween(from: string, to: string) {
  const a = minutesOf(from);
  let b = minutesOf(to);
  if (b <= a) b += 24 * 60;
  return (b - a) / 60;
}

/** Lo que cobra un extra una noche: el importe fijo o horas × precio */
export const extraAmount = (x: Pick<WageExtraEntry, 'amount' | 'hours' | 'rate'>) =>
  round2(x.amount != null ? Number(x.amount) : Number(x.hours) * Number(x.rate));

function extraCell(list: WageExtraEntry[]): WageCell {
  const x = list[0];
  const hours = sumBy(list, (e) => Number(e.hours));
  const amount = round2(sumBy(list, extraAmount));
  const fixed = list.some((e) => e.amount != null);
  return {
    clockIn: x.clock_in ? nightInstant(x.date, x.clock_in) : null,
    // La salida es siempre posterior a la entrada (00:00–06:30: las dos de la madrugada)
    clockOut: x.clock_out ? (x.clock_in ? new Date(Date.parse(nightInstant(x.date, x.clock_in)) + hoursBetween(x.clock_in, x.clock_out) * 3600e3).toISOString() : nightInstant(x.date, x.clock_out)) : null,
    hours,
    rate: Number(x.rate),
    amount,
    simple: list.length === 1 && !!x.clock_in && !!x.clock_out && !fixed,
    guest: false,
    fixed,
  };
}

export function buildWageSheet({
  period,
  employees,
  roles,
  entries,
  extras = [],
  now = Date.now(),
}: {
  period: Period;
  employees: Employee[];
  roles: Map<string, Role>;
  entries: TimeEntry[];
  /** Extras sin ficha de esa semana */
  extras?: WageExtraEntry[];
  now?: number;
}): WageSheet {
  const monday = parseDate(period.from);
  const nights = groupBy(entries, (x) => businessDate(x.clock_in));
  const extraNights = new Set(extras.map((x) => x.date));
  const days: WageDay[] = DAY_NAMES.map((name, i) => {
    const d = addDays(monday, i);
    return { date: isoDate(d), name, short: `${d.getDate()}/${d.getMonth() + 1}` };
  }).filter((d, i) => OPEN_DAYS.includes(i) || nights[d.date]?.length || extraNights.has(d.date));

  const byEmp = groupBy(entries, (x) => x.employee_id);
  const buckets = new Map<WageSectionKey, WageRow[]>();
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
      key: e.id,
      employee: e,
      extras: [],
      name: fullName(e),
      rate: e.hourly_rate,
      cells,
      hours: sumBy(list, (c) => c.hours),
      amount: round2(sumBy(list, (c) => c.amount)),
    };
    buckets.set(section, [...(buckets.get(section) ?? []), row]);
  }
  const byName = (a: WageRow, b: WageRow) => a.name.localeCompare(b.name, 'es');

  // Extras: una fila por persona y sección, con sus noches, después del personal con ficha
  const extraRows = new Map<WageSectionKey, WageRow[]>();
  const people = groupBy(extras, (x) => `${x.section}|${x.name.trim().toLowerCase()}`);
  for (const [key, list] of Object.entries(people)) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const perNight = groupBy(sorted, (x) => x.date);
    const cells: WageRow['cells'] = {};
    for (const [date, xs] of Object.entries(perNight)) cells[date] = extraCell(xs);
    const cellList = Object.values(cells) as WageCell[];
    const row: WageRow = {
      key: `extra|${key}`,
      employee: null,
      extras: sorted,
      name: sorted[0].name.trim(),
      rate: Number(sorted[0].rate),
      cells,
      hours: sumBy(cellList, (c) => c.hours),
      amount: round2(sumBy(cellList, (c) => c.amount)),
    };
    const section = sorted[0].section;
    extraRows.set(section, [...(extraRows.get(section) ?? []), row]);
  }
  const rowsOf = (key: WageSectionKey) => [...(buckets.get(key) ?? []).sort(byName), ...(extraRows.get(key) ?? []).sort(byName)];

  const sections = WAGE_SECTIONS.map(({ key, label }) => {
    const rows = rowsOf(key);
    return { key, label, rows, hours: sumBy(rows, (r) => r.hours), amount: round2(sumBy(rows, (r) => r.amount)) };
  }).filter((s) => s.key !== 'otros' || s.rows.length);

  const doormen = rowsOf('porteros').filter((r) => r.hours > 0 || r.amount > 0 || !r.employee);
  const staffRows = [...sections.flatMap((s) => s.rows), ...doormen];
  const extraList = staffRows.filter((r) => !r.employee);
  return {
    period,
    days,
    sections,
    doormen,
    hours: sumBy(staffRows, (r) => r.hours),
    amount: round2(sumBy(staffRows, (r) => r.amount)),
    extrasCount: extraList.length,
    unpriced: extraList.filter((r) => r.extras.some((x) => x.amount == null && !Number(x.rate))).length,
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

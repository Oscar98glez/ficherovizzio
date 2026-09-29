import { BUSINESS_DAY_OFFSET_HOURS } from './config';

const LOCALE = 'es-ES';
const HOUR = 3_600_000;

export const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha local en formato YYYY-MM-DD */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function monthKey(d: Date | string): string {
  const x = typeof d === 'string' ? parseDate(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
}

/** Día de negocio (la "noche") al que pertenece un instante. */
export function businessDate(iso: string | number | Date): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : +iso;
  return isoDate(new Date(t - BUSINESS_DAY_OFFSET_HOURS * HOUR));
}

export function businessToday(): Date {
  return parseDate(businessDate(Date.now()));
}

/** Instante ISO en el que empieza un día de negocio (06:00 local). */
export function businessStart(date: string): string {
  const d = parseDate(date);
  d.setHours(BUSINESS_DAY_OFFSET_HOURS);
  return d.toISOString();
}

/** Para <input type="datetime-local"> */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Combina fecha + horas; si el fin es anterior al inicio, pasa al día siguiente. */
export function combineRange(date: string, start: string, end: string) {
  const s = new Date(`${date}T${start}`);
  let e = new Date(`${date}T${end}`);
  if (e <= s) e = new Date(e.getTime() + 24 * HOUR);
  return { start_at: s.toISOString(), end_at: e.toISOString() };
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Periodos ----------

export type PeriodUnit = 'week' | 'month' | 'year';

export interface Period {
  unit: PeriodUnit;
  /** inclusivo, YYYY-MM-DD */
  from: string;
  /** exclusivo, YYYY-MM-DD */
  to: string;
  label: string;
}

export function makePeriod(unit: PeriodUnit, anchor: Date = businessToday()): Period {
  if (unit === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 7);
    const last = addDays(to, -1);
    const sameMonth = from.getMonth() === last.getMonth();
    const a = from.toLocaleDateString(LOCALE, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const b = last.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
    return { unit, from: isoDate(from), to: isoDate(to), label: `${a} – ${b}` };
  }
  if (unit === 'month') {
    const from = startOfMonth(anchor);
    const to = addMonths(from, 1);
    const label = capitalize(from.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }));
    return { unit, from: isoDate(from), to: isoDate(to), label };
  }
  const from = new Date(anchor.getFullYear(), 0, 1);
  const to = new Date(anchor.getFullYear() + 1, 0, 1);
  return { unit, from: isoDate(from), to: isoDate(to), label: String(anchor.getFullYear()) };
}

export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  const from = parseDate(p.from);
  if (p.unit === 'week') return makePeriod('week', addDays(from, 7 * dir));
  if (p.unit === 'month') return makePeriod('month', addMonths(from, dir));
  return makePeriod('year', new Date(from.getFullYear() + dir, 0, 1));
}

export function periodContains(p: Period, date: string) {
  return date >= p.from && date < p.to;
}

/** Rango de instantes (ISO) que cubre los días de negocio de un periodo. */
export function periodRange(p: Pick<Period, 'from' | 'to'>) {
  return { start: businessStart(p.from), end: businessStart(p.to) };
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = parseDate(from); isoDate(d) < to; d = addDays(d, 1)) out.push(isoDate(d));
  return out;
}

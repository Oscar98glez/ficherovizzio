import { capitalize, parseDate, pad } from './dates';

const LOCALE = 'es-ES';

const money2 = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
const money0 = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });

export const fmtMoney = (n: number) => money2.format(n || 0);
export const fmtMoney0 = (n: number) => money0.format(Math.round(n || 0));
export const fmtCompactMoney = (n: number) => `${compact.format(n || 0)} €`;

export const fmtNum = (n: number, digits = 1) =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(n || 0);

export const fmtHours = (h: number) => `${fmtNum(h, 1)} h`;

export const fmtPercent = (n: number) =>
  new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 }).format(n || 0);

export function fmtTime(iso: string | Date) {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

type DateInput = string | Date;
const toDate = (d: DateInput) => (typeof d === 'string' ? (d.length <= 10 ? parseDate(d) : new Date(d)) : d);

export const fmtDate = (d: DateInput, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  toDate(d).toLocaleDateString(LOCALE, opts);

export const fmtDateLong = (d: DateInput) =>
  capitalize(toDate(d).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }));

export const fmtDateFull = (d: DateInput) =>
  capitalize(toDate(d).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));

export const fmtWeekday = (d: DateInput, style: 'short' | 'long' = 'short') =>
  capitalize(toDate(d).toLocaleDateString(LOCALE, { weekday: style }).replace('.', ''));

export function fmtDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function fmtDurationShort(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${pad(m)} min` : `${m} min`;
}

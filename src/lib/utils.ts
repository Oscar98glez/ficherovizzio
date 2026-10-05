import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, TIMESHEET_CATEGORY } from './constants';
import type { Employee, PaymentMethod, Shift, TimeEntry, TxKind } from './types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const fullName = (e: Pick<Employee, 'first_name' | 'last_name'> | null | undefined) =>
  e ? `${e.first_name} ${e.last_name}`.trim() : '—';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) (out[key(it)] ??= []).push(it);
  return out;
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const sumBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

export const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

export const parseAmount = (s: string) => {
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// ---------- Orden de movimientos por categoría ----------

const METHOD_ORDER: PaymentMethod[] = ['efectivo', 'tarjeta', 'bizum', 'transferencia', 'otro'];

/** Posición de una categoría según el orden de las listas (Taquilla, Barra 1, Barra 2…). */
export function categoryRank(kind: TxKind, category: string) {
  if (kind === 'expense' && category === TIMESHEET_CATEGORY) return -1;
  const list = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const i = list.indexOf(category);
  return i < 0 ? list.length : i;
}

export const methodRank = (m: PaymentMethod) => {
  const i = METHOD_ORDER.indexOf(m);
  return i < 0 ? METHOD_ORDER.length : i;
};

/** Ingresos primero, después por categoría y, dentro de cada una, efectivo antes que tarjeta. */
export function compareByCategory(
  a: { kind: TxKind; category: string; method?: PaymentMethod },
  b: { kind: TxKind; category: string; method?: PaymentMethod },
) {
  return (
    (a.kind === b.kind ? 0 : a.kind === 'income' ? -1 : 1) ||
    categoryRank(a.kind, a.category) - categoryRank(b.kind, b.category) ||
    a.category.localeCompare(b.category, 'es') ||
    (a.method && b.method ? methodRank(a.method) - methodRank(b.method) : 0)
  );
}

// ---------- Cálculos de horas y coste ----------

export function entryHours(e: Pick<TimeEntry, 'clock_in' | 'clock_out' | 'break_minutes'>, now = Date.now()) {
  const end = e.clock_out ? Date.parse(e.clock_out) : now;
  return Math.max(0, (end - Date.parse(e.clock_in)) / 3_600_000 - (e.break_minutes || 0) / 60);
}

export const entryCost = (e: TimeEntry, now = Date.now()) => entryHours(e, now) * (e.hourly_rate || 0);

/** Horas del turno (0 mientras no tenga salida fichada) */
export const shiftHours = (s: Pick<Shift, 'start_at' | 'end_at'>) =>
  s.end_at ? Math.max(0, (Date.parse(s.end_at) - Date.parse(s.start_at)) / 3_600_000) : 0;

// ---------- Exportar CSV (formato Excel en español) ----------

export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

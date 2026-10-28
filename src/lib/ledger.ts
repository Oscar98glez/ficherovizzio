/**
 * Hoja de caja de Administración: las mismas columnas y cuentas que el Excel "MODELO" de los
 * administrativos. Cada noche guarda sus importes por columna; los totales, los porcentajes,
 * el resumen por semana y los arrastres de efectivo y banco se calculan aquí.
 */
import { addDays, parseDate, startOfWeek, isoDate } from './dates';
import type { AdminLedgerDay, AdminLedgerMonth } from './types';

/** Cómo se paga un gasto: cuenta en el resumen de efectivo o en el de banco */
export type LedgerMethod = 'cash' | 'bank';

export interface LedgerColumn {
  key: string;
  label: string;
  /** Gastos: de dónde sale el dinero */
  method?: LedgerMethod;
  /** Columna de texto (la definición del rappel o de los otros gastos) */
  text?: boolean;
}

export interface LedgerGroup {
  key: string;
  label: string;
  columns: LedgerColumn[];
}

/** Ingresos. Efectivo cuenta en el resumen de efectivo; banco, plataforma y rappel, en el de banco. */
export const INCOME_COLUMNS: LedgerColumn[] = [
  { key: 'efectivo', label: 'Efectivo', method: 'cash' },
  { key: 'banco', label: 'Banco', method: 'bank' },
  { key: 'plataforma', label: 'Plataforma', method: 'bank' },
  { key: 'rappel', label: 'Rappel', method: 'bank' },
  { key: 'rappel_def', label: 'Definición', text: true },
];

const cash = (key: string, label: string): LedgerColumn => ({ key, label, method: 'cash' });
const bank = (key: string, label: string): LedgerColumn => ({ key, label, method: 'bank' });

/** Gastos, por grupos como en el Excel. El personal, los RRPP y los gastos extra se pagan en efectivo. */
export const EXPENSE_GROUPS: LedgerGroup[] = [
  { key: 'personal', label: 'Personal', columns: [cash('porteros', 'Porteros'), cash('limpieza', 'Limpieza'), cash('encargado', 'Encargado'), cash('camareros', 'Camareros')] },
  {
    key: 'servicios',
    label: 'Servicios',
    columns: [cash('rrpp', 'RRPP'), bank('marketing', 'Marketing'), bank('administracion', 'Administración'), bank('numier', 'Numier'), bank('gestoria', 'Gestoría')],
  },
  { key: 'suministros', label: 'Suministros', columns: [bank('butasol', 'Butasol'), bank('luz', 'Luz'), bank('telefonia', 'Telefonía'), bank('agua', 'Agua')] },
  { key: 'reparaciones', label: 'Reparaciones', columns: [bank('fco_gonzalez', 'Fco. González'), bank('tec_luz', 'Tec. luz')] },
  {
    key: 'mercaderias',
    label: 'Mercaderías',
    columns: [
      bank('cocacola', 'Cocacola'),
      bank('nosvemos', 'Nosvemosenlosbares'),
      bank('hielo', 'Hielo'),
      bank('montanera', 'Montanera'),
      bank('dundalk', 'Dundalk'),
      bank('albariza', 'Albariza'),
      bank('vinafiel', 'Viñafiel'),
      bank('merino', 'Distri. Merino'),
    ],
  },
  { key: 'consumibles', label: 'Consumibles', columns: [bank('dla', 'DLA')] },
  {
    key: 'arrendamientos',
    label: 'Arrendamientos',
    columns: [bank('alq_anterior', 'Alq. anterior'), bank('alquiler', 'Alquiler'), bank('comunidad', 'Comunidad'), bank('sonidos', 'Sonidos')],
  },
  { key: 'aeat', label: 'AEAT / TGSS', columns: [bank('seguros_sociales', 'Seguros sociales'), bank('impuestos', 'Impuestos')] },
  { key: 'otros', label: 'Otros servicios', columns: [cash('gastos_extra', 'Gastos extra'), { key: 'otros_def', label: 'Definición', text: true }] },
];

const EXPENSE_COLUMNS = EXPENSE_GROUPS.flatMap((g) => g.columns).filter((c) => !c.text);
const INCOME_AMOUNTS = INCOME_COLUMNS.filter((c) => !c.text);

/** Importe de una casilla (0 si está vacía o es texto) */
export const cellAmount = (day: AdminLedgerDay | undefined, key: string) => {
  const v = day?.data?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

const sum = (days: (AdminLedgerDay | undefined)[], cols: LedgerColumn[]) =>
  days.reduce((n, d) => n + cols.reduce((m, c) => m + cellAmount(d, c.key), 0), 0);

export const dayIncome = (d: AdminLedgerDay | undefined) => sum([d], INCOME_AMOUNTS);

export interface LedgerWeek {
  /** Lunes de la semana */
  start: string;
  dates: string[];
  income: number;
  expenses: number;
  /** Ingresos - gastos */
  result: number;
  cashIn: number;
  cashOut: number;
  /** Efectivo de la semana (ingreso - gasto) */
  cashNet: number;
  /** Arrastre de efectivo al acabar la semana */
  cashCarry: number;
  bankIn: number;
  bankOut: number;
  bankNet: number;
  bankCarry: number;
}

export interface LedgerSheet {
  weeks: LedgerWeek[];
  /** Totales del mes por columna */
  columnTotal: (key: string) => number;
  groupTotal: (group: LedgerGroup) => number;
  income: number;
  expenses: number;
  result: number;
  cashIn: number;
  cashOut: number;
  cashNet: number;
  bankIn: number;
  bankOut: number;
  bankNet: number;
  /** Arrastre al final del mes (antes del ajuste) */
  cashCarry: number;
  bankCarry: number;
  /** Lo que queda después del ajuste */
  cashFinal: number;
  bankFinal: number;
}

/**
 * Noches del mes: de miércoles a sábado (como el Excel), las noches de la app y los días que ya
 * tienen algo apuntado, en orden.
 */
export function ledgerDates(from: string, to: string, extra: string[]) {
  const set = new Set(extra.filter((d) => d >= from && d < to));
  for (let d = parseDate(from); isoDate(d) < to; d = addDays(d, 1)) {
    const wd = d.getDay();
    if (wd >= 3 && wd <= 6) set.add(isoDate(d));
  }
  return [...set].sort();
}

export function computeLedger(dates: string[], byDate: Map<string, AdminLedgerDay>, month: AdminLedgerMonth | null): LedgerSheet {
  const weeks: LedgerWeek[] = [];
  let cashCarry = month?.cash_carry ?? 0;
  let bankCarry = month?.bank_carry ?? 0;
  for (const date of dates) {
    const start = isoDate(startOfWeek(parseDate(date)));
    let w = weeks[weeks.length - 1];
    if (!w || w.start !== start) {
      w = { start, dates: [], income: 0, expenses: 0, result: 0, cashIn: 0, cashOut: 0, cashNet: 0, cashCarry: 0, bankIn: 0, bankOut: 0, bankNet: 0, bankCarry: 0 };
      weeks.push(w);
    }
    w.dates.push(date);
  }
  for (const w of weeks) {
    const days = w.dates.map((d) => byDate.get(d));
    w.income = sum(days, INCOME_AMOUNTS);
    w.expenses = sum(days, EXPENSE_COLUMNS);
    w.result = w.income - w.expenses;
    w.cashIn = sum(days, INCOME_AMOUNTS.filter((c) => c.method === 'cash'));
    w.cashOut = sum(days, EXPENSE_COLUMNS.filter((c) => c.method === 'cash'));
    w.cashNet = w.cashIn - w.cashOut;
    w.bankIn = sum(days, INCOME_AMOUNTS.filter((c) => c.method === 'bank'));
    w.bankOut = sum(days, EXPENSE_COLUMNS.filter((c) => c.method === 'bank'));
    w.bankNet = w.bankIn - w.bankOut;
    cashCarry += w.cashNet;
    bankCarry += w.bankNet;
    w.cashCarry = cashCarry;
    w.bankCarry = bankCarry;
  }
  const all = dates.map((d) => byDate.get(d));
  const total = (k: keyof LedgerWeek) => weeks.reduce((n, w) => n + (w[k] as number), 0);
  return {
    weeks,
    columnTotal: (key) => all.reduce((n, d) => n + cellAmount(d, key), 0),
    groupTotal: (g) => sum(all, g.columns.filter((c) => !c.text)),
    income: total('income'),
    expenses: total('expenses'),
    result: total('result'),
    cashIn: total('cashIn'),
    cashOut: total('cashOut'),
    cashNet: total('cashNet'),
    bankIn: total('bankIn'),
    bankOut: total('bankOut'),
    bankNet: total('bankNet'),
    cashCarry,
    bankCarry,
    cashFinal: cashCarry + (month?.cash_adjust ?? 0),
    bankFinal: bankCarry + (month?.bank_adjust ?? 0),
  };
}

/** "1.234,56" o "1234.56" → 1234.56 (vacío → null) */
export function parseLedgerAmount(text: string): number | null {
  let t = text.replace(/[€\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// 'always': también con el punto de los miles en 1.234,56 (en español, por defecto sólo desde 10.000)
const num = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' as unknown as boolean });
/** Importe como en la hoja: "1.234,56" (vacío si no hay) */
export const fmtAmount = (n: number | null | undefined) => (n ? num.format(n) : '');
/** Como fmtAmount, pero con 0 */
export const fmtTotal = (n: number) => num.format(n);
/** Porcentaje sobre los ingresos ("—" si no hay ingresos, donde el Excel daba #DIV/0!) */
export const fmtShare = (part: number, whole: number) => (whole ? `${(Math.round((part / whole) * 1000) / 10).toLocaleString('es-ES')} %` : '—');

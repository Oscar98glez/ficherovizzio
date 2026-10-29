/**
 * Hoja de caja de Administración, como el Excel "MODELO" de los administrativos:
 * · Cada noche se apunta lo que entró (efectivo, banco, plataforma y rappel).
 * · Los pagos (sueldos, RRPP, proveedores...) se apuntan sueltos, normalmente una vez por semana,
 *   cada uno con su columna y con cómo se pagó (en efectivo o por el banco).
 * · Las semanas van de lunes a domingo y cuentan para el mes en el que cae su jueves (en el Excel
 *   la hoja de octubre empieza el miércoles 30 de septiembre y acaba el domingo 1 de noviembre).
 * · Lo que queda en efectivo y en el banco al acabar un mes pasa al siguiente.
 */
import { addDays, addMonths, capitalize, isoDate, parseDate, startOfWeek } from './dates';
import type { AdminLedgerDay, AdminLedgerExpense, AdminLedgerMonth, LedgerMethod } from './types';

export type { LedgerMethod };

export interface LedgerColumn {
  key: string;
  /** Como en el Excel */
  label: string;
  /** Ingresos: dónde cuenta. Gastos: cómo se paga normalmente (se propone al apuntarlo). */
  method?: LedgerMethod;
  /** Columna de texto (el concepto del rappel) */
  text?: boolean;
}

export interface LedgerGroup {
  key: string;
  /** Como en el Excel */
  label: string;
  /** Nombre para la pantalla, en palabras de todos los días */
  title: string;
  /** Qué entra en el grupo */
  hint: string;
  columns: LedgerColumn[];
}

/** Ingresos. Efectivo cuenta en el efectivo; banco, plataforma y rappel, en el banco. */
export const INCOME_COLUMNS: LedgerColumn[] = [
  { key: 'efectivo', label: 'Efectivo', method: 'cash' },
  { key: 'banco', label: 'Banco', method: 'bank' },
  { key: 'plataforma', label: 'Plataforma', method: 'bank' },
  { key: 'rappel', label: 'Rappel', method: 'bank' },
  { key: 'rappel_def', label: 'Definición', text: true },
];
const INCOME_AMOUNTS = INCOME_COLUMNS.filter((c) => !c.text);

const cash = (key: string, label: string): LedgerColumn => ({ key, label, method: 'cash' });
const bank = (key: string, label: string): LedgerColumn => ({ key, label, method: 'bank' });

/** Gastos, por grupos como en el Excel */
export const EXPENSE_GROUPS: LedgerGroup[] = [
  {
    key: 'personal',
    label: 'Personal',
    title: 'Personal',
    hint: 'Porteros, limpieza, encargado, camareros',
    columns: [cash('porteros', 'Porteros'), cash('limpieza', 'Limpieza'), cash('encargado', 'Encargado'), cash('camareros', 'Camareros')],
  },
  {
    key: 'servicios',
    label: 'Servicios',
    title: 'Servicios',
    hint: 'RRPP, marketing, gestoría',
    columns: [cash('rrpp', 'RRPP'), bank('marketing', 'Marketing'), bank('administracion', 'Administración'), bank('numier', 'Numier'), bank('gestoria', 'Gestoría')],
  },
  {
    key: 'mercaderias',
    label: 'Mercaderías',
    title: 'Proveedores',
    hint: 'Bebida, hielo y distribuidores',
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
  { key: 'suministros', label: 'Suministros', title: 'Luz, agua y teléfono', hint: 'Butasol, luz, telefonía, agua', columns: [bank('butasol', 'Butasol'), bank('luz', 'Luz'), bank('telefonia', 'Telefonía'), bank('agua', 'Agua')] },
  { key: 'arrendamientos', label: 'Arrendamientos', title: 'Alquiler', hint: 'Alquiler, comunidad, sonido', columns: [bank('alq_anterior', 'Alq. anterior'), bank('alquiler', 'Alquiler'), bank('comunidad', 'Comunidad'), bank('sonidos', 'Sonidos')] },
  { key: 'aeat', label: 'AEAT / TGSS', title: 'Impuestos', hint: 'Hacienda y Seguridad Social', columns: [bank('seguros_sociales', 'Seguros sociales'), bank('impuestos', 'Impuestos')] },
  { key: 'reparaciones', label: 'Reparaciones', title: 'Reparaciones', hint: 'Arreglos del local', columns: [bank('fco_gonzalez', 'Fco. González'), bank('tec_luz', 'Tec. luz')] },
  { key: 'consumibles', label: 'Consumibles', title: 'Consumibles', hint: 'DLA', columns: [bank('dla', 'DLA')] },
  { key: 'otros', label: 'Otros servicios', title: 'Otros gastos', hint: 'Lo que no encaje en lo demás', columns: [cash('gastos_extra', 'Gasto extra')] },
];

/** Grupos en el orden del Excel (para la descarga) */
export const EXCEL_GROUP_ORDER = ['personal', 'servicios', 'suministros', 'reparaciones', 'mercaderias', 'consumibles', 'arrendamientos', 'aeat', 'otros'];

const CONCEPTS = new Map(EXPENSE_GROUPS.flatMap((g) => g.columns.map((c) => [c.key, { group: g, column: c }] as const)));
const OTHER = EXPENSE_GROUPS.find((g) => g.key === 'otros')!;

/** Grupo y columna de un pago (los conceptos desconocidos cuentan como otros gastos) */
export function conceptInfo(concept: string) {
  return CONCEPTS.get(concept) ?? { group: OTHER, column: { key: concept, label: concept } as LedgerColumn };
}

// ---------- Importes ----------

/** Importe de una casilla de ingresos (0 si está vacía o es texto) */
export const cellAmount = (day: AdminLedgerDay | undefined, key: string) => {
  const v = day?.data?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/** Lo que entró una noche */
export const dayIncome = (d: AdminLedgerDay | undefined) => INCOME_AMOUNTS.reduce((n, c) => n + cellAmount(d, c.key), 0);

/** La noche tiene algo apuntado */
export const dayHasData = (d: AdminLedgerDay | undefined) => !!d && Object.keys(d.data ?? {}).length > 0;

export interface LedgerTotals {
  income: number;
  expenses: number;
  /** Ingresos - gastos */
  result: number;
  cashIn: number;
  cashOut: number;
  bankIn: number;
  bankOut: number;
  /** Ingresos por columna (efectivo, banco, plataforma, rappel) */
  incomeBy: Record<string, number>;
  /** Gastos de cada grupo, por su key */
  groups: Record<string, number>;
  /** Gastos de cada columna, por su key */
  concepts: Record<string, number>;
}

export function computeTotals(days: AdminLedgerDay[], expenses: AdminLedgerExpense[]): LedgerTotals {
  const t: LedgerTotals = {
    income: 0,
    expenses: 0,
    result: 0,
    cashIn: 0,
    cashOut: 0,
    bankIn: 0,
    bankOut: 0,
    incomeBy: Object.fromEntries(INCOME_AMOUNTS.map((c) => [c.key, 0])),
    groups: Object.fromEntries(EXPENSE_GROUPS.map((g) => [g.key, 0])),
    concepts: {},
  };
  for (const d of days) {
    for (const c of INCOME_AMOUNTS) {
      const n = cellAmount(d, c.key);
      t.incomeBy[c.key] += n;
      t.income += n;
      if (c.method === 'cash') t.cashIn += n;
      else t.bankIn += n;
    }
  }
  for (const e of expenses) {
    const n = Number(e.amount) || 0;
    t.expenses += n;
    if (e.method === 'cash') t.cashOut += n;
    else t.bankOut += n;
    t.groups[conceptInfo(e.concept).group.key] += n;
    t.concepts[e.concept] = (t.concepts[e.concept] ?? 0) + n;
  }
  t.result = t.income - t.expenses;
  return t;
}

// ---------- Semanas y meses ----------

/** Día 1 del mes (YYYY-MM-01) */
export const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/** Lunes de la semana de un día */
export const weekStartOf = (date: string) => isoDate(startOfWeek(parseDate(date)));

/** Mes (YYYY-MM-01) al que cuenta un día: el del jueves de su semana */
export const ledgerMonthOf = (date: string) => monthOf(isoDate(addDays(startOfWeek(parseDate(date)), 3)));

export interface LedgerWeekDef {
  /** 1, 2, 3... dentro del mes */
  n: number;
  /** Lunes */
  start: string;
  /** Lunes siguiente (exclusivo) */
  end: string;
  /** Todos los días de la semana, de lunes a domingo */
  dates: string[];
  /** Las noches que se abren normalmente: de miércoles a sábado */
  nights: string[];
}

/** Semanas que cuentan para un mes (YYYY-MM-01) */
export function monthWeeks(month: string): LedgerWeekDef[] {
  const out: LedgerWeekDef[] = [];
  let monday = startOfWeek(parseDate(month));
  if (ledgerMonthOf(isoDate(monday)) < month) monday = addDays(monday, 7);
  while (ledgerMonthOf(isoDate(monday)) === month) {
    const dates = Array.from({ length: 7 }, (_, i) => isoDate(addDays(monday, i)));
    out.push({ n: out.length + 1, start: dates[0], end: isoDate(addDays(monday, 7)), dates, nights: dates.slice(2, 6) });
    monday = addDays(monday, 7);
  }
  return out;
}

/** Días que abarcan las semanas de un mes: desde el lunes de la primera hasta el lunes después de la última */
export function monthSpan(month: string) {
  const weeks = monthWeeks(month);
  return { from: weeks[0].start, to: weeks[weeks.length - 1].end };
}

/** Días que abarcan las semanas de un año */
export function yearSpan(year: number) {
  return { from: monthSpan(`${year}-01-01`).from, to: monthSpan(`${year}-12-01`).to };
}

export const inRange = (date: string, from: string, to: string) => date >= from && date < to;

/** Mes anterior o siguiente (YYYY-MM-01) */
export const shiftMonth = (month: string, n: number) => isoDate(addMonths(parseDate(month), n));

/** "octubre", "Octubre de 2026"... */
export const monthName = (month: string) => parseDate(month).toLocaleDateString('es-ES', { month: 'long' });
export const monthTitle = (month: string) => capitalize(monthName(month));

/** "28 oct – 1 nov", "7 – 11 oct" */
export function rangeLabel(from: string, to: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  const short = (d: Date) => d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${short(b)}` : `${a.getDate()} ${short(a)} – ${b.getDate()} ${short(b)}`;
}

/** Días de una semana que se ven: de miércoles a sábado, y los otros días que tengan algo apuntado */
export function weekNights(week: LedgerWeekDef, hasData: (date: string) => boolean, extra: string[] = []) {
  return week.dates.filter((d) => week.nights.includes(d) || hasData(d) || extra.includes(d));
}

// ---------- Arrastres de efectivo y banco ----------

export interface LedgerMonthCash {
  month: string;
  /** Lo que viene del mes anterior */
  cashStart: number;
  bankStart: number;
  /** Si viene apuntado a mano (si no, es lo que quedó el mes anterior) */
  cashStartManual: boolean;
  bankStartManual: boolean;
  totals: LedgerTotals;
  cashAdjust: number;
  bankAdjust: number;
  /** Lo que queda al acabar el mes (con el ajuste) */
  cashEnd: number;
  bankEnd: number;
}

/**
 * Efectivo y banco de cada mes, desde el primer mes con algo apuntado hasta `until` (incluido):
 * cada mes empieza con lo que quedó el anterior, salvo que se haya apuntado otra cosa.
 */
export function cashByMonth(until: string, months: AdminLedgerMonth[], days: AdminLedgerDay[], expenses: AdminLedgerExpense[]) {
  const rows = new Map(months.map((m) => [m.month, m]));
  const daysBy = new Map<string, AdminLedgerDay[]>();
  const expBy = new Map<string, AdminLedgerExpense[]>();
  for (const d of days) {
    const m = ledgerMonthOf(d.date);
    daysBy.set(m, [...(daysBy.get(m) ?? []), d]);
  }
  for (const e of expenses) {
    const m = ledgerMonthOf(e.date);
    expBy.set(m, [...(expBy.get(m) ?? []), e]);
  }
  const known = [...rows.keys(), ...daysBy.keys(), ...expBy.keys()].filter((m) => m <= until).sort();
  const out = new Map<string, LedgerMonthCash>();
  let cashPrev = 0;
  let bankPrev = 0;
  for (let m = known[0] ?? until; m <= until; m = shiftMonth(m, 1)) {
    const row = rows.get(m);
    const totals = computeTotals(daysBy.get(m) ?? [], expBy.get(m) ?? []);
    const cashStart = row?.cash_carry ?? cashPrev;
    const bankStart = row?.bank_carry ?? bankPrev;
    const cashAdjust = row?.cash_adjust ?? 0;
    const bankAdjust = row?.bank_adjust ?? 0;
    const entry: LedgerMonthCash = {
      month: m,
      cashStart,
      bankStart,
      cashStartManual: row?.cash_carry != null,
      bankStartManual: row?.bank_carry != null,
      totals,
      cashAdjust,
      bankAdjust,
      cashEnd: cashStart + totals.cashIn - totals.cashOut + cashAdjust,
      bankEnd: bankStart + totals.bankIn - totals.bankOut + bankAdjust,
    };
    out.set(m, entry);
    cashPrev = entry.cashEnd;
    bankPrev = entry.bankEnd;
  }
  return out;
}

// ---------- Resumen del año ----------

export interface LedgerMonthTotals extends LedgerTotals {
  /** YYYY-MM-01 */
  month: string;
}

/** Totales de cada mes del año (enero a diciembre) */
export function yearTotals(year: number, days: AdminLedgerDay[], expenses: AdminLedgerExpense[]): LedgerMonthTotals[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}-01`;
    return {
      month,
      ...computeTotals(
        days.filter((d) => ledgerMonthOf(d.date) === month),
        expenses.filter((e) => ledgerMonthOf(e.date) === month),
      ),
    };
  });
}

// ---------- Formatos ----------

/** "1.234,56" o "1234.56" → 1234.56 (vacío → null) */
export function parseLedgerAmount(text: string): number | null {
  let t = text.replace(/[€\s]/g, '').replace(/[−–]/g, '-');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// 'always': también con el punto de los miles en 1.234,56 (en español, por defecto sólo desde 10.000)
const num2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' as unknown as boolean });
const num0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' as unknown as boolean });
/** Importe con céntimos: "1.234,56" (vacío si no hay) */
export const fmtAmount = (n: number | null | undefined) => (n ? num2.format(n) : '');
/** Importe redondeado con su signo: "+1.235 €", "−80 €" */
export const fmtEuros = (n: number, sign = false) => `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}${num0.format(Math.abs(Math.round(n)))} €`;
/** Importe con céntimos y €: "1.234,56 €" */
export const fmtEuros2 = (n: number) => `${n < 0 ? '−' : ''}${num2.format(Math.abs(n))} €`;
/** Porcentaje sobre un total ("—" si no hay total, donde el Excel daba #DIV/0!) */
export const fmtShare = (part: number, whole: number) => (whole ? `${(Math.round((part / whole) * 1000) / 10).toLocaleString('es-ES')} %` : '—');

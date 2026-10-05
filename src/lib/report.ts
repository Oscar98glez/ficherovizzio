import { api } from './api';
import { DEPARTMENTS, isStaffExpense, METHODS, PAYROLL_CATEGORY, STAFF_CATEGORY, TIMESHEET_CATEGORY } from './constants';
import { addDays, addMonths, businessDate, capitalize, isoDate, parseDate, periodRange, startOfMonth, startOfWeek } from './dates';
import { fmtDate } from './format';
import type { Transaction, TxKind } from './types';
import { byId, categoryRank, compareByCategory, entryCost, entryHours, fullName, groupBy, sumBy } from './utils';

export type ReportFormat = 'pdf' | 'xlsx';
export type BreakdownUnit = 'day' | 'week' | 'month';
export type ReportScope = 'semanal' | 'mensual' | 'trimestral' | 'anual' | 'personalizado';

/** Hasta este número de días el informe se considera semanal y detalla las nóminas por trabajador. */
export const PAYROLL_DETAIL_MAX_DAYS = 7;

export interface Amount {
  label: string;
  value: number;
}

export interface Movement {
  date: string;
  kind: TxKind;
  category: string;
  amount: number;
  method: string;
  night: string;
  employee: string;
  description: string;
}

export interface FinanceReport {
  /** inclusivo, YYYY-MM-DD */
  from: string;
  /** inclusivo, YYYY-MM-DD */
  to: string;
  scope: ReportScope;
  generatedAt: Date;
  totals: {
    income: number;
    /** Gastos operativos (sin nóminas ni personal) */
    expenses: number;
    /** Gastos de personal: coste de los fichajes + nóminas y personal pagados */
    staff: number;
    payroll: number;
    personal: number;
    /** Coste de los fichajes (horas × tarifa), incluido en los gastos de personal */
    accrued: number;
    result: number;
    margin: number;
    hours: number;
    nights: number;
  };
  incomeByCategory: Amount[];
  /** Ingresos de cada apartado (Taquilla, Barra 1…) separados en efectivo y tarjeta */
  incomeBreakdown: { label: string; cash: number; card: number; other: number; total: number }[];
  incomeByMethod: Amount[];
  /** Gastos operativos por concepto (sin nóminas ni personal) */
  operatingByCategory: Amount[];
  /** Gastos de personal por concepto: Fichajes, Nóminas y Personal */
  staffByCategory: Amount[];
  /** Resultado por día (semanal), por semana (mensual/trimestral) o por mes (anual), según los movimientos introducidos */
  breakdown: {
    unit: BreakdownUnit;
    rows: { label: string; from: string; to: string; night: string; income: number; expenses: number; staff: number; result: number }[];
  };
  /** Horas y coste por empleado según fichajes (incluido en los gastos de personal) */
  staff: { name: string; position: string; department: string; nights: number; hours: number; rate: number; cost: number }[];
  /** Gastos de personal pagados (nóminas y personal): con detalle por persona sólo en informes semanales. */
  staffPayments: {
    detailed: boolean;
    payroll: number;
    personal: number;
    total: number;
    workers: number;
    payments: number;
    rows: { date: string; name: string; concept: string; method: string; amount: number }[];
  };
  movements: Movement[];
}

export const reportDays = (from: string, to: string) =>
  Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000) + 1;

export function reportScope(from: string, to: string): ReportScope {
  const days = reportDays(from, to);
  if (days <= PAYROLL_DETAIL_MAX_DAYS) return 'semanal';
  if (days <= 31) return 'mensual';
  if (days <= 92) return 'trimestral';
  if (days >= 365 && days <= 366) return 'anual';
  return 'personalizado';
}

const METHOD_LABELS = ['efectivo', 'tarjeta', 'bizum', 'transferencia', 'otro'].map((m) => METHODS[m as keyof typeof METHODS]);
const methodLabelRank = (label: string) => {
  const i = METHOD_LABELS.indexOf(label);
  return i < 0 ? METHOD_LABELS.length : i;
};

/** Totales por categoría, en el orden de las listas de categorías (Taquilla, Barra 1, Barra 2…). */
function byCategory(items: Transaction[], kind: TxKind): Amount[] {
  return Object.entries(groupBy(items, (t) => t.category))
    .map(([label, xs]) => ({ label, value: sumBy(xs, (t) => t.amount) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => categoryRank(kind, a.label) - categoryRank(kind, b.label) || a.label.localeCompare(b.label, 'es'));
}

const compareMovements = (a: Movement, b: Movement) =>
  compareByCategory({ kind: a.kind, category: a.category }, { kind: b.kind, category: b.category }) ||
  a.date.localeCompare(b.date) ||
  methodLabelRank(a.method) - methodLabelRank(b.method);

const payrollMonth = (period: string | null, date: string) =>
  capitalize(fmtDate(`${period ?? date.slice(0, 7)}-01`, { month: 'long', year: 'numeric' }));

/** Reúne todos los datos del informe financiero entre dos fechas (ambas incluidas). */
export async function buildFinanceReport(from: string, to: string): Promise<FinanceReport> {
  const toExclusive = isoDate(addDays(parseDate(to), 1));
  const { start, end } = periodRange({ from, to: toExclusive });
  const detailed = reportDays(from, to) <= PAYROLL_DETAIL_MAX_DAYS;

  const [tx, entries, employees, events] = await Promise.all([
    api.transactions.list({ gte: ['date', from], lt: ['date', toExclusive], order: ['date', 'asc'] }),
    api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] }),
    api.employees.list({ order: ['first_name', 'asc'] }),
    api.events.list({ gte: ['date', from], lt: ['date', toExclusive], order: ['date', 'asc'] }),
  ]);

  const emps = byId(employees);
  const eventsById = byId(events);
  const closed = entries.filter((e) => e.clock_out);
  const income = tx.filter((t) => t.kind === 'income');
  const expenses = tx.filter((t) => t.kind === 'expense' && !isStaffExpense(t));
  const staffTx = tx.filter(isStaffExpense);
  const payroll = staffTx.filter((t) => t.category === PAYROLL_CATEGORY);
  const personal = staffTx.filter((t) => t.category === STAFF_CATEGORY);

  const totalIncome = sumBy(income, (t) => t.amount);
  const totalExpenses = sumBy(expenses, (t) => t.amount);
  const staffPaid = sumBy(staffTx, (t) => t.amount);
  // Coste de los fichajes de cada noche (cuentan en la noche de la entrada, al fichar la salida)
  const sheetDays = groupBy(closed, (e) => businessDate(e.clock_in));
  const accrued = sumBy(closed, (e) => entryCost(e));
  const staffTotal = staffPaid + accrued;
  const result = totalIncome - totalExpenses - staffTotal;

  // Resultado por fechas según los movimientos introducidos: por día (semanal), por semana (mensual) o por mes (anual)
  const unit: BreakdownUnit = detailed ? 'day' : reportDays(from, to) <= 92 ? 'week' : 'month';
  const buckets: { label: string; from: string; to: string }[] = [];
  if (unit === 'day') {
    for (const d of [...new Set([...tx.map((t) => t.date), ...Object.keys(sheetDays)])].sort()) buckets.push({ label: d, from: d, to: d });
  } else {
    const first = unit === 'week' ? startOfWeek(parseDate(from)) : startOfMonth(parseDate(from));
    for (let s = first; isoDate(s) <= to; s = unit === 'week' ? addDays(s, 7) : addMonths(s, 1)) {
      const next = unit === 'week' ? addDays(s, 7) : addMonths(s, 1);
      const bFrom = isoDate(s) < from ? from : isoDate(s);
      const bTo = isoDate(addDays(next, -1)) > to ? to : isoDate(addDays(next, -1));
      const label =
        unit === 'month'
          ? capitalize(fmtDate(bFrom, { month: 'long', year: 'numeric' }))
          : bFrom.slice(0, 7) === bTo.slice(0, 7)
            ? `${fmtDate(bFrom, { day: 'numeric' })} – ${fmtDate(bTo, { day: 'numeric', month: 'short' })}`
            : `${fmtDate(bFrom, { day: 'numeric', month: 'short' })} – ${fmtDate(bTo, { day: 'numeric', month: 'short' })}`;
      buckets.push({ label, from: bFrom, to: bTo });
    }
  }
  const breakdownRows = buckets.map((b) => {
    const t = tx.filter((x) => x.date >= b.from && x.date <= b.to);
    const inc = sumBy(t.filter((x) => x.kind === 'income'), (x) => x.amount);
    const exp = sumBy(t.filter((x) => x.kind === 'expense' && !isStaffExpense(x)), (x) => x.amount);
    const sheetsInBucket = Object.entries(sheetDays).filter(([d]) => d >= b.from && d <= b.to).flatMap(([, es]) => es);
    const staffPaidInBucket = sumBy(t.filter(isStaffExpense), (x) => x.amount) + sumBy(sheetsInBucket, (e) => entryCost(e));
    const night = unit === 'day' ? events.filter((e) => e.date === b.from).map((e) => e.name).join(', ') : '';
    return { ...b, night, income: inc, expenses: exp, staff: staffPaidInBucket, result: inc - exp - staffPaidInBucket };
  });

  const entriesByEmp = groupBy(closed, (e) => e.employee_id);
  const staff = employees
    .map((e) => {
      const es = entriesByEmp[e.id] ?? [];
      return {
        name: fullName(e),
        position: e.position,
        department: DEPARTMENTS[e.department]?.label ?? e.department,
        nights: new Set(es.map((x) => businessDate(x.clock_in))).size,
        hours: sumBy(es, (x) => entryHours(x)),
        rate: e.hourly_rate,
        cost: sumBy(es, (x) => entryCost(x)),
      };
    })
    .filter((s) => s.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  const toMovement = (t: Transaction): Movement => ({
    date: t.date,
    kind: t.kind,
    category: t.category,
    amount: t.amount,
    method: METHODS[t.method] ?? t.method,
    night: t.event_id ? eventsById.get(t.event_id)?.name ?? '' : '',
    employee: t.employee_id ? fullName(emps.get(t.employee_id)) : '',
    description: t.description ?? '',
  });

  // Coste de los fichajes de cada noche, como un movimiento más
  const sheetMovements: Movement[] = Object.entries(sheetDays).map(([date, es]) => ({
    date,
    kind: 'expense',
    category: TIMESHEET_CATEGORY,
    amount: sumBy(es, (e) => entryCost(e)),
    method: 'Fichaje',
    night: events.filter((e) => e.date === date).map((e) => e.name).join(', '),
    employee: '',
    description: `${new Set(es.map((e) => e.employee_id)).size} personas · ${Math.round(sumBy(es, (e) => entryHours(e)) * 10) / 10} h`,
  }));

  // En informes mensuales/anuales los pagos al personal se agrupan por día y sin nombres
  const movements: Movement[] = detailed
    ? [...sheetMovements, ...tx.map(toMovement)].sort(compareMovements)
    : [
        ...sheetMovements,
        ...tx.filter((t) => !isStaffExpense(t)).map(toMovement),
        ...Object.values(groupBy(staffTx, (t) => `${t.date}|${t.category}`)).map((ps) => ({
          date: ps[0].date,
          kind: 'expense' as const,
          category: ps[0].category,
          amount: sumBy(ps, (t) => t.amount),
          method: [...new Set(ps.map((t) => METHODS[t.method] ?? t.method))].join(', '),
          night: '',
          employee: '',
          description: `${ps.length} ${ps.length === 1 ? 'pago' : 'pagos'}`,
        })),
      ].sort(compareMovements);

  const staffName = (t: Transaction) => (t.employee_id ? fullName(emps.get(t.employee_id)) : t.description || 'Sin especificar');

  return {
    from,
    to,
    scope: reportScope(from, to),
    generatedAt: new Date(),
    totals: {
      income: totalIncome,
      expenses: totalExpenses,
      staff: staffTotal,
      payroll: sumBy(payroll, (t) => t.amount),
      personal: sumBy(personal, (t) => t.amount),
      accrued,
      result,
      margin: totalIncome ? result / totalIncome : 0,
      hours: sumBy(closed, (e) => entryHours(e)),
      nights: new Set(closed.map((e) => businessDate(e.clock_in))).size,
    },
    incomeByCategory: byCategory(income, 'income'),
    incomeBreakdown: byCategory(income, 'income').map(({ label, value }) => {
      const xs = income.filter((t) => t.category === label);
      const cash = sumBy(xs.filter((t) => t.method === 'efectivo'), (t) => t.amount);
      const card = sumBy(xs.filter((t) => t.method === 'tarjeta'), (t) => t.amount);
      return { label, cash, card, other: value - cash - card, total: value };
    }),
    incomeByMethod: Object.entries(groupBy(income, (t) => METHODS[t.method] ?? t.method))
      .map(([label, xs]) => ({ label, value: sumBy(xs, (t) => t.amount) }))
      .sort((a, b) => methodLabelRank(a.label) - methodLabelRank(b.label)),
    operatingByCategory: byCategory(expenses, 'expense'),
    staffByCategory: [{ label: TIMESHEET_CATEGORY, value: accrued }, ...byCategory(staffTx, 'expense')].filter((x) => x.value > 0),
    breakdown: { unit, rows: breakdownRows },
    staff,
    staffPayments: {
      detailed,
      payroll: sumBy(payroll, (t) => t.amount),
      personal: sumBy(personal, (t) => t.amount),
      total: staffPaid,
      workers: new Set(staffTx.filter((t) => t.employee_id).map((t) => t.employee_id)).size,
      payments: staffTx.length,
      rows: detailed
        ? staffTx
            .map((t) => ({
              date: t.date,
              name: staffName(t),
              concept: t.category === PAYROLL_CATEGORY ? `Nómina de ${payrollMonth(t.period, t.date).toLowerCase()}` : STAFF_CATEGORY,
              method: METHODS[t.method] ?? t.method,
              amount: t.amount,
            }))
            .sort((a, b) => a.date.localeCompare(b.date) || a.concept.localeCompare(b.concept, 'es') || a.name.localeCompare(b.name, 'es'))
        : [],
    },
    movements,
  };
}

const longDate = (d: string) => fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' });

export function periodLabel(r: Pick<FinanceReport, 'from' | 'to'>) {
  return r.from === r.to ? longDate(r.from) : `${longDate(r.from)} – ${longDate(r.to)}`;
}

export function reportTitle(r: Pick<FinanceReport, 'scope'>) {
  return r.scope === 'personalizado' ? 'Informe financiero' : `Informe financiero ${r.scope}`;
}

export function reportFileName(r: Pick<FinanceReport, 'from' | 'to'>, format: ReportFormat) {
  return `informe-finanzas_${r.from}_${r.to}.${format}`;
}

/** Genera y descarga el informe. Las librerías de PDF/Excel se cargan sólo al exportar. */
export async function exportFinanceReport(from: string, to: string, format: ReportFormat) {
  const report = await buildFinanceReport(from, to);
  if (format === 'pdf') {
    const { renderReportPdf } = await import('./report-pdf');
    await renderReportPdf(report);
  } else {
    const { renderReportXlsx } = await import('./report-xlsx');
    await renderReportXlsx(report);
  }
  return report;
}

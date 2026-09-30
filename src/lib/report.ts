import { api } from './api';
import { DEPARTMENTS, isStaffExpense, METHODS, PAYROLL_CATEGORY, WAITERS_CATEGORY } from './constants';
import { addDays, businessDate, capitalize, isoDate, parseDate, periodRange } from './dates';
import { fmtDate } from './format';
import type { Transaction, TxKind } from './types';
import { byId, categoryRank, compareByCategory, entryCost, entryHours, fullName, groupBy, sumBy } from './utils';

export type ReportFormat = 'pdf' | 'xlsx';
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
    /** Gastos operativos (sin nóminas ni camareros) */
    expenses: number;
    /** Gastos de personal: nóminas + camareros pagados */
    staff: number;
    payroll: number;
    waiters: number;
    /** Coste según fichajes (horas × tarifa). Informativo: no se resta del resultado. */
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
  expenseByCategory: Amount[];
  nights: { date: string; name: string; income: number; expenses: number; staff: number; result: number }[];
  /** Horas y coste por empleado según fichajes (informativo) */
  staff: { name: string; position: string; department: string; nights: number; hours: number; rate: number; cost: number }[];
  /** Gastos de personal pagados (nóminas y camareros): con detalle por persona sólo en informes semanales. */
  staffPayments: {
    detailed: boolean;
    payroll: number;
    waiters: number;
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
  const waiters = staffTx.filter((t) => t.category === WAITERS_CATEGORY);

  const totalIncome = sumBy(income, (t) => t.amount);
  const totalExpenses = sumBy(expenses, (t) => t.amount);
  const staffPaid = sumBy(staffTx, (t) => t.amount);
  const result = totalIncome - totalExpenses - staffPaid;

  // Por noche: gastos asociados a la noche + coste de su personal (fichajes y camareros de esa noche)
  const txByEvent = groupBy(tx.filter((t) => t.event_id), (t) => t.event_id!);
  const entriesByNight = groupBy(closed, (e) => businessDate(e.clock_in));
  const nights = events.map((ev) => {
    const t = txByEvent[ev.id] ?? [];
    const inc = sumBy(t.filter((x) => x.kind === 'income'), (x) => x.amount);
    const exp = sumBy(t.filter((x) => x.kind === 'expense' && !isStaffExpense(x)), (x) => x.amount);
    const staff = sumBy(entriesByNight[ev.date] ?? [], (e) => entryCost(e)) + sumBy(t.filter(isStaffExpense), (x) => x.amount);
    return { date: ev.date, name: ev.name, income: inc, expenses: exp, staff, result: inc - exp - staff };
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

  // En informes mensuales/anuales los pagos al personal se agrupan por día y sin nombres
  const movements: Movement[] = detailed
    ? tx.map(toMovement).sort(compareMovements)
    : [
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
      staff: staffPaid,
      payroll: sumBy(payroll, (t) => t.amount),
      waiters: sumBy(waiters, (t) => t.amount),
      accrued: sumBy(closed, (e) => entryCost(e)),
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
    expenseByCategory: byCategory([...expenses, ...staffTx], 'expense'),
    nights,
    staff,
    staffPayments: {
      detailed,
      payroll: sumBy(payroll, (t) => t.amount),
      waiters: sumBy(waiters, (t) => t.amount),
      total: staffPaid,
      workers: new Set(staffTx.filter((t) => t.employee_id).map((t) => t.employee_id)).size,
      payments: staffTx.length,
      rows: detailed
        ? staffTx
            .map((t) => ({
              date: t.date,
              name: staffName(t),
              concept: t.category === PAYROLL_CATEGORY ? `Nómina de ${payrollMonth(t.period, t.date).toLowerCase()}` : WAITERS_CATEGORY,
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

import { api } from './api';
import { DEPARTMENTS, METHODS, PAYROLL_CATEGORY } from './constants';
import { addDays, businessDate, isoDate, parseDate, periodRange } from './dates';
import type { TxKind } from './types';
import { fmtDate } from './format';
import { byId, entryCost, entryHours, fullName, groupBy, sumBy } from './utils';

export type ReportFormat = 'pdf' | 'xlsx';

export interface Amount {
  label: string;
  value: number;
}

export interface FinanceReport {
  /** inclusivo, YYYY-MM-DD */
  from: string;
  /** inclusivo, YYYY-MM-DD */
  to: string;
  generatedAt: Date;
  totals: {
    income: number;
    expenses: number;
    staff: number;
    result: number;
    margin: number;
    payrollPaid: number;
    hours: number;
    nights: number;
  };
  incomeByCategory: Amount[];
  incomeByMethod: Amount[];
  expenseByCategory: Amount[];
  nights: { date: string; name: string; income: number; expenses: number; staff: number; result: number }[];
  staff: { name: string; position: string; department: string; nights: number; hours: number; rate: number; cost: number; paid: number }[];
  movements: { date: string; kind: TxKind; category: string; amount: number; method: string; night: string; employee: string; description: string }[];
}

const byValue = (xs: Amount[]) => xs.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);

function totalsBy<T>(items: T[], key: (t: T) => string, value: (t: T) => number): Amount[] {
  return byValue(Object.entries(groupBy(items, key)).map(([label, xs]) => ({ label, value: sumBy(xs, value) })));
}

/** Reúne todos los datos del informe financiero entre dos fechas (ambas incluidas). */
export async function buildFinanceReport(from: string, to: string): Promise<FinanceReport> {
  const toExclusive = isoDate(addDays(parseDate(to), 1));
  const { start, end } = periodRange({ from, to: toExclusive });

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
  const expenses = tx.filter((t) => t.kind === 'expense' && t.category !== PAYROLL_CATEGORY);
  const payroll = tx.filter((t) => t.kind === 'expense' && t.category === PAYROLL_CATEGORY);

  const totalIncome = sumBy(income, (t) => t.amount);
  const totalExpenses = sumBy(expenses, (t) => t.amount);
  const staffCost = sumBy(closed, (e) => entryCost(e));
  const result = totalIncome - totalExpenses - staffCost;

  const txByEvent = groupBy(tx.filter((t) => t.event_id), (t) => t.event_id!);
  const entriesByNight = groupBy(closed, (e) => businessDate(e.clock_in));
  const nights = events.map((ev) => {
    const t = txByEvent[ev.id] ?? [];
    const inc = sumBy(t.filter((x) => x.kind === 'income'), (x) => x.amount);
    const exp = sumBy(t.filter((x) => x.kind === 'expense' && x.category !== PAYROLL_CATEGORY), (x) => x.amount);
    const staff = sumBy(entriesByNight[ev.date] ?? [], (e) => entryCost(e));
    return { date: ev.date, name: ev.name, income: inc, expenses: exp, staff, result: inc - exp - staff };
  });

  const entriesByEmp = groupBy(closed, (e) => e.employee_id);
  const paidByEmp = groupBy(payroll.filter((t) => t.employee_id), (t) => t.employee_id!);
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
        paid: sumBy(paidByEmp[e.id] ?? [], (t) => t.amount),
      };
    })
    .filter((s) => s.cost > 0 || s.paid > 0)
    .sort((a, b) => b.cost - a.cost);

  return {
    from,
    to,
    generatedAt: new Date(),
    totals: {
      income: totalIncome,
      expenses: totalExpenses,
      staff: staffCost,
      result,
      margin: totalIncome ? result / totalIncome : 0,
      payrollPaid: sumBy(payroll, (t) => t.amount),
      hours: sumBy(closed, (e) => entryHours(e)),
      nights: new Set(closed.map((e) => businessDate(e.clock_in))).size,
    },
    incomeByCategory: totalsBy(income, (t) => t.category, (t) => t.amount),
    incomeByMethod: totalsBy(income, (t) => METHODS[t.method] ?? t.method, (t) => t.amount),
    expenseByCategory: byValue([...totalsBy(expenses, (t) => t.category, (t) => t.amount), { label: 'Personal (según fichajes)', value: staffCost }]),
    nights,
    staff,
    movements: tx.map((t) => ({
      date: t.date,
      kind: t.kind,
      category: t.category,
      amount: t.amount,
      method: METHODS[t.method] ?? t.method,
      night: t.event_id ? eventsById.get(t.event_id)?.name ?? '' : '',
      employee: t.employee_id ? fullName(emps.get(t.employee_id)) : '',
      description: t.description ?? '',
    })),
  };
}

const longDate = (d: string) => fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' });

export function periodLabel(r: Pick<FinanceReport, 'from' | 'to'>) {
  return r.from === r.to ? longDate(r.from) : `${longDate(r.from)} – ${longDate(r.to)}`;
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

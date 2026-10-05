import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Clock, Download, FileDown, Plus, Wallet } from 'lucide-react';
import { BarChart, HBarList } from '../../components/charts';
import { CloseoutForm, TransactionForm } from '../../components/finance-forms';
import { PeriodPicker } from '../../components/PeriodPicker';
import { ReportDialog } from '../../components/ReportDialog';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, SearchInput, Segmented, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { isStaffExpense, METHODS, TIMESHEET_CATEGORY } from '../../lib/constants';
import { addDays, addMonths, businessDate, daysBetween, isoDate, makePeriod, parseDate, periodRange, startOfWeek } from '../../lib/dates';
import { fmtDate, fmtDateLong, fmtHours, fmtMoney, fmtPercent, fmtWeekday } from '../../lib/format';
import type { TimeEntry, Transaction } from '../../lib/types';
import { byId, categoryRank, compareByCategory, cx, downloadCSV, entryCost, entryHours, fullName, groupBy, sumBy } from '../../lib/utils';

type KindFilter = 'all' | 'income' | 'expense';

/** Coste de los fichajes de una noche (cuentan en la noche de la entrada, al fichar la salida) */
interface TimesheetDay {
  date: string;
  cost: number;
  hours: number;
  people: number;
}

function timesheetByDay(entries: TimeEntry[]): Record<string, TimesheetDay> {
  const out: Record<string, TimesheetDay> = {};
  for (const [date, es] of Object.entries(groupBy(entries.filter((e) => e.clock_out), (e) => businessDate(e.clock_in))))
    out[date] = { date, cost: sumBy(es, (e) => entryCost(e)), hours: sumBy(es, (e) => entryHours(e)), people: new Set(es.map((e) => e.employee_id)).size };
  return out;
}

export default function Finance() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const [kind, setKind] = useState<KindFilter>('all');
  const [q, setQ] = useState('');
  const [txModal, setTxModal] = useState<{ tx: Transaction | null; kind?: 'income' | 'expense' } | null>(null);
  const [closeout, setCloseout] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [tx, entries, employees, events] = await Promise.all([
      api.transactions.list({ gte: ['date', period.from], lt: ['date', period.to], order: ['date', 'desc'] }),
      api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] }),
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.events.list({ gte: ['date', isoDate(addDays(parseDate(period.from), -14))], lt: ['date', isoDate(addDays(parseDate(period.to), 14))], order: ['date', 'asc'] }),
    ]);
    return { tx, entries, employees, events };
  }, [period]);

  const s = useMemo(() => {
    if (!data) return null;
    const inc = data.tx.filter((t) => t.kind === 'income');
    // Gastos operativos por un lado y gastos de personal (nóminas + personal) por otro
    const exp = data.tx.filter((t) => t.kind === 'expense' && !isStaffExpense(t));
    const staffTx = data.tx.filter(isStaffExpense);
    // Coste de los fichajes de cada noche: se suma a los gastos de personal junto con nóminas y personal
    const sheets = Object.values(timesheetByDay(data.entries));
    const timesheets = sumBy(sheets, (d) => d.cost);
    const income = sumBy(inc, (t) => t.amount);
    const expenses = sumBy(exp, (t) => t.amount);
    const paid = sumBy(staffTx, (t) => t.amount);
    const staff = paid + timesheets;
    const result = income - expenses - staff;

    // Desglose en el orden de las categorías (Taquilla, Barra 1, Barra 2…)
    const cat = (ts: Transaction[], kind: Transaction['kind']) =>
      Object.entries(groupBy(ts, (t) => t.category))
        .map(([label, xs]) => ({ label, value: sumBy(xs, (t) => t.amount) }))
        .sort((a, b) => categoryRank(kind, a.label) - categoryRank(kind, b.label) || a.label.localeCompare(b.label, 'es'));

    // Serie temporal: por día (semana), por semana (mes) o por mes (año)
    let buckets: { label: string; detail: string; from: string; to: string }[] = [];
    if (period.unit === 'week') {
      buckets = daysBetween(period.from, period.to).map((d) => ({ label: fmtWeekday(d), detail: fmtDateLong(d), from: d, to: isoDate(addDays(parseDate(d), 1)) }));
    } else if (period.unit === 'month') {
      for (let w = startOfWeek(parseDate(period.from)); isoDate(w) < period.to; w = addDays(w, 7)) {
        const from = [isoDate(w), period.from].sort()[1];
        const to = [isoDate(addDays(w, 7)), period.to].sort()[0];
        buckets.push({ label: fmtDate(from, { day: 'numeric', month: 'numeric' }), detail: `Semana del ${fmtDate(from)}`, from, to });
      }
    } else {
      for (let m = parseDate(period.from); isoDate(m) < period.to; m = addMonths(m, 1))
        buckets.push({ label: fmtDate(m, { month: 'short' }).replace('.', ''), detail: fmtDate(m, { month: 'long' }), from: isoDate(m), to: isoDate(addMonths(m, 1)) });
    }
    const series = buckets.map((b) => {
      const inRange = (d: string) => d >= b.from && d < b.to;
      return {
        label: b.label,
        detail: b.detail,
        values: [
          sumBy(inc.filter((t) => inRange(t.date)), (t) => t.amount),
          sumBy([...exp, ...staffTx].filter((t) => inRange(t.date)), (t) => t.amount) + sumBy(sheets.filter((d) => inRange(d.date)), (d) => d.cost),
        ],
      };
    });

    return {
      income,
      expenses,
      staff,
      paid,
      timesheets,
      result,
      incomeByCat: cat(inc, 'income'),
      expenseByCat: [{ label: TIMESHEET_CATEGORY, value: timesheets }, ...cat([...exp, ...staffTx], 'expense')].filter((x) => x.value > 0),
      series,
    };
  }, [data, period]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.tx ?? [])
      .filter((t) => kind === 'all' || t.kind === kind)
      .filter((t) => !term || `${t.category} ${t.description ?? ''} ${METHODS[t.method]}`.toLowerCase().includes(term));
  }, [data, kind, q]);

  // Fichajes de cada día, como un gasto más en la lista de movimientos
  const sheetList = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!data || kind === 'income' || (term && !'fichajes personal horas'.includes(term))) return {};
    return timesheetByDay(data.entries);
  }, [data, kind, q]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !s) return null;

  const emps = byId(data.employees);
  const events = byId(data.events);
  const byDate = groupBy(list, (t) => t.date);
  const dates = [...new Set([...Object.keys(byDate), ...Object.keys(sheetList)])].sort().reverse();

  const exportCsv = () =>
    downloadCSV(`movimientos-${period.from}.csv`, [
      ['Fecha', 'Tipo', 'Categoría', 'Importe', 'Método', 'Noche', 'Empleado', 'Concepto'],
      ...Object.values(sheetList)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => [d.date, 'Gasto', TIMESHEET_CATEGORY, -Math.round(d.cost * 100) / 100, '', '', '', `${d.people} personas · ${fmtHours(d.hours)}`]),
      ...[...list].reverse().map((t) => [
        t.date,
        t.kind === 'income' ? 'Ingreso' : 'Gasto',
        t.category,
        t.kind === 'income' ? t.amount : -t.amount,
        METHODS[t.method],
        t.event_id ? events.get(t.event_id)?.name : '',
        t.employee_id ? fullName(emps.get(t.employee_id)) : '',
        t.description,
      ]),
    ]);

  return (
    <>
      <PageHeader
        title="Finanzas"
        subtitle="Ingresos, gastos y resultado del negocio"
        actions={
          <>
            <Button variant="secondary" icon={<Plus />} onClick={() => setTxModal({ tx: null, kind: 'expense' })}>
              Añadir movimiento
            </Button>
            <Button icon={<Banknote />} onClick={() => setCloseout(true)}>
              Cierre de caja
            </Button>
            <Button variant="secondary" icon={<FileDown />} onClick={() => setReportOpen(true)}>
              Exportar informe
            </Button>
          </>
        }
      />

      <div className="mb-5">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
        <StatCard label="Ingresos" value={fmtMoney(s.income)} tone="green" />
        <StatCard label="Gastos operativos" value={fmtMoney(s.expenses)} />
        <StatCard label="Gastos de personal" value={fmtMoney(s.staff)} sub={`Fichajes ${fmtMoney(s.timesheets)} · Pagos ${fmtMoney(s.paid)}`} />
        <StatCard
          label="Resultado"
          value={<span className={s.result >= 0 ? 'text-green' : 'text-red'}>{fmtMoney(s.result)}</span>}
          sub={s.income ? `Margen ${fmtPercent(s.result / s.income)}` : undefined}
        />
      </div>

      <Card className="mt-4 p-5 lg:mt-5">
        <h3 className="mb-4 text-[17px] font-semibold">Evolución</h3>
        <BarChart
          format={fmtMoney}
          data={s.series}
          series={[
            { name: 'Ingresos', color: 'rgb(var(--green))' },
            { name: 'Gastos + personal', color: 'rgb(var(--ink-3))' },
          ]}
        />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-2 lg:gap-5">
        <Card className="p-5">
          <h3 className="mb-4 text-[17px] font-semibold">Ingresos por concepto</h3>
          <HBarList format={fmtMoney} items={s.incomeByCat} color="rgb(var(--green))" />
        </Card>
        <Card className="p-5">
          <h3 className="mb-4 text-[17px] font-semibold">Gastos por concepto</h3>
          <HBarList format={fmtMoney} items={s.expenseByCat} color="rgb(var(--orange))" />
        </Card>
      </div>

      <p className="mt-3 px-1 text-[12px] text-ink-3">
        Resultado = ingresos - gastos operativos - gastos de personal (coste de los fichajes de cada noche + nóminas y personal pagados). Los fichajes cuentan al fichar la salida.
      </p>

      <div className="mb-3 mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[22px] font-bold tracking-tight">Movimientos</h2>
        <div className="flex flex-wrap gap-2">
          <SearchInput value={q} onChange={setQ} className="w-full sm:w-56" />
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'income', label: 'Ingresos' },
              { value: 'expense', label: 'Gastos' },
            ]}
          />
          <Button variant="secondary" size="sm" icon={<Download />} onClick={exportCsv} className="!h-9">
            CSV
          </Button>
        </div>
      </div>

      {dates.length ? (
        <div className="space-y-4">
          {dates.map((d) => {
            const ts = byDate[d] ?? [];
            const sheet = sheetList[d];
            const net = sumBy(ts, (t) => (t.kind === 'income' ? t.amount : -t.amount)) - (sheet?.cost ?? 0);
            return (
              <section key={d}>
                <div className="mb-1.5 flex items-baseline justify-between px-1">
                  <h3 className="text-[14px] font-semibold text-ink-2">{fmtDateLong(d)}</h3>
                  <span className={cx('tabular text-[13px] font-medium', net >= 0 ? 'text-green' : 'text-ink-2')}>
                    {net >= 0 ? '+' : ''}
                    {fmtMoney(net)}
                  </span>
                </div>
                <Card className="divide-y divide-line overflow-hidden">
                  {sheet && (
                    <button onClick={() => navigate('/fichajes')} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-purple/15 text-purple">
                        <Clock className="h-[17px] w-[17px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{TIMESHEET_CATEGORY}</div>
                        <div className="truncate text-[13px] text-ink-2">
                          {sheet.people} {sheet.people === 1 ? 'persona' : 'personas'} · {fmtHours(sheet.hours)} · automático
                        </div>
                      </div>
                      <span className="tabular shrink-0 text-[15px] font-semibold">−{fmtMoney(sheet.cost)}</span>
                    </button>
                  )}
                  {[...ts].sort(compareByCategory).map((t) => (
                    <button key={t.id} onClick={() => setTxModal({ tx: t })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60">
                      <span
                        className={cx(
                          'grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-semibold',
                          t.kind === 'income' ? 'bg-green/15 text-green' : 'bg-fill text-ink-2',
                        )}
                      >
                        {t.kind === 'income' ? '+' : '−'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{t.category}</div>
                        <div className="truncate text-[13px] text-ink-2">
                          {[
                            METHODS[t.method],
                            t.employee_id && fullName(emps.get(t.employee_id)),
                            t.event_id && events.get(t.event_id)?.name,
                            t.description,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <span className={cx('tabular shrink-0 text-[15px] font-semibold', t.kind === 'income' && 'text-green')}>
                        {t.kind === 'income' ? '+' : '−'}
                        {fmtMoney(t.amount)}
                      </span>
                    </button>
                  ))}
                </Card>
              </section>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Wallet />} title="Sin movimientos" message="Registra el cierre de caja de cada noche y los gastos del local." />
        </Card>
      )}

      <TransactionForm
        open={!!txModal}
        onClose={() => setTxModal(null)}
        tx={txModal?.tx}
        defaults={{ kind: txModal?.kind }}
        employees={data.employees}
        events={data.events}
        onSaved={reload}
      />
      <CloseoutForm open={closeout} onClose={() => setCloseout(false)} events={data.events} onSaved={reload} />
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        initial={{ from: period.from, to: isoDate(addDays(parseDate(period.to), -1)) }}
      />
    </>
  );
}

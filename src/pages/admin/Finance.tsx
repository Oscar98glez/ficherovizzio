import { useMemo, useState } from 'react';
import { Banknote, Download, FileDown, Plus, Wallet } from 'lucide-react';
import { BarChart, HBarList } from '../../components/charts';
import { CloseoutForm, TransactionForm } from '../../components/finance-forms';
import { PeriodPicker } from '../../components/PeriodPicker';
import { ReportDialog } from '../../components/ReportDialog';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, SearchInput, Segmented, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { isStaffExpense, METHODS } from '../../lib/constants';
import { addDays, addMonths, daysBetween, isoDate, makePeriod, parseDate, periodRange, startOfWeek } from '../../lib/dates';
import { fmtDate, fmtDateLong, fmtMoney, fmtPercent, fmtWeekday } from '../../lib/format';
import type { Transaction } from '../../lib/types';
import { byId, categoryRank, compareByCategory, cx, downloadCSV, entryCost, fullName, groupBy, sumBy } from '../../lib/utils';

type KindFilter = 'all' | 'income' | 'expense';

export default function Finance() {
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
    // Gastos operativos por un lado y gastos de personal (nóminas + camareros) por otro
    const exp = data.tx.filter((t) => t.kind === 'expense' && !isStaffExpense(t));
    const staffTx = data.tx.filter(isStaffExpense);
    const income = sumBy(inc, (t) => t.amount);
    const expenses = sumBy(exp, (t) => t.amount);
    const staff = sumBy(staffTx, (t) => t.amount);
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
          sumBy([...exp, ...staffTx].filter((t) => inRange(t.date)), (t) => t.amount),
        ],
      };
    });

    return {
      income,
      expenses,
      staff,
      result,
      accrued: sumBy(data.entries, (e) => entryCost(e)),
      incomeByCat: cat(inc, 'income'),
      expenseByCat: cat([...exp, ...staffTx], 'expense').filter((x) => x.value > 0),
      series,
    };
  }, [data, period]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.tx ?? [])
      .filter((t) => kind === 'all' || t.kind === kind)
      .filter((t) => !term || `${t.category} ${t.description ?? ''} ${METHODS[t.method]}`.toLowerCase().includes(term));
  }, [data, kind, q]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !s) return null;

  const emps = byId(data.employees);
  const events = byId(data.events);
  const byDate = groupBy(list, (t) => t.date);
  const dates = Object.keys(byDate).sort().reverse();

  const exportCsv = () =>
    downloadCSV(`movimientos-${period.from}.csv`, [
      ['Fecha', 'Tipo', 'Categoría', 'Importe', 'Método', 'Noche', 'Empleado', 'Concepto'],
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
        <StatCard label="Gastos de personal" value={fmtMoney(s.staff)} sub={s.accrued > 0 ? `Según fichajes ${fmtMoney(s.accrued)}` : 'Nóminas y camareros'} />
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
        Resultado = ingresos - gastos operativos - gastos de personal (nóminas y camareros pagados). El coste según fichajes es sólo informativo.
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
            const ts = byDate[d];
            const net = sumBy(ts, (t) => (t.kind === 'income' ? t.amount : -t.amount));
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

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { BarChart, Donut, HBarList } from '../../components/charts';
import { useFeedback } from '../../components/overlay';
import { Card, CardHeader, ErrorBox, Loading, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { capitalize, parseDate, type Period } from '../../lib/dates';
import { fmtMoney } from '../../lib/format';
import { EXPENSE_GROUPS, fmtAmount, fmtShare, parseLedgerAmount, yearTotals } from '../../lib/ledger';
import type { AdminLedgerYear } from '../../lib/types';
import { cx } from '../../lib/utils';

/** Colores de los gráficos, comprobados para distinguirse (también con daltonismo) sobre el fondo oscuro */
const C = { income: '#3a8fd6', expenses: '#c9741f', efectivo: '#2e9e57', banco: '#3a8fd6', plataforma: '#c9741f' };

const monthName = (m: string) => capitalize(parseDate(m).toLocaleDateString('es-ES', { month: 'long' }));
const monthShort = (m: string) => parseDate(m).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
const total = (n: number) => (n ? fmtAmount(n) : '—');

export function LedgerYear({ period, onOpenMonth }: { period: Period; onOpenMonth: (month: string) => void }) {
  const { toast } = useFeedback();
  const year = Number(period.from.slice(0, 4));
  const [reparto, setReparto] = useState<AdminLedgerYear | null>(null);
  const [repartoText, setRepartoText] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [days, years] = await Promise.all([
      api.ledgerDays.list({ gte: ['date', period.from], lt: ['date', period.to] }),
      api.ledgerYears.list({ eq: { year } }),
    ]);
    return { days, year: years[0] ?? null };
  }, [period]);

  useEffect(() => {
    if (data) setReparto(data.year);
  }, [data]);

  const months = useMemo(() => yearTotals(year, data?.days ?? []), [year, data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const sumOf = (f: (m: (typeof months)[number]) => number) => months.reduce((n, m) => n + f(m), 0);
  const income = sumOf((m) => m.income);
  const expenses = sumOf((m) => m.expenses);
  const result = income - expenses;
  const repartoValue = reparto?.reparto ?? null;

  async function saveReparto(text: string) {
    const value = parseLedgerAmount(text);
    setRepartoText(null);
    if ((value ?? 0) === (repartoValue ?? 0)) return;
    try {
      const res = reparto?.id ? await api.ledgerYears.update(reparto.id, { reparto: value }) : await api.ledgerYears.create({ year, reparto: value });
      setReparto(res);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3';
  const num = 'tabular whitespace-nowrap px-3 py-2 text-right text-[14px]';
  // Columna fija al deslizar la tabla a los lados
  const stickyCol = 'sticky left-0 z-[1] border-r border-r-line bg-[rgb(var(--surface)/0.97)]';
  const monthCell = (m: string) => (
    <td className={cx(stickyCol, 'p-0')}>
      <button type="button" onClick={() => onOpenMonth(m)} className="flex w-full items-center gap-1 px-3 py-2 text-left text-[14px] font-medium transition hover:text-accent">
        {monthName(m)}
        <ChevronRight className="h-3.5 w-3.5 text-ink-3" />
      </button>
    </td>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
        <StatCard label="Total ingresos" value={fmtMoney(income)} />
        <StatCard label="Total gastos" value={fmtMoney(expenses)} sub={income ? `${fmtShare(expenses, income)} de los ingresos` : undefined} />
        <StatCard label="Resultado" value={<span className={result >= 0 ? 'text-green' : 'text-red'}>{fmtMoney(result)}</span>} sub={income ? `Margen ${fmtShare(result, income)}` : undefined} />
        <Card className="p-4 sm:p-5">
          <span className="text-[13px] font-medium text-ink-2">Reparto</span>
          <input
            inputMode="decimal"
            value={repartoText ?? (repartoValue ? fmtMoney(repartoValue) : '')}
            placeholder="0,00 €"
            onFocus={() => setRepartoText(repartoValue ? String(repartoValue).replace('.', ',') : '')}
            onChange={(e) => setRepartoText(e.target.value)}
            onBlur={() => saveReparto(repartoText ?? '')}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Reparto del año"
            className="tabular mt-1 w-full rounded-lg bg-transparent text-[22px] font-semibold tracking-tight outline-none placeholder:text-ink-3 hover:bg-fill focus:bg-fill focus:ring-2 focus:ring-accent/60"
          />
          <div className="mt-1 text-[12px] text-ink-2">{repartoValue && income ? `${fmtShare(repartoValue, income)} de los ingresos` : 'Importe que se reparte en el año'}</div>
        </Card>
      </div>

      {/* Resumen anual de ingresos y gastos */}
      <Card className="mt-4 overflow-hidden lg:mt-5">
        <CardHeader title="Ingresos y gastos" subtitle="Por meses. Pulsa un mes para abrir su hoja." />
        <div className="px-5 pb-2">
          <BarChart
            format={fmtMoney}
            data={months.map((m) => ({ label: monthShort(m.month), detail: monthName(m.month), values: [m.income, m.expenses] }))}
            series={[
              { name: 'Ingresos', color: C.income },
              { name: 'Gastos', color: C.expenses },
            ]}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {['Mes', 'Ingresos', 'Gastos', 'Resultado', 'Margen'].map((t, i) => (
                  <th key={t} className={cx(th, 'border-y border-line', i === 0 ? cx(stickyCol, 'text-left') : 'text-right')}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="[&>td]:border-b [&>td]:border-line">
                  {monthCell(m.month)}
                  <td className={num}>{total(m.income)}</td>
                  <td className={num}>{total(m.expenses)}</td>
                  <td className={cx(num, 'font-semibold', m.result < 0 ? 'text-red' : m.result > 0 && 'text-green')}>{total(m.result)}</td>
                  <td className={cx(num, 'text-ink-2')}>{fmtShare(m.result, m.income)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-fill [&>td]:font-semibold">
                <td className={cx(stickyCol, 'bg-fill px-3 py-2 text-[14px]')}>Total</td>
                <td className={num}>{total(income)}</td>
                <td className={num}>{total(expenses)}</td>
                <td className={cx(num, result < 0 ? 'text-red' : result > 0 && 'text-green')}>{total(result)}</td>
                <td className={num}>{fmtShare(result, income)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Resumen anual de ingresos */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-3 lg:gap-5">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Ingresos" subtitle="Efectivo, banco y plataforma / rappel de cada mes." />
          <div className="px-5 pb-2">
            <BarChart
              format={fmtMoney}
              data={months.map((m) => ({ label: monthShort(m.month), detail: monthName(m.month), values: [m.efectivo, m.banco, m.plataformaRappel] }))}
              series={[
                { name: 'Efectivo', color: C.efectivo },
                { name: 'Banco', color: C.banco },
                { name: 'Plataforma / rappel', color: C.plataforma },
              ]}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  {['Mes', 'Efectivo', 'Banco', 'Plataforma / rappel', 'Total'].map((t, i) => (
                    <th key={t} className={cx(th, 'border-y border-line', i === 0 ? cx(stickyCol, 'text-left') : 'text-right')}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="[&>td]:border-b [&>td]:border-line">
                    {monthCell(m.month)}
                    <td className={num}>{total(m.efectivo)}</td>
                    <td className={num}>{total(m.banco)}</td>
                    <td className={num}>{total(m.plataformaRappel)}</td>
                    <td className={cx(num, 'font-semibold')}>{total(m.income)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-fill [&>td]:font-semibold">
                  <td className={cx(stickyCol, 'bg-fill px-3 py-2 text-[14px]')}>Total</td>
                  <td className={num}>{total(sumOf((m) => m.efectivo))}</td>
                  <td className={num}>{total(sumOf((m) => m.banco))}</td>
                  <td className={num}>{total(sumOf((m) => m.plataformaRappel))}</td>
                  <td className={num}>{total(income)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
        <div className="space-y-4 lg:space-y-5">
          <Card className="p-5">
            <h3 className="mb-4 text-[17px] font-semibold">Reparto de ingresos</h3>
            <Donut
              format={fmtMoney}
              empty="Aún no hay ingresos este año"
              items={[
                { label: 'Efectivo', value: sumOf((m) => m.efectivo), color: C.efectivo },
                { label: 'Banco', value: sumOf((m) => m.banco), color: C.banco },
                { label: 'Plataforma / rappel', value: sumOf((m) => m.plataformaRappel), color: C.plataforma },
              ]}
            />
          </Card>
          <Card className="p-5">
            <h3 className="mb-4 text-[17px] font-semibold">Gastos por grupo</h3>
            <HBarList
              format={fmtMoney}
              color={C.expenses}
              empty="Aún no hay gastos este año"
              items={EXPENSE_GROUPS.map((g) => ({ label: g.label, value: sumOf((m) => m.groups[g.key] ?? 0) }))
                .filter((i) => i.value > 0)
                .sort((a, b) => b.value - a.value)}
            />
          </Card>
        </div>
      </div>

      {/* Resumen anual de gastos */}
      <Card className="mt-4 overflow-hidden lg:mt-5">
        <CardHeader title="Gastos" subtitle="Cada grupo de gastos, mes a mes." />
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={cx(th, stickyCol, 'border-y border-line text-left')}>Mes</th>
                {EXPENSE_GROUPS.map((g) => (
                  <th key={g.key} className={cx(th, 'border-y border-line text-right')}>
                    {g.label}
                  </th>
                ))}
                <th className={cx(th, 'border-y border-line text-right')}>Total</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="[&>td]:border-b [&>td]:border-line">
                  {monthCell(m.month)}
                  {EXPENSE_GROUPS.map((g) => (
                    <td key={g.key} className={num}>
                      {total(m.groups[g.key] ?? 0)}
                    </td>
                  ))}
                  <td className={cx(num, 'font-semibold')}>{total(m.expenses)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-fill [&>td]:font-semibold">
                <td className={cx(stickyCol, 'bg-fill px-3 py-2 text-[14px]')}>Total</td>
                {EXPENSE_GROUPS.map((g) => (
                  <td key={g.key} className={num}>
                    {total(sumOf((m) => m.groups[g.key] ?? 0))}
                  </td>
                ))}
                <td className={num}>{total(expenses)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}

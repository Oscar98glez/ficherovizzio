import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { Button, ErrorBox, Loading } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { businessToday } from '../../lib/dates';
import { EXPENSE_GROUPS, fmtEuros, fmtShare, monthTitle, parseLedgerAmount, yearSpan, yearTotals } from '../../lib/ledger';
import type { AdminLedgerYear } from '../../lib/types';
import { cx } from '../../lib/utils';
import { amountText, Bar, MoneyInput, Panel, PanelTitle } from './ledger-ui';

const monthShort = (m: string) => monthTitle(m).slice(0, 3);
const per100 = (part: number, whole: number) => (whole ? `${(Math.round((part / whole) * 1000) / 10).toLocaleString('es-ES')} €` : '—');

/** Resumen del año (la hoja INICIO del Excel): cada mes, los ingresos por tipo, los gastos por grupo y el reparto */
export function LedgerYear({ year, onOpenMonth, onYear }: { year: number; onOpenMonth: (month: string) => void; onYear: (year: number) => void }) {
  const { toast } = useFeedback();
  const span = useMemo(() => yearSpan(year), [year]);
  const { data, loading, error, reload } = useLoad(async () => {
    const [days, expenses, years] = await Promise.all([
      api.ledgerDays.list({ gte: ['date', span.from], lt: ['date', span.to] }),
      api.ledgerExpenses.list({ gte: ['date', span.from], lt: ['date', span.to] }),
      api.ledgerYears.list({ eq: { year } }),
    ]);
    return { days, expenses, year: years[0] ?? null };
  }, [year]);

  const [row, setRow] = useState<AdminLedgerYear | null>(null);
  const [reparto, setReparto] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    setRow(data.year);
    setReparto(amountText(data.year?.reparto ?? null));
  }, [data]);

  const months = useMemo(() => yearTotals(year, data?.days ?? [], data?.expenses ?? []), [year, data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const sum = (f: (m: (typeof months)[number]) => number) => months.reduce((n, m) => n + f(m), 0);
  const income = sum((m) => m.income);
  const expenses = sum((m) => m.expenses);
  const result = income - expenses;
  const isNow = businessToday().getFullYear() === year;
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(m.income, m.expenses)));
  const used = months.filter((m) => m.income || m.expenses);
  const incomeBy = (k: string) => sum((m) => m.incomeBy[k] ?? 0);
  const kinds = [
    { label: 'Efectivo', v: incomeBy('efectivo'), color: 'bg-green' },
    { label: 'Banco', v: incomeBy('banco'), color: 'bg-accent' },
    { label: 'Plataforma y rappel', v: incomeBy('plataforma') + incomeBy('rappel'), color: 'bg-ink-3' },
  ];
  const groups = EXPENSE_GROUPS.map((g) => ({ g, v: sum((m) => m.groups[g.key] ?? 0) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  const repartoValue = parseLedgerAmount(reparto);

  async function saveReparto() {
    if (reparto.trim() && repartoValue === null) return toast.error('Revisa el importe: escribe sólo números, por ejemplo 100000');
    setSaving(true);
    try {
      const res = row ? await api.ledgerYears.update(row.id, { reparto: repartoValue }) : await api.ledgerYears.create({ year, reparto: repartoValue });
      setRow(res);
      toast.success('Reparto guardado');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[15px] text-ink-2">Todo el año</p>
          <h2 className="text-[30px] font-bold leading-tight tracking-[-0.03em] sm:text-[34px]">
            {isNow ? 'Así va' : 'Así fue'} {year}
          </h2>
        </div>
        <div className="flex gap-1.5">
          <button type="button" aria-label="Año anterior" onClick={() => onYear(year - 1)} className="grid h-10 w-10 place-items-center rounded-full bg-fill transition hover:bg-fill-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Año siguiente" onClick={() => onYear(year + 1)} className="grid h-10 w-10 place-items-center rounded-full bg-fill transition hover:bg-fill-2">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </header>

      <Panel className="flex flex-wrap items-center justify-between gap-x-12 gap-y-7">
        <div className="min-w-0 flex-[1_1_300px]">
          <p className="text-[17px] text-ink-2">{result >= 0 ? (isNow ? 'De momento se ha ganado' : 'Se ganó') : isNow ? 'De momento se ha perdido' : 'Se perdió'}</p>
          <p className={cx('tabular mt-2 whitespace-nowrap text-[clamp(40px,5vw,60px)] font-bold leading-none tracking-[-0.04em]', result < 0 && 'text-red')}>{fmtEuros(result, true)}</p>
          {income > 0 && <p className="mt-3 text-[15px] text-ink-2">Margen del {fmtShare(result, income)} · {used.length} {used.length === 1 ? 'mes' : 'meses'} con datos</p>}
        </div>
        <div className="tabular min-w-0 flex-[1_1_280px] space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-[15px]">
              <span>Ha entrado</span>
              <strong className="font-semibold">{fmtEuros(income)}</strong>
            </div>
            <Bar value={income} max={Math.max(income, expenses)} className="h-3" color="bg-green" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[15px]">
              <span>Ha salido</span>
              <strong className="font-semibold">{fmtEuros(expenses)}</strong>
            </div>
            <Bar value={expenses} max={Math.max(income, expenses)} className="h-3" color="bg-ink-3" />
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h3 className="text-[21px] font-semibold tracking-[-0.02em]">Mes a mes</h3>
          <span className="flex gap-4 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-green" /> Entra
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-ink-3" /> Sale
            </span>
          </span>
        </div>
        <div className="grid grid-cols-12 gap-0.5 sm:gap-2">
          {months.map((m) => (
            <button key={m.month} type="button" onClick={() => onOpenMonth(m.month)} aria-label={`Abrir ${monthTitle(m.month)}`} className="flex flex-col items-center gap-2 rounded-xl pt-1 transition hover:bg-fill/60">
              <span className="flex h-[150px] items-end gap-[2px] border-b border-line sm:gap-1">
                <span className="w-[7px] rounded-t bg-green sm:w-3" style={{ height: `${Math.max(m.income ? 3 : 0, (m.income / maxMonth) * 150)}px` }} />
                <span className="w-[7px] rounded-t bg-ink-3/60 sm:w-3" style={{ height: `${Math.max(m.expenses ? 3 : 0, (m.expenses / maxMonth) * 150)}px` }} />
              </span>
              <span className="pb-2 text-[11px] font-medium text-ink-2 sm:text-[13px]">{monthShort(m.month)}</span>
            </button>
          ))}
        </div>
        <div className="tabular mt-4">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1fr))] gap-3 pb-2 text-[12.5px] font-medium text-ink-2 sm:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]">
            <span>Mes</span>
            <span className="text-right">Entró</span>
            <span className="text-right">Salió</span>
            <span className="text-right">Resultado</span>
            <span className="hidden text-right sm:block">Frente al anterior</span>
          </div>
          {months.map((m, i) => {
            const prev = months[i - 1];
            const change = prev?.income && m.income ? (m.income - prev.income) / prev.income : null;
            const has = m.income || m.expenses;
            return (
              <button
                key={m.month}
                type="button"
                onClick={() => onOpenMonth(m.month)}
                className="grid w-full grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1fr))] items-center gap-3 border-t border-line py-3 text-left text-[15px] transition hover:bg-fill/40 sm:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]"
              >
                <span className="flex items-center gap-1 font-medium">
                  {monthTitle(m.month)} <ChevronRight className="h-3.5 w-3.5 text-ink-3" />
                </span>
                <span className={cx('text-right', !has && 'text-ink-3')}>{has ? fmtEuros(m.income) : '—'}</span>
                <span className={cx('text-right', !has && 'text-ink-3')}>{has ? fmtEuros(m.expenses) : '—'}</span>
                <span className={cx('text-right font-semibold', !has ? 'font-normal text-ink-3' : m.result < 0 && 'text-red')}>{has ? fmtEuros(m.result, true) : '—'}</span>
                <span className={cx('hidden text-right text-[14px] sm:block', change === null ? 'text-ink-3' : change >= 0 ? 'text-green' : 'text-red')}>
                  {change === null ? '—' : `${change >= 0 ? '↑' : '↓'} ${fmtShare(Math.abs(change), 1)}`}
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
        <Panel>
          <PanelTitle title="Cómo ha entrado" />
          {kinds.map((k) => (
            <div key={k.label} className="tabular border-t border-line py-3">
              <div className="mb-2 flex justify-between text-[15px]">
                <span>{k.label}</span>
                <span>
                  <strong className="font-semibold">{fmtEuros(k.v)}</strong>
                  <span className="ml-2 text-ink-2">{fmtShare(k.v, income)}</span>
                </span>
              </div>
              <Bar value={k.v} max={income} color={k.color} />
            </div>
          ))}
        </Panel>

        <Panel>
          <PanelTitle title="Reparto del año" />
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-[1_1_220px]">
              <MoneyInput size="md" label="Lo que se reparte" value={reparto} onChange={setReparto} hint={repartoValue && income ? `Es el ${fmtShare(repartoValue, income)} de lo que ha entrado` : 'Escríbelo cuando se decida'} />
            </div>
            {(repartoValue ?? null) !== (row?.reparto ?? null) && (
              <Button variant="solid" size="lg" className="mb-7" loading={saving} onClick={saveReparto}>
                Guardar
              </Button>
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelTitle title="En qué se ha gastado" aside={income ? 'De cada 100 € que entran' : undefined} />
        {groups.length ? (
          groups.map(({ g, v }) => (
            <div key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-line py-3 sm:grid-cols-[200px_minmax(0,1fr)_110px_64px]">
              <span className="min-w-0">
                <span className="block text-[16px]">{g.title}</span>
                <span className="block truncate text-[12.5px] text-ink-2">{fmtShare(v, expenses)} de los gastos</span>
              </span>
              <Bar value={v} max={groups[0].v} className="order-last col-span-2 sm:order-none sm:col-span-1" />
              <span className="tabular text-right text-[15px] font-medium">{fmtEuros(v)}</span>
              <span className="tabular hidden text-right text-[15px] text-ink-2 sm:block">{per100(v, income)}</span>
            </div>
          ))
        ) : (
          <p className="border-t border-line pt-4 text-[15px] text-ink-2">Aún no hay pagos apuntados este año.</p>
        )}
      </Panel>
    </div>
  );
}

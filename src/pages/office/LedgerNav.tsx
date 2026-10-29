import { useState } from 'react';
import { Check, ChevronRight, LineChart } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { fmtEuros, monthName, rangeLabel } from '../../lib/ledger';
import type { AdminLedgerDay, AdminLedgerExpense, AdminLedgerMonth } from '../../lib/types';
import { cx } from '../../lib/utils';
import type { LedgerView, WeekInfo } from './Administration';

const noches = (n: number) => `${n} ${n === 1 ? 'noche' : 'noches'}`;

/** La columna de la izquierda: todo el mes, sus semanas (de la última a la primera) y los demás apartados */
export function LedgerNav({
  month,
  view,
  weeks,
  selectedWeek,
  monthResult,
  onOpen,
  days,
  expenses,
  months,
}: {
  month: string;
  view: LedgerView;
  weeks: WeekInfo[];
  selectedWeek: string | null;
  monthResult: number;
  onOpen: (view: LedgerView, week?: string) => void;
  days: AdminLedgerDay[];
  expenses: AdminLedgerExpense[];
  months: AdminLedgerMonth[];
}) {
  const { toast } = useFeedback();
  const [exporting, setExporting] = useState(false);

  async function download() {
    setExporting(true);
    try {
      const { downloadLedgerMonth } = await import('../../lib/ledger-xlsx');
      await downloadLedgerMonth(month, days, expenses, months);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const rowCls = (active: boolean) =>
    cx('flex w-full items-center gap-3 px-4 py-3.5 text-left transition', active ? 'bg-accent/10 shadow-[inset_3px_0_0_rgb(var(--accent))]' : 'hover:bg-fill/60');

  return (
    <>
      <div className="overflow-hidden rounded-[20px] bg-surface shadow-card">
        <button type="button" onClick={() => onOpen('mes')} className={rowCls(view === 'mes')} aria-current={view === 'mes' ? 'page' : undefined}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
            <LineChart className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Todo el mes</span>
            <span className="block text-[13px] text-ink-2">Resumen de {monthName(month)}</span>
          </span>
          <span className={cx('tabular whitespace-nowrap text-[14px] font-semibold', monthResult < 0 && 'text-red')}>{fmtEuros(monthResult, true)}</span>
        </button>

        {[...weeks].reverse().map((w) => {
          const active = view === 'semana' && selectedWeek === w.start;
          const pending = w.shown.length - w.done.length;
          const status =
            w.state === 'done' || (w.state === 'current' && !pending)
              ? { text: fmtEuros(w.totals.result, true), cls: w.totals.result < 0 ? 'text-red' : 'text-ink' }
              : w.state === 'future'
                ? { text: 'Más adelante', cls: 'text-ink-3 font-medium' }
                : { text: `Faltan ${noches(w.state === 'current' ? pending : w.missing.length)}`, cls: w.state === 'current' ? 'text-accent' : 'text-orange' };
          return (
            <button key={w.start} type="button" onClick={() => onOpen('semana', w.start)} className={cx(rowCls(active), 'border-t border-line')} aria-current={active ? 'page' : undefined}>
              <span
                className={cx(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-bold',
                  w.state === 'done' && 'bg-green/15 text-green',
                  w.state === 'current' && 'bg-accent text-on-accent',
                  w.state === 'missing' && 'bg-orange/15 text-orange',
                  w.state === 'future' && 'bg-fill text-ink-3',
                )}
              >
                {w.state === 'done' ? <Check className="h-[18px] w-[18px]" strokeWidth={3} /> : w.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">{w.state === 'current' ? 'Esta semana' : `Semana ${w.n}`}</span>
                <span className="block text-[13px] text-ink-2">{rangeLabel(w.shown[0] ?? w.nights[0], w.shown[w.shown.length - 1] ?? w.nights[3])}</span>
                <span className="mt-1.5 flex gap-1" aria-label={`${w.done.length} de ${noches(w.shown.length)} apuntadas`}>
                  {w.shown.map((d) => (
                    <span
                      key={d}
                      className={cx(
                        'h-[5px] w-4 rounded-full',
                        w.done.includes(d) ? (w.state === 'current' ? 'bg-accent' : 'bg-green') : w.missing.includes(d) && w.state !== 'current' ? 'bg-orange/50' : 'bg-fill-2',
                      )}
                    />
                  ))}
                </span>
              </span>
              <span className={cx('tabular whitespace-nowrap text-right text-[14px] font-semibold', status.cls)}>{status.text}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[20px] bg-surface shadow-card">
        {(
          [
            ['año', 'Resumen del año'],
            ['cierre', 'Cierre del mes'],
          ] as const
        ).map(([v, label], i) => (
          <button key={v} type="button" onClick={() => onOpen(v)} className={cx(rowCls(view === v), 'justify-between text-[15px]', i > 0 && 'border-t border-line')}>
            {label}
            <ChevronRight className="h-4 w-4 text-ink-3" />
          </button>
        ))}
        <button type="button" onClick={download} disabled={exporting} className={cx(rowCls(false), 'justify-between border-t border-line text-[15px]')}>
          Descargar en Excel
          {exporting ? <Spinner className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 text-ink-3" />}
        </button>
      </div>
    </>
  );
}

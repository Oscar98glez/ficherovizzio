import { Banknote, CreditCard } from 'lucide-react';
import { Button } from '../../components/ui';
import { fmtWeekday } from '../../lib/format';
import { EXPENSE_GROUPS, fmtEuros, monthName, rangeLabel, type LedgerMonthCash } from '../../lib/ledger';
import { cx } from '../../lib/utils';
import type { WeekInfo } from './Administration';
import { Bar, Panel, PanelTitle } from './ledger-ui';

const per100 = (part: number, whole: number) => (whole ? `${(Math.round((part / whole) * 1000) / 10).toLocaleString('es-ES')} €` : '—');
const shortNight = (d: string) => `${fmtWeekday(d)} ${Number(d.slice(8))}`;
/** "+15,2" (miles), "−0,8" */
const thousands = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${(Math.round(Math.abs(n) / 100) / 10).toLocaleString('es-ES')}`;

/** "Todo el mes": lo ganado, la caja y el banco, cada semana y en qué se ha gastado */
export function LedgerOverview({
  month,
  cash,
  previous,
  weeks,
  isNow,
  onOpenWeek,
  onRecord,
}: {
  month: string;
  cash: LedgerMonthCash;
  previous?: LedgerMonthCash;
  weeks: WeekInfo[];
  isNow: boolean;
  onOpenWeek: (week: string) => void;
  onRecord: () => void;
}) {
  const t = cash.totals;
  const name = monthName(month);
  const missing = weeks.flatMap((w) => w.missing);
  const done = weeks.reduce((n, w) => n + w.done.length, 0);
  const empty = !t.income && !t.expenses;
  const prev = previous && (previous.totals.income || previous.totals.expenses) ? previous : null;
  const maxFlow = Math.max(t.income, t.expenses);

  const maxWeek = Math.max(1, ...weeks.map((w) => Math.max(w.totals.income, w.totals.expenses)));
  const groups = EXPENSE_GROUPS.map((g) => ({ g, v: t.groups[g.key] ?? 0 }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[15px] text-ink-2">Todo el mes</p>
          <h2 className="text-[30px] font-bold leading-tight tracking-[-0.03em] sm:text-[34px]">
            {isNow ? 'Así va' : 'Así fue'} {name}
          </h2>
        </div>
        <Button variant="solid" size="lg" onClick={onRecord}>
          {isNow ? 'Apuntar la noche de hoy' : 'Apuntar una noche'}
        </Button>
      </header>

      {empty ? (
        <Panel className="py-10 text-center sm:py-14">
          <p className="text-[22px] font-semibold tracking-[-0.02em]">Aún no hay nada apuntado en {name}</p>
          <p className="mx-auto mt-2 max-w-md text-[16px] text-ink-2">Empieza por lo que entró cada noche. Los pagos de la semana se apuntan en la misma pantalla.</p>
        </Panel>
      ) : (
        <Panel className="flex flex-wrap items-center justify-between gap-x-12 gap-y-7">
          <div className="min-w-0 flex-[1_1_300px]">
            <p className="text-[17px] text-ink-2">{t.result >= 0 ? (isNow ? 'De momento se ha ganado' : 'Se ganó') : isNow ? 'De momento se ha perdido' : 'Se perdió'}</p>
            <p className={cx('tabular mt-2 whitespace-nowrap text-[clamp(40px,5vw,60px)] font-bold leading-none tracking-[-0.04em]', t.result < 0 && 'text-red')}>{fmtEuros(t.result, true)}</p>
            {prev && (
              <p className="mt-3 text-[15px] text-ink-2">
                En {monthName(prev.month)} {prev.totals.result >= 0 ? 'se ganó' : 'se perdió'} <span className="tabular font-medium text-ink">{fmtEuros(Math.abs(prev.totals.result))}</span>
              </p>
            )}
          </div>
          <div className="tabular min-w-0 flex-[1_1_280px] space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-[15px]">
                <span>Ha entrado</span>
                <strong className="font-semibold">{fmtEuros(t.income)}</strong>
              </div>
              <Bar value={t.income} max={maxFlow} className="h-3" color="bg-green" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[15px]">
                <span>Ha salido</span>
                <strong className="font-semibold">{fmtEuros(t.expenses)}</strong>
              </div>
              <Bar value={t.expenses} max={maxFlow} className="h-3" color="bg-ink-3" />
            </div>
            <p className="text-[13px] text-ink-2">
              {done} {done === 1 ? 'noche apuntada' : 'noches apuntadas'}
              {missing.length > 0 && ` · faltan ${missing.map(shortNight).join(', ')}`}
            </p>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
        {(
          [
            ['En la caja', Banknote, 'text-green', cash.cashStart, cash.cashEnd],
            ['En el banco', CreditCard, 'text-accent', cash.bankStart, cash.bankEnd],
          ] as const
        ).map(([label, Icon, iconCls, start, end]) => (
          <Panel key={label} className="flex flex-col gap-2 sm:p-6">
            <span className="flex items-center gap-2 text-[15px] font-medium">
              <Icon className={cx('h-5 w-5', iconCls)} />
              {label}
            </span>
            <span className={cx('tabular text-[36px] font-bold tracking-[-0.03em]', end < 0 && 'text-red')}>{fmtEuros(end)}</span>
            <span className="tabular text-[14px] text-ink-2">
              Empezó el mes con {fmtEuros(start)} · {fmtEuros(end - start, true)}
            </span>
          </Panel>
        ))}
      </div>

      <Panel>
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h3 className="text-[21px] font-semibold tracking-[-0.02em]">
            Semana a semana <span className="text-[14px] font-normal text-ink-2 sm:hidden">(en miles de €)</span>
          </h3>
          <span className="flex gap-4 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-green" /> Entra
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-ink-3" /> Sale
            </span>
          </span>
        </div>
        <div className="grid gap-2 sm:gap-4" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
          {weeks.map((w) => {
            const soft = w.state === 'current' || w.state === 'future';
            return (
              <button
                key={w.start}
                type="button"
                onClick={() => onOpenWeek(w.start)}
                aria-label={`Abrir la semana ${w.n}`}
                className="group flex flex-col items-center gap-2 rounded-2xl pt-1 transition hover:bg-fill/60"
              >
                <span className={cx('tabular whitespace-nowrap text-[13px] font-semibold sm:text-[14px]', soft ? 'text-ink-3' : w.totals.result < 0 ? 'text-red' : 'text-ink')}>
                  {w.totals.income || w.totals.expenses ? (
                    <>
                      {thousands(w.totals.result)}
                      <span className="hidden sm:inline"> mil</span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="flex h-[140px] items-end gap-1 border-b border-line px-1 sm:gap-1.5">
                  <span className={cx('w-4 rounded-t-md transition-all duration-500 sm:w-6', soft ? 'bg-green/40' : 'bg-green')} style={{ height: `${Math.max(3, (w.totals.income / maxWeek) * 140)}px` }} />
                  <span className="w-4 rounded-t-md bg-ink-3/60 transition-all duration-500 sm:w-6" style={{ height: `${Math.max(3, (w.totals.expenses / maxWeek) * 140)}px` }} />
                </span>
                <span className="pb-2 text-center leading-tight">
                  <span className="block whitespace-nowrap text-[13px] font-semibold sm:text-[14px]">
                    <span className="hidden sm:inline">Semana</span>
                    <span className="sm:hidden">Sem.</span> {w.n}
                  </span>
                  <span className="hidden text-[12.5px] text-ink-2 sm:block">{rangeLabel(w.shown[0] ?? w.nights[0], w.shown[w.shown.length - 1] ?? w.nights[3])}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelTitle title="En qué se ha gastado" aside={t.income ? 'De cada 100 € que entran' : undefined} />
        {groups.length ? (
          <div>
            {groups.map(({ g, v }) => (
              <div key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-line py-3 sm:grid-cols-[200px_minmax(0,1fr)_96px_64px]">
                <span className="min-w-0">
                  <span className="block text-[16px]">{g.title}</span>
                  <span className="block truncate text-[12.5px] text-ink-2">{g.hint}</span>
                </span>
                <Bar value={v} max={groups[0].v} className="order-last col-span-2 sm:order-none sm:col-span-1" />
                <span className="tabular text-right text-[15px] font-medium">{fmtEuros(v)}</span>
                <span className="tabular hidden text-right text-[15px] text-ink-2 sm:block">{per100(v, t.income)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="border-t border-line pt-4 text-[15px] text-ink-2">Aún no hay pagos apuntados este mes.</p>
        )}
      </Panel>
    </div>
  );
}

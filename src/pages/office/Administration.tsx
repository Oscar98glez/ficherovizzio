import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { ErrorBox, Loading } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { businessToday, isoDate } from '../../lib/dates';
import {
  cashByMonth,
  computeTotals,
  dayHasData,
  inRange,
  ledgerMonthOf,
  monthSpan,
  monthTitle,
  monthWeeks,
  shiftMonth,
  weekNights,
  type LedgerTotals,
  type LedgerWeekDef,
} from '../../lib/ledger';
import type { AdminLedgerDay, AdminLedgerExpense, AdminLedgerMonth } from '../../lib/types';
import { cx } from '../../lib/utils';
import { LedgerClose } from './LedgerClose';
import { LedgerNav } from './LedgerNav';
import { LedgerOverview } from './LedgerOverview';
import { LedgerWeek } from './LedgerWeek';
import { LedgerYear } from './LedgerYear';

export type LedgerView = 'mes' | 'semana' | 'cierre' | 'año';

export type WeekState = 'done' | 'current' | 'missing' | 'future';

export interface WeekInfo extends LedgerWeekDef {
  /** Noches que se ven (de miércoles a sábado y los días con algo apuntado o con noche en la app) */
  shown: string[];
  done: string[];
  /** Noches ya pasadas (o la de hoy) sin apuntar */
  missing: string[];
  state: WeekState;
  totals: LedgerTotals;
}

export type DayValues = Record<string, number | string>;
export type ExpenseValues = Omit<AdminLedgerExpense, 'id' | 'created_at' | 'updated_at'> & { id?: string };

/**
 * Apartado de los administrativos: la caja de cada mes, como su Excel. A la izquierda el mes y sus
 * semanas; a la derecha el resumen del mes con gráficos, una semana para apuntar sus noches y sus
 * pagos, el cierre del mes o el resumen del año.
 */
export default function Administration() {
  const { toast } = useFeedback();
  const [params, setParams] = useSearchParams();
  const today = isoDate(businessToday());
  const month = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? `${params.get('mes')}-01` : ledgerMonthOf(today);
  const view: LedgerView = (['semana', 'cierre', 'año'] as const).find((v) => v === params.get('ver')) ?? 'mes';
  const weekParam = params.get('semana');
  const nightParam = params.get('noche');

  const go = (next: { month?: string; view?: LedgerView; week?: string; night?: string }) => {
    const p = new URLSearchParams();
    p.set('mes', (next.month ?? month).slice(0, 7));
    const v = next.view ?? 'mes';
    if (v !== 'mes') p.set('ver', v);
    if (v === 'semana' && next.week) p.set('semana', next.week);
    if (v === 'semana' && next.night) p.set('noche', next.night);
    setParams(p);
    window.scrollTo({ top: 0 });
  };

  const span = useMemo(() => monthSpan(month), [month]);
  // Todo lo apuntado hasta el final del mes: hace falta para saber lo que viene de los meses anteriores
  const { data, error, reload } = useLoad(async () => {
    const [days, expenses, months, events] = await Promise.all([
      api.ledgerDays.list({ lt: ['date', span.to] }),
      api.ledgerExpenses.list({ lt: ['date', span.to], order: ['created_at', 'asc'] }),
      api.ledgerMonths.list({ lt: ['month', shiftMonth(month, 1)] }),
      api.events.list({ gte: ['date', span.from], lt: ['date', span.to] }),
    ]);
    return { days, expenses, months, eventDates: events.map((e) => e.date) };
  }, [month]);

  const [days, setDays] = useState<AdminLedgerDay[]>([]);
  const [expenses, setExpenses] = useState<AdminLedgerExpense[]>([]);
  const [months, setMonths] = useState<AdminLedgerMonth[]>([]);
  // Lo cargado ya está en el estado (hasta entonces no se pinta, para no enseñar noches vacías)
  const [synced, setSynced] = useState<typeof data>();
  useEffect(() => {
    if (!data) return;
    setDays(data.days);
    setExpenses(data.expenses);
    setMonths(data.months);
    setSynced(data);
  }, [data]);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const cash = useMemo(() => cashByMonth(month, months, days, expenses), [month, months, days, expenses]);
  const current = cash.get(month)!;
  const previous = cash.get(shiftMonth(month, -1));

  const weeks: WeekInfo[] = useMemo(() => {
    const has = (d: string) => dayHasData(byDate.get(d));
    return monthWeeks(month).map((w) => {
      const shown = weekNights(w, has, (data?.eventDates ?? []).filter((d) => inRange(d, w.start, w.end)));
      const done = shown.filter(has);
      const missing = shown.filter((d) => !has(d) && d <= today);
      const state: WeekState = inRange(today, w.start, w.end) ? 'current' : w.start > today ? 'future' : missing.length ? 'missing' : 'done';
      const totals = computeTotals(
        days.filter((d) => inRange(d.date, w.start, w.end)),
        expenses.filter((e) => inRange(e.date, w.start, w.end)),
      );
      return { ...w, shown, done, missing, state, totals };
    });
  }, [month, byDate, days, expenses, data, today]);

  // ---------- Guardar ----------

  async function saveDay(date: string, values: DayValues | null) {
    const row = byDate.get(date);
    const empty = !values || !Object.keys(values).length;
    try {
      if (empty) {
        if (row) await api.ledgerDays.remove(row.id);
        setDays((list) => list.filter((d) => d.date !== date));
        return;
      }
      const saved = row ? await api.ledgerDays.update(row.id, { data: values }) : await api.ledgerDays.create({ date, data: values });
      setDays((list) => [...list.filter((d) => d.date !== date), saved]);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  async function saveExpense({ id, ...values }: ExpenseValues) {
    try {
      const saved = id ? await api.ledgerExpenses.update(id, values) : await api.ledgerExpenses.create(values);
      setExpenses((list) => (id ? list.map((e) => (e.id === id ? saved : e)) : [...list, saved]));
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  async function removeExpense(id: string) {
    try {
      await api.ledgerExpenses.remove(id);
      setExpenses((list) => list.filter((e) => e.id !== id));
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  async function saveMonth(patch: Partial<Pick<AdminLedgerMonth, 'cash_carry' | 'bank_carry' | 'cash_adjust' | 'bank_adjust' | 'note'>>) {
    const row = months.find((m) => m.month === month);
    try {
      const saved = row ? await api.ledgerMonths.update(row.id, patch) : await api.ledgerMonths.create({ month, ...patch });
      setMonths((list) => [...list.filter((m) => m.month !== month), saved]);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  /** La próxima noche por apuntar: la primera sin apuntar hasta hoy, o la de hoy */
  function recordNext() {
    const isNow = ledgerMonthOf(today) === month;
    const pending = weeks.flatMap((w) => w.missing.map((d) => ({ w, d })));
    const target = pending[0] ?? (isNow ? weeks.filter((w) => inRange(today, w.start, w.end)).map((w) => ({ w, d: today }))[0] : undefined);
    const w = target?.w ?? weeks.find((x) => x.state !== 'done') ?? weeks[0];
    go({ view: 'semana', week: w.start, night: target?.d });
  }

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || synced !== data) return <Loading />;

  const week = view === 'semana' ? weeks.find((w) => w.start === weekParam) ?? weeks[0] : null;
  const isNow = ledgerMonthOf(today) === month;

  const monthNav = (
    <div className="flex items-center justify-between gap-3 px-1">
      <h1 className="text-[30px] font-bold leading-tight tracking-[-0.025em]">
        {monthTitle(month)} <span className="font-normal text-ink-3">{month.slice(0, 4)}</span>
      </h1>
      <div className="flex gap-1.5">
        <button type="button" aria-label="Mes anterior" onClick={() => go({ month: shiftMonth(month, -1), view: view === 'año' ? 'año' : 'mes' })} className="grid h-9 w-9 place-items-center rounded-full bg-fill text-ink transition hover:bg-fill-2">
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
        <button type="button" aria-label="Mes siguiente" onClick={() => go({ month: shiftMonth(month, 1), view: view === 'año' ? 'año' : 'mes' })} className="grid h-9 w-9 place-items-center rounded-full bg-fill text-ink transition hover:bg-fill-2">
          <ChevronRight className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap items-start gap-6 lg:gap-8">
      <nav aria-label={`${monthTitle(month)} por semanas`} className={cx('w-full min-w-0 flex-col gap-4 lg:flex lg:w-[300px] lg:shrink-0', view === 'mes' ? 'flex' : 'hidden')}>
        {monthNav}
        <LedgerNav
          month={month}
          view={view}
          weeks={weeks}
          selectedWeek={week?.start ?? null}
          monthResult={current.totals.result}
          onOpen={(v, w) => go({ view: v, week: w })}
          days={days}
          expenses={expenses}
          months={months}
        />
      </nav>

      <div className="min-w-0 flex-1 basis-[560px]">
        {view !== 'mes' && (
          <button type="button" onClick={() => go({ view: 'mes' })} className="mb-4 flex items-center gap-1 text-[16px] font-medium text-accent lg:hidden">
            <ChevronLeft className="h-5 w-5" /> {monthTitle(month)}
          </button>
        )}

        {view === 'mes' && (
          <LedgerOverview
            month={month}
            cash={current}
            previous={previous}
            weeks={weeks}
            isNow={isNow}
            onOpenWeek={(w) => go({ view: 'semana', week: w })}
            onRecord={recordNext}
          />
        )}
        {view === 'semana' && week && (
          <LedgerWeek
            key={week.start}
            week={week}
            weeks={weeks}
            today={today}
            byDate={byDate}
            expenses={expenses}
            initialNight={nightParam}
            onSaveDay={saveDay}
            onSaveExpense={saveExpense}
            onRemoveExpense={removeExpense}
            onOpenWeek={(w) => go({ view: 'semana', week: w })}
          />
        )}
        {view === 'cierre' && <LedgerClose month={month} cash={current} row={months.find((m) => m.month === month) ?? null} onSave={saveMonth} />}
        {view === 'año' && (
          <LedgerYear
            year={Number(month.slice(0, 4))}
            onOpenMonth={(m) => go({ month: m })}
            onYear={(y) => go({ month: `${y}${month.slice(4)}`, view: 'año' })}
          />
        )}
      </div>
    </div>
  );
}

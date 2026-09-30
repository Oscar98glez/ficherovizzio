import { useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { ShiftForm } from '../../components/forms';
import { useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Button, Card, ErrorBox, Loading, PageHeader, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { businessDate, businessToday, daysBetween, isoDate, makePeriod, periodRange, shiftPeriod } from '../../lib/dates';
import { fmtHours, fmtMoney0, fmtTime, fmtWeekday } from '../../lib/format';
import type { Shift } from '../../lib/types';
import { byId, cx, fullName, groupBy, shiftHours, sumBy } from '../../lib/utils';

export default function Schedule() {
  const { toast, confirm } = useFeedback();
  const [period, setPeriod] = useState(() => makePeriod('week'));
  const [modal, setModal] = useState<{ shift: Shift | null; date?: string } | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [employees, shifts, events, availability] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.shifts.list({ gte: ['start_at', start], lt: ['start_at', end], order: ['start_at', 'asc'] }),
      api.events.list({ gte: ['date', period.from], lt: ['date', period.to] }),
      // Si aún no existe la tabla de disponibilidad, los turnos siguen funcionando
      api.availability.list({ gte: ['date', period.from], lt: ['date', period.to] }).catch(() => []),
    ]);
    return { employees, shifts, events, availability };
  }, [period]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const emps = byId(data.employees);
  const days = daysBetween(period.from, period.to);
  const byDay = groupBy(data.shifts, (s) => businessDate(s.start_at));
  const active = data.shifts.filter((s) => s.status !== 'cancelled');
  const hours = sumBy(active, shiftHours);
  const cost = sumBy(active, (s) => shiftHours(s) * (emps.get(s.employee_id)?.hourly_rate ?? 0));
  const today = isoDate(businessToday());

  async function copyPrevious() {
    const prev = shiftPeriod(period, -1);
    const { start, end } = periodRange(prev);
    const ok = await confirm({
      title: 'Copiar semana anterior',
      message: `Se duplicarán los turnos de ${prev.label} en esta semana.`,
      confirmLabel: 'Copiar',
    });
    if (!ok) return;
    try {
      const src = (await api.shifts.list({ gte: ['start_at', start], lt: ['start_at', end] })).filter((s) => s.status !== 'cancelled');
      if (!src.length) return toast.info('La semana anterior no tiene turnos');
      const week = 7 * 86_400_000;
      const eventByDate = new Map(data!.events.map((e) => [e.date, e.id]));
      await api.shifts.createMany(
        src.map((s) => {
          const start_at = new Date(Date.parse(s.start_at) + week).toISOString();
          return {
            employee_id: s.employee_id,
            start_at,
            end_at: new Date(Date.parse(s.end_at) + week).toISOString(),
            position: s.position,
            status: 'planned' as const,
            notes: s.notes,
            event_id: eventByDate.get(businessDate(start_at)) ?? null,
          };
        }),
      );
      toast.success(`${src.length} turnos copiados`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Turnos"
        subtitle="Planifica quién trabaja cada noche"
        actions={
          <>
            <Button variant="secondary" icon={<Copy />} onClick={copyPrevious}>
              <span className="hidden sm:inline">Copiar semana anterior</span>
              <span className="sm:hidden">Copiar</span>
            </Button>
            <Button icon={<Plus />} onClick={() => setModal({ shift: null })}>
              Nuevo turno
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} units={['week']} />
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3 lg:gap-4">
        <StatCard label="Turnos" value={active.length} />
        <StatCard label="Horas planificadas" value={fmtHours(hours)} />
        <StatCard label="Coste previsto" value={fmtMoney0(cost)} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-7 lg:gap-2.5">
        {days.map((d) => {
          const list = byDay[d] ?? [];
          const evs = data.events.filter((e) => e.date === d);
          const isToday = d === today;
          return (
            <Card key={d} className={cx('flex flex-col overflow-hidden lg:min-h-[340px]', isToday && 'ring-2 ring-accent')}>
              <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
                <div className="flex items-baseline gap-1.5">
                  <span className={cx('text-[12px] font-semibold uppercase', isToday ? 'text-accent' : 'text-ink-2')}>{fmtWeekday(d)}</span>
                  <span className={cx('text-[20px] font-semibold', isToday && 'text-accent')}>{Number(d.slice(8))}</span>
                  {data.availability.length > 0 && (
                    <span className="text-[11px] font-medium text-green" title="Personas disponibles ese día">
                      {data.availability.filter((a) => a.date === d && a.available).length} disp.
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setModal({ shift: null, date: d })}
                  className="grid h-7 w-7 place-items-center rounded-full text-accent hover:bg-accent/10"
                  aria-label="Añadir turno"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {evs.map((ev) => (
                <div key={ev.id} className="mx-2 mt-2 truncate rounded-md bg-purple/15 px-2 py-1 text-[12px] font-semibold text-purple">
                  {ev.name}
                </div>
              ))}
              <div className="flex flex-1 flex-col gap-1.5 p-2">
                {list.map((s) => {
                  const emp = emps.get(s.employee_id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setModal({ shift: s })}
                      className={cx(
                        'relative overflow-hidden rounded-lg bg-fill/70 py-1.5 pl-3 pr-2 text-left transition hover:bg-fill-2',
                        s.status === 'cancelled' && 'opacity-45',
                      )}
                    >
                      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: emp?.color }} />
                      <div className={cx('truncate text-[13px] font-medium', s.status === 'cancelled' && 'line-through')}>
                        {fullName(emp)}
                      </div>
                      <div className="tabular flex items-center justify-between gap-1 text-[11px] text-ink-2">
                        <span>
                          {fmtTime(s.start_at)}–{fmtTime(s.end_at)}
                        </span>
                        {s.status === 'confirmed' && <span className="h-1.5 w-1.5 rounded-full bg-green" title="Confirmado" />}
                      </div>
                    </button>
                  );
                })}
                {!list.length && !evs.length && <div className="py-3 text-center text-[12px] text-ink-3 lg:py-6">Libre</div>}
              </div>
              {list.length > 0 && (
                <div className="tabular border-t border-line px-3 py-1.5 text-[11px] text-ink-2">
                  {list.filter((s) => s.status !== 'cancelled').length} pers. ·{' '}
                  {fmtMoney0(sumBy(list.filter((s) => s.status !== 'cancelled'), (s) => shiftHours(s) * (emps.get(s.employee_id)?.hourly_rate ?? 0)))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <ShiftForm
        open={!!modal}
        onClose={() => setModal(null)}
        shift={modal?.shift}
        date={modal?.date}
        employees={data.employees}
        events={data.events}
        availability={data.availability}
        onSaved={reload}
      />
    </>
  );
}

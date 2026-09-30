import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, X } from 'lucide-react';
import { ShiftForm } from '../../components/forms';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { availabilityHours } from '../../lib/availability';
import { addDays, businessDate, businessToday, daysBetween, isoDate, makePeriod, periodRange } from '../../lib/dates';
import { fmtWeekday, fmtShiftTimes } from '../../lib/format';
import type { Availability as AvailabilityRow, Shift } from '../../lib/types';
import { cx, fullName } from '../../lib/utils';

type Modal = { shift: Shift | null; date: string; employeeIds?: string[] } | null;

export default function Availability() {
  const navigate = useNavigate();
  // Por defecto la semana que viene, que es la que se planifica
  const [period, setPeriod] = useState(() => makePeriod('week', addDays(businessToday(), 7)));
  const [modal, setModal] = useState<Modal>(null);
  const days = useMemo(() => daysBetween(period.from, period.to), [period]);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [employees, availability, shifts, events] = await Promise.all([
      api.employees.list({ eq: { active: true }, order: ['first_name', 'asc'] }),
      api.availability.list({ gte: ['date', period.from], lt: ['date', period.to] }),
      api.shifts.list({ gte: ['start_at', start], lt: ['start_at', end] }),
      api.events.list({ gte: ['date', period.from], lt: ['date', period.to] }),
    ]);
    return { employees, availability, shifts: shifts.filter((s) => s.status !== 'cancelled'), events };
  }, [period]);

  const index = useMemo(() => {
    const avail = new Map<string, AvailabilityRow>();
    const shifts = new Map<string, Shift>();
    for (const a of data?.availability ?? []) avail.set(`${a.employee_id}|${a.date}`, a);
    for (const s of data?.shifts ?? []) shifts.set(`${s.employee_id}|${businessDate(s.start_at)}`, s);
    return { avail, shifts };
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const responded = data.employees.filter((e) => days.some((d) => index.avail.has(`${e.id}|${d}`))).length;
  const pending = data.employees.length - responded;
  const today = isoDate(businessToday());
  const availableOn = (d: string) => data.employees.filter((e) => index.avail.get(`${e.id}|${d}`)?.available).length;
  const shiftsOn = (d: string) => data.employees.filter((e) => index.shifts.has(`${e.id}|${d}`)).length;

  return (
    <>
      <PageHeader
        title="Disponibilidad"
        subtitle="Qué días puede trabajar cada persona. Pulsa una casilla para asignarle el turno."
        actions={
          <Button variant="secondary" icon={<CalendarDays />} onClick={() => navigate('/turnos')}>
            Ver turnos
          </Button>
        }
      />

      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} units={['week']} />
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3 lg:gap-4">
        <StatCard label="Han respondido" value={`${responded} / ${data.employees.length}`} />
        <StatCard label="Sin responder" value={<span className={pending ? 'text-orange' : ''}>{pending}</span>} />
        <StatCard label="Turnos asignados" value={data.shifts.length} />
      </div>

      {data.employees.length ? (
        <Card className="overflow-x-auto">
          <div className="min-w-[860px]">
            {/* Cabecera con los días */}
            <div className="grid grid-cols-[minmax(180px,1.3fr)_repeat(7,minmax(88px,1fr))] border-b border-line">
              <div className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Persona</div>
              {days.map((d) => {
                const ev = data.events.find((e) => e.date === d);
                return (
                  <div key={d} className={cx('px-2 py-2.5 text-center', d === today && 'bg-accent/10')}>
                    <div className={cx('text-[12px] font-semibold uppercase', d === today ? 'text-accent' : 'text-ink-2')}>
                      {fmtWeekday(d)} {Number(d.slice(8))}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-3" title={ev?.name}>
                      {ev?.name ?? ' '}
                    </div>
                    <div className="mt-1 text-[11px] font-medium">
                      <span className="text-green">{availableOn(d)} disp.</span>
                      {shiftsOn(d) > 0 && <span className="text-accent"> · {shiftsOn(d)} turno{shiftsOn(d) > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Filas por persona */}
            <div className="divide-y divide-line">
              {data.employees.map((e) => {
                const answered = days.some((d) => index.avail.has(`${e.id}|${d}`));
                return (
                  <div key={e.id} className="grid grid-cols-[minmax(180px,1.3fr)_repeat(7,minmax(88px,1fr))] items-stretch">
                    <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
                      <Avatar name={fullName(e)} color={e.color} size={32} />
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium">{fullName(e)}</div>
                        {answered ? (
                          <div className="truncate text-[12px] text-ink-2">{e.position}</div>
                        ) : (
                          <Badge tone="orange" className="mt-0.5 !px-2 !py-0 !text-[11px]">
                            Sin responder
                          </Badge>
                        )}
                      </div>
                    </div>
                    {days.map((d) => {
                      const a = index.avail.get(`${e.id}|${d}`);
                      const s = index.shifts.get(`${e.id}|${d}`);
                      return (
                        <div key={d} className={cx('p-1', d === today && 'bg-accent/5')}>
                          <button
                            type="button"
                            title={[a?.note, s ? 'Pulsa para editar el turno' : 'Pulsa para asignar turno'].filter(Boolean).join(' · ')}
                            onClick={() => setModal(s ? { shift: s, date: d } : { shift: null, date: d, employeeIds: [e.id] })}
                            className={cx(
                              'flex h-full min-h-[52px] w-full flex-col items-center justify-center rounded-lg px-1 text-center transition hover:brightness-95 active:scale-[0.97]',
                              s
                                ? 'bg-accent text-on-accent'
                                : !a
                                  ? 'bg-fill/60 text-ink-3 hover:bg-fill'
                                  : a.available
                                    ? 'bg-green/15 text-green'
                                    : 'bg-red/10 text-red',
                            )}
                          >
                            {s ? (
                              <>
                                <span className="text-[11px] font-semibold uppercase">Turno</span>
                                <span className="tabular text-[12px] font-medium">
                                  {fmtShiftTimes(s)}
                                </span>
                              </>
                            ) : !a ? (
                              <span className="text-[13px]">—</span>
                            ) : a.available ? (
                              <>
                                <Check className="h-4 w-4" strokeWidth={2.6} />
                                <span className="text-[11px] font-medium leading-tight">{availabilityHours(a)}</span>
                              </>
                            ) : (
                              <>
                                <X className="h-4 w-4" strokeWidth={2.6} />
                                <span className="text-[11px] font-medium">No</span>
                              </>
                            )}
                            {a?.note && !s && <span className="mt-0.5 h-1 w-1 rounded-full bg-current opacity-60" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState title="No hay personal activo" message="Da de alta a tu equipo en Personal para ver su disponibilidad." />
        </Card>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-green/40" /> Disponible
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-red/30" /> No disponible
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-fill-2" /> Sin indicar
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-accent" /> Turno asignado
        </span>
        <span>· El punto indica que hay una nota (pasa el ratón por encima).</span>
      </div>

      <ShiftForm
        open={!!modal}
        onClose={() => setModal(null)}
        shift={modal?.shift}
        date={modal?.date}
        employeeIds={modal?.employeeIds}
        employees={data.employees}
        events={data.events}
        availability={data.availability}
        onSaved={reload}
      />
    </>
  );
}

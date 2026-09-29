import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Fingerprint, LogIn, LogOut, UserX } from 'lucide-react';
import { useAuth } from '../../auth';
import { useFeedback } from '../../components/overlay';
import { Card, CardHeader, EmptyState, ErrorBox, ListRow, Loading, StatCard } from '../../components/ui';
import { useLoad, useNow } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { addDays, businessDate, businessStart, businessToday, isoDate, makePeriod, periodRange } from '../../lib/dates';
import { fmtDate, fmtDateFull, fmtDateLong, fmtDuration, fmtDurationShort, fmtHours, fmtMoney, fmtTime } from '../../lib/format';
import { cx, entryCost, entryHours, sumBy } from '../../lib/utils';

export function NotLinked() {
  return (
    <Card className="mx-auto mt-10 max-w-md">
      <EmptyState
        icon={<UserX />}
        title="Cuenta sin vincular"
        message="Tu usuario todavía no está asociado a una ficha de empleado. Pide a tu responsable que te dé de alta con el mismo email con el que te registraste."
      />
    </Card>
  );
}

export default function Clock() {
  const { employee } = useAuth();
  if (!employee) return <NotLinked />;
  return <ClockInner employeeId={employee.id} firstName={employee.first_name} active={employee.active} />;
}

function ClockInner({ employeeId, firstName, active }: { employeeId: string; firstName: string; active: boolean }) {
  const { toast, confirm } = useFeedback();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const week = useMemo(() => makePeriod('week'), []);
  const month = useMemo(() => makePeriod('month'), []);

  const { data, loading, error, reload } = useLoad(async () => {
    const from = [week.from, month.from].sort()[0];
    const today = isoDate(businessToday());
    const [entries, shifts] = await Promise.all([
      api.timeEntries.list({ eq: { employee_id: employeeId }, gte: ['clock_in', businessStart(from)], order: ['clock_in', 'desc'] }),
      api.shifts.list({ eq: { employee_id: employeeId }, gte: ['start_at', businessStart(today)], lt: ['start_at', businessStart(isoDate(addDays(businessToday(), 30)))], order: ['start_at', 'asc'] }),
    ]);
    const openEntries = entries.some((e) => !e.clock_out) ? [] : await api.timeEntries.list({ eq: { employee_id: employeeId, clock_out: null } });
    return { entries: [...openEntries, ...entries], shifts: shifts.filter((s) => s.status !== 'cancelled') };
  }, [employeeId]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const open = data.entries.find((e) => !e.clock_out);
  const inRange = (p: typeof week) => {
    const { start, end } = periodRange(p);
    return data.entries.filter((e) => e.clock_in >= start && e.clock_in < end);
  };
  const weekEntries = inRange(week);
  const monthEntries = inRange(month);
  const nextShift = data.shifts[0];
  const todayShift = nextShift && businessDate(nextShift.start_at) === isoDate(businessToday()) ? nextShift : null;
  const elapsed = open ? now - Date.parse(open.clock_in) : 0;

  async function toggle() {
    if (open) {
      const ok = await confirm({ title: '¿Fichar salida?', message: `Llevas ${fmtDurationShort(elapsed)} trabajando.`, confirmLabel: 'Fichar salida' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const entry = open ? await api.clockOut() : await api.clockIn();
      toast.success(open ? `Salida registrada a las ${fmtTime(entry.clock_out!)}` : `Entrada registrada a las ${fmtTime(entry.clock_in)}`);
      if ('vibrate' in navigator) navigator.vibrate?.(30);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const hour = new Date(now).getHours();
  const greeting = hour < 6 ? 'Buenas noches' : hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <p className="text-[15px] font-medium text-ink-2">{fmtDateFull(new Date(now))}</p>
        <h1 className="text-[30px] font-bold tracking-tight md:text-[34px]">
          {greeting}, {firstName}
        </h1>
      </header>

      <Card className="relative overflow-hidden px-6 pb-8 pt-7 text-center">
        <div
          className={cx('pointer-events-none absolute inset-0 opacity-60 transition-colors duration-700', open ? 'bg-gradient-to-b from-green/15 to-transparent' : 'bg-gradient-to-b from-accent/10 to-transparent')}
        />
        <div className="relative">
          <div className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold', open ? 'bg-green/15 text-green' : 'bg-fill text-ink-2')}>
            <span className={cx('h-2 w-2 rounded-full', open ? 'bg-green' : 'bg-ink-3')} />
            {open ? `En turno desde las ${fmtTime(open.clock_in)}` : 'Fuera de turno'}
          </div>

          <div className="tabular mt-5 text-[64px] font-light leading-none tracking-tight md:text-[76px]">
            {open ? fmtDuration(elapsed) : new Date(now).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="tabular mt-2 h-5 text-[15px] text-ink-2">
            {open ? `${fmtMoney(entryCost(open, now))} generados en este turno` : todayShift ? `Tu turno de hoy: ${fmtTime(todayShift.start_at)} – ${fmtTime(todayShift.end_at)}` : ''}
          </div>

          <div className="relative mx-auto mt-8 h-44 w-44">
            {open && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-red/40" />}
            <button
              onClick={toggle}
              disabled={busy || (!open && !active)}
              className={cx(
                'relative grid h-44 w-44 place-items-center rounded-full text-white shadow-[0_18px_40px_-10px_rgba(0,0,0,0.35)] transition-all duration-200 active:scale-95 disabled:opacity-50',
                open ? 'bg-gradient-to-b from-[#ff5e57] to-[#e0241b]' : 'bg-gradient-to-b from-[#34d15c] to-[#1fa23f]',
              )}
            >
              <span className="flex flex-col items-center gap-2">
                {open ? <LogOut className="h-10 w-10" strokeWidth={1.8} /> : <Fingerprint className="h-11 w-11" strokeWidth={1.6} />}
                <span className="text-[17px] font-semibold">{busy ? 'Un momento…' : open ? 'Fichar salida' : 'Fichar entrada'}</span>
              </span>
            </button>
          </div>
          {!active && <p className="mt-4 text-[13px] text-red">Tu ficha está inactiva. Contacta con tu responsable.</p>}
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard label="Esta semana" value={fmtHours(sumBy(weekEntries, (e) => entryHours(e, now)))} sub={fmtMoney(sumBy(weekEntries, (e) => entryCost(e, now)))} />
        <StatCard label={month.label} value={fmtHours(sumBy(monthEntries, (e) => entryHours(e, now)))} sub={fmtMoney(sumBy(monthEntries, (e) => entryCost(e, now)))} />
      </div>

      {nextShift && !todayShift && (
        <Link to="/mis-turnos">
          <Card className="mt-4 flex items-center gap-4 p-4 transition hover:bg-fill/40">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-ink-2">Próximo turno</div>
              <div className="truncate text-[16px] font-semibold capitalize">
                {fmtDate(businessDate(nextShift.start_at), { weekday: 'short', day: 'numeric', month: 'short' })}
              </div>
            </div>
            <div className="tabular text-right text-[15px] font-medium">
              {fmtTime(nextShift.start_at)} – {fmtTime(nextShift.end_at)}
            </div>
          </Card>
        </Link>
      )}

      <Card className="mt-4">
        <CardHeader
          title="Últimos fichajes"
          action={
            <Link to="/mis-horas" className="text-[14px] font-medium text-accent">
              Ver todo
            </Link>
          }
        />
        {data.entries.length ? (
          <div className="divide-y divide-line pb-2">
            {data.entries.slice(0, 5).map((e) => (
              <ListRow
                key={e.id}
                leading={
                  <span className={cx('grid h-9 w-9 place-items-center rounded-full', e.clock_out ? 'bg-fill text-ink-2' : 'bg-green/15 text-green')}>
                    <LogIn className="h-4 w-4" />
                  </span>
                }
                title={fmtDateLong(businessDate(e.clock_in))}
                subtitle={`${fmtTime(e.clock_in)} – ${e.clock_out ? fmtTime(e.clock_out) : 'en curso'}`}
                trailing={<span className="tabular text-[15px] font-semibold">{fmtHours(entryHours(e, now))}</span>}
              />
            ))}
          </div>
        ) : (
          <p className="px-5 pb-5 text-[14px] text-ink-2">Aún no has fichado ningún turno.</p>
        )}
      </Card>
    </div>
  );
}

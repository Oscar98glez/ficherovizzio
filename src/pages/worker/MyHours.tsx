import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useAuth } from '../../auth';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard } from '../../components/ui';
import { useLoad, useNow } from '../../hooks';
import { api } from '../../lib/api';
import { businessDate, makePeriod, periodRange, type PeriodUnit } from '../../lib/dates';
import { fmtDateLong, fmtHours, fmtMoney, fmtTime } from '../../lib/format';
import { cx, entryHours, sumBy } from '../../lib/utils';
import { NotLinked } from './Clock';

const UNITS: PeriodUnit[] = ['week', 'month', 'year'];
const UNIT_KEY = 'vizzio.mis-horas.unit';

/** Cada trabajador elige si ve sus horas por semana, mes o año; se recuerda en este dispositivo */
const savedUnit = (): PeriodUnit => {
  try {
    const v = localStorage.getItem(UNIT_KEY) as PeriodUnit | null;
    return v && UNITS.includes(v) ? v : 'month';
  } catch {
    return 'month';
  }
};

export default function MyHours() {
  const { employee, isRrpp } = useAuth();
  const now = useNow(30_000);
  const [period, setPeriodState] = useState(() => makePeriod(savedUnit()));
  const setPeriod = (p: typeof period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(UNIT_KEY, p.unit);
    } catch {
      /* sin almacenamiento */
    }
  };

  const { data, loading, error, reload } = useLoad(async () => {
    if (!employee) return [];
    const { start, end } = periodRange(period);
    return api.myTimeEntries({ eq: { employee_id: employee.id }, gte: ['clock_in', start], lt: ['clock_in', end], order: ['clock_in', 'desc'] });
  }, [period, employee?.id]);

  if (!employee) return <NotLinked />;
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const entries = data ?? [];
  const hours = sumBy(entries, (e) => entryHours(e, now));
  const nights = new Set(entries.map((e) => businessDate(e.clock_in))).size;
  // Lo ganado viene calculado del servidor (la tarifa no llega al móvil). Los RRPP cobran por comisiones, no por horas.
  const showMoney = !isRrpp && entries.some((e) => e.earned !== undefined);
  const earned = sumBy(entries, (e) => e.earned ?? 0);
  const open = entries.some((e) => !e.clock_out);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Mis horas" subtitle="Tus fichajes y las horas que has trabajado" />
      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} units={UNITS} />
      </div>
      <div className={cx('mb-5 grid gap-3', showMoney ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
        {showMoney && <StatCard label="Ganado" value={fmtMoney(earned)} sub={open ? 'Sin contar el turno en curso' : undefined} />}
        <StatCard label="Horas" value={fmtHours(hours)} />
        <StatCard label="Noches" value={nights} />
        <StatCard label="Media por noche" value={nights ? fmtHours(hours / nights) : '—'} />
      </div>

      <Card className="divide-y divide-line overflow-hidden">
        {entries.length ? (
          entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[15px] font-medium">
                  {fmtDateLong(businessDate(e.clock_in))}
                  {!e.clock_out && <Badge tone="green">En curso</Badge>}
                </div>
                <div className="tabular text-[13px] text-ink-2">
                  {fmtTime(e.clock_in)} – {e.clock_out ? fmtTime(e.clock_out) : '…'}
                  {e.break_minutes > 0 && ` · pausa ${e.break_minutes} min`}
                </div>
              </div>
              <div className="tabular text-right">
                {showMoney && e.earned != null ? (
                  <>
                    <div className="text-[15px] font-semibold">{fmtMoney(e.earned)}</div>
                    <div className="text-[13px] text-ink-2">{fmtHours(entryHours(e, now))}</div>
                  </>
                ) : (
                  <div className="text-[15px] font-semibold">{fmtHours(entryHours(e, now))}</div>
                )}
              </div>
            </div>
          ))
        ) : (
          <EmptyState icon={<Clock />} title="Sin fichajes en este periodo" />
        )}
      </Card>
    </div>
  );
}

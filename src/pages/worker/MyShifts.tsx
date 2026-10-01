import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../../auth';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { SHIFT_STATUS } from '../../lib/constants';
import { addDays, businessDate, businessStart, businessToday, isoDate } from '../../lib/dates';
import { fmtDate, fmtHours, fmtWeekday, fmtShiftTimes } from '../../lib/format';
import { byId, cx, shiftHours } from '../../lib/utils';
import { NotLinked } from './Clock';

export default function MyShifts() {
  const { employee } = useAuth();
  const [tab, setTab] = useState<'next' | 'past'>('next');

  const { data, loading, error, reload } = useLoad(async () => {
    if (!employee) return null;
    const today = isoDate(businessToday());
    const q =
      tab === 'next'
        ? { gte: ['start_at', businessStart(today)] as [string, string], order: ['start_at', 'asc'] as ['start_at', 'asc'] }
        : { gte: ['start_at', businessStart(isoDate(addDays(businessToday(), -60)))] as [string, string], lt: ['start_at', businessStart(today)] as [string, string], order: ['start_at', 'desc'] as ['start_at', 'desc'] };
    const [shifts, events] = await Promise.all([
      api.shifts.list({ eq: { employee_id: employee.id }, ...q }),
      api.events.list({ gte: ['date', isoDate(addDays(businessToday(), -60))] }),
    ]);
    return { shifts, events };
  }, [employee?.id, tab]);

  if (!employee) return <NotLinked />;

  const events = byId(data?.events ?? []);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Mis turnos" subtitle="Tu calendario de trabajo" />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'next', label: 'Próximos' },
            { value: 'past', label: 'Anteriores' },
          ]}
        />
      </div>

      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : data?.shifts.length ? (
        <div className="space-y-3">
          {data.shifts.map((s) => {
            const date = businessDate(s.start_at);
            const ev = s.event_id ? events.get(s.event_id) : null;
            return (
              <Card key={s.id} className={cx('flex items-center gap-4 p-4', s.status === 'cancelled' && 'opacity-50')}>
                <div className="w-14 shrink-0 rounded-xl bg-fill/70 py-2 text-center leading-none">
                  <div className="text-[11px] font-semibold uppercase text-red">{fmtWeekday(date)}</div>
                  <div className="mt-1 text-[24px] font-semibold">{Number(date.slice(8))}</div>
                  <div className="mt-0.5 text-[11px] text-ink-2">{fmtDate(date, { month: 'short' }).replace('.', '')}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold">{ev?.name ?? s.position ?? 'Turno'}</div>
                  <div className="tabular text-[14px] text-ink-2">
                    {fmtShiftTimes(s)}
                    {s.end_at && ` · ${fmtHours(shiftHours(s))}`}
                  </div>
                  {s.notes && <div className="mt-1 text-[13px] text-ink-2">{s.notes}</div>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={SHIFT_STATUS[s.status].tone}>{SHIFT_STATUS[s.status].label}</Badge>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<CalendarDays />} title={tab === 'next' ? 'Sin turnos asignados' : 'Sin turnos anteriores'} message={tab === 'next' ? 'Cuando tu responsable te asigne turnos aparecerán aquí.' : undefined} />
        </Card>
      )}
    </div>
  );
}

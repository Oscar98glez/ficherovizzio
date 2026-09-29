import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useAuth } from '../../auth';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard } from '../../components/ui';
import { useLoad, useNow } from '../../hooks';
import { api } from '../../lib/api';
import { businessDate, makePeriod, periodRange } from '../../lib/dates';
import { fmtDateLong, fmtHours, fmtMoney, fmtTime } from '../../lib/format';
import { entryCost, entryHours, sumBy } from '../../lib/utils';
import { NotLinked } from './Clock';

export default function MyHours() {
  const { employee } = useAuth();
  const now = useNow(30_000);
  const [period, setPeriod] = useState(() => makePeriod('month'));

  const { data, loading, error, reload } = useLoad(async () => {
    if (!employee) return [];
    const { start, end } = periodRange(period);
    return api.timeEntries.list({ eq: { employee_id: employee.id }, gte: ['clock_in', start], lt: ['clock_in', end], order: ['clock_in', 'desc'] });
  }, [period, employee?.id]);

  if (!employee) return <NotLinked />;
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const entries = data ?? [];
  const hours = sumBy(entries, (e) => entryHours(e, now));
  const earned = sumBy(entries, (e) => entryCost(e, now));
  const nights = new Set(entries.map((e) => businessDate(e.clock_in))).size;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Mis horas" subtitle={`Tarifa actual ${fmtMoney(employee.hourly_rate)}/h`} />
      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} units={['week', 'month']} />
      </div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatCard label="Horas" value={fmtHours(hours)} />
        <StatCard label="Noches" value={nights} />
        <StatCard label="Importe bruto" value={fmtMoney(earned)} tone="green" />
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
                <div className="text-[15px] font-semibold">{fmtHours(entryHours(e, now))}</div>
                <div className="text-[12px] text-ink-2">{fmtMoney(entryCost(e, now))}</div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState icon={<Clock />} title="Sin fichajes en este periodo" />
        )}
      </Card>
      <p className="mt-3 px-1 text-[12px] text-ink-3">Importe orientativo calculado con tu tarifa por hora. No incluye retenciones ni cotizaciones.</p>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, Plus, Users } from 'lucide-react';
import { EventForm } from '../../components/finance-forms';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { EVENT_KINDS } from '../../lib/constants';
import { addDays, businessDate, businessStart, businessToday, isoDate } from '../../lib/dates';
import { fmtDate, fmtMoney0, fmtNum, fmtWeekday, fmtMoneyExact } from '../../lib/format';
import { cx, entryCost, groupBy, sumBy } from '../../lib/utils';

type Tab = 'upcoming' | 'past';

export default function Events() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [creating, setCreating] = useState(false);
  const today = isoDate(businessToday());

  const { data, loading, error, reload } = useLoad(async () => {
    const from = isoDate(addDays(businessToday(), -90));
    const to = isoDate(addDays(businessToday(), 120));
    const [events, entries, tx, shifts, employees] = await Promise.all([
      api.events.list({ gte: ['date', from], lt: ['date', to], order: ['date', 'asc'] }),
      api.timeEntries.list({ gte: ['clock_in', businessStart(from)], lt: ['clock_in', businessStart(today)] }),
      api.transactions.list({ gte: ['date', from], lt: ['date', to] }),
      api.shifts.list({ gte: ['start_at', businessStart(today)], lt: ['start_at', businessStart(to)] }),
      api.employees.list(),
    ]);
    return { events, entries, tx, shifts, employees };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const entriesByDate = groupBy(data.entries, (e) => businessDate(e.clock_in));
    const shiftsByDate = groupBy(data.shifts.filter((s) => s.status !== 'cancelled'), (s) => businessDate(s.start_at));
    const txByEvent = groupBy(data.tx.filter((t) => t.event_id), (t) => t.event_id!);
    return data.events
      .filter((e) => (tab === 'upcoming' ? e.date >= today : e.date < today))
      .sort((a, b) => (tab === 'upcoming' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))
      .map((ev) => {
        const t = txByEvent[ev.id] ?? [];
        const income = sumBy(t.filter((x) => x.kind === 'income'), (x) => x.amount);
        const expenses = sumBy(t.filter((x) => x.kind === 'expense'), (x) => x.amount);
        const staff = sumBy(entriesByDate[ev.date] ?? [], (e) => entryCost(e));
        const planned = shiftsByDate[ev.date] ?? [];
        return { ev, income, result: income - expenses - staff, staffCount: planned.length };
      });
  }, [data, tab, today]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title="Noches"
        subtitle="Sesiones, eventos y su rentabilidad"
        actions={
          <Button icon={<Plus />} onClick={() => setCreating(true)}>
            Nueva noche
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Próximas' },
            { value: 'past', label: 'Últimos 90 días' },
          ]}
        />
      </div>

      {rows.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map(({ ev, income, result, staffCount }) => (
            <Card
              key={ev.id}
              role="button"
              onClick={() => navigate(`/noches/${ev.id}`)}
              className="flex cursor-pointer items-center gap-4 p-4 transition hover:scale-[1.005] active:scale-[0.995]"
            >
              <div className="w-14 shrink-0 rounded-xl bg-fill/70 py-2 text-center leading-none">
                <div className="text-[11px] font-semibold uppercase text-red">{fmtWeekday(ev.date)}</div>
                <div className="mt-1 text-[24px] font-semibold">{Number(ev.date.slice(8))}</div>
                <div className="mt-0.5 text-[11px] text-ink-2">{fmtDate(ev.date, { month: 'short' }).replace('.', '')}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-semibold">{ev.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                  <Badge tone={EVENT_KINDS[ev.kind].tone}>{EVENT_KINDS[ev.kind].label}</Badge>
                  {ev.expected_attendance != null && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {fmtNum(ev.expected_attendance, 0)}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {tab === 'past' ? (
                  <>
                    <div className={cx('tabular text-[17px] font-semibold', result >= 0 ? 'text-green' : 'text-red')}>
                      {result >= 0 ? '+' : ''}
                      {fmtMoneyExact(result)}
                    </div>
                    <div className="tabular text-[12px] text-ink-2">{fmtMoney0(income)} ingresos</div>
                  </>
                ) : (
                  <>
                    <div className="tabular text-[17px] font-semibold">{staffCount} pers.</div>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<PartyPopper />}
            title={tab === 'upcoming' ? 'No hay noches programadas' : 'Sin noches recientes'}
            message="Crea una noche para asociarle turnos, fichajes y el cierre de caja."
            action={<Button icon={<Plus />} onClick={() => setCreating(true)}>Nueva noche</Button>}
          />
        </Card>
      )}

      <EventForm open={creating} onClose={() => setCreating(false)} onSaved={(e) => navigate(`/noches/${e.id}`)} />
    </>
  );
}

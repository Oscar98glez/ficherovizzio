import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, Plus, QrCode, Sofa, Ticket, Users } from 'lucide-react';
import { EventForm } from '../../components/finance-forms';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { EVENT_KINDS } from '../../lib/constants';
import { addDays, businessDate, businessStart, businessToday, isoDate } from '../../lib/dates';
import { fmtDate, fmtNum, fmtWeekday } from '../../lib/format';
import { autoSyncFourvenues } from '../../lib/fourvenues';
import type { ReservationStatus } from '../../lib/types';
import { groupBy } from '../../lib/utils';

/** Reservados que cuentan para la noche (sin cancelados ni los que no se presentaron) */
const LIVE_RESERVATION: ReservationStatus[] = ['pending', 'confirmed', 'arrived'];

type Tab = 'upcoming' | 'past';

export default function Events() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [creating, setCreating] = useState(false);
  const today = isoDate(businessToday());

  const { data, loading, error, reload } = useLoad(async () => {
    const from = isoDate(addDays(businessToday(), -90));
    const to = isoDate(addDays(businessToday(), 120));
    const [events, shifts, reservations] = await Promise.all([
      api.events.list({ gte: ['date', from], lt: ['date', to], order: ['date', 'asc'] }),
      api.shifts.list({ gte: ['start_at', businessStart(today)], lt: ['start_at', businessStart(to)] }),
      api.reservations.list({ gte: ['date', from], lt: ['date', to] }).catch(() => []),
    ]);
    return { events, shifts, reservations };
  }, []);

  // Trae de Fourvenues las noches y la venta online (el servidor no lo repite si se hizo hace poco)
  useEffect(() => {
    autoSyncFourvenues().then((changed) => changed && reload());
  }, [reload]);

  const rows = useMemo(() => {
    if (!data) return [];
    const shiftsByDate = groupBy(data.shifts.filter((s) => s.status !== 'cancelled'), (s) => businessDate(s.start_at));
    const reservationsByDate = groupBy(data.reservations.filter((r) => LIVE_RESERVATION.includes(r.status)), (r) => r.date);
    return data.events
      .filter((e) => (tab === 'upcoming' ? e.date >= today : e.date < today))
      .sort((a, b) => (tab === 'upcoming' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))
      .map((ev) => ({ ev, reservations: reservationsByDate[ev.date]?.length ?? 0, staffCount: shiftsByDate[ev.date]?.length ?? 0 }));
  }, [data, tab, today]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title="Noches"
        subtitle="Sesiones y eventos: entradas vendidas, QR gratis y reservados"
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
          {rows.map(({ ev, reservations, staffCount }) => (
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
                    <span className="flex items-center gap-1" title="Aforo previsto">
                      <Users className="h-3.5 w-3.5" /> {fmtNum(ev.expected_attendance, 0)}
                    </span>
                  )}
                  {tab === 'upcoming' && staffCount > 0 && <span>{staffCount} pers. de turno</span>}
                </div>
                <div className="tabular mt-2 grid grid-cols-3 gap-1.5 text-center">
                  <Stat icon={<Ticket />} value={ev.tickets_paid ?? ev.tickets_sold} label="vendidas" />
                  <Stat icon={<QrCode />} value={ev.tickets_free} label="QR gratis" />
                  <Stat icon={<Sofa />} value={reservations} label={reservations === 1 ? 'reservado' : 'reservados'} />
                </div>
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

/** Cifra de la noche: entradas vendidas, QR gratis o reservados ("—" si aún no hay dato de Fourvenues) */
function Stat({ icon, value, label }: { icon: ReactNode; value: number | null | undefined; label: string }) {
  return (
    <div className="rounded-lg bg-fill/60 px-1 py-1.5">
      <div className="flex items-center justify-center gap-1 text-[15px] font-semibold [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-ink-2">
        {icon}
        {value == null ? '—' : fmtNum(value, 0)}
      </div>
      <div className="text-[11px] text-ink-2">{label}</div>
    </div>
  );
}

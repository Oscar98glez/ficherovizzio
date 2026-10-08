import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Pencil, RefreshCw } from 'lucide-react';
import { EventForm } from '../../components/finance-forms';
import { useFeedback } from '../../components/overlay';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Loading, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { IS_DEMO } from '../../lib/config';
import { EVENT_KINDS } from '../../lib/constants';
import { addDays, businessToday, isoDate } from '../../lib/dates';
import { fmtDate, fmtDateFull, fmtNum, fmtTime } from '../../lib/format';
import { syncFourvenues } from '../../lib/fourvenues';
import type { Employee, FourvenuesRrppNight } from '../../lib/types';
import { cx, fullName, sumBy } from '../../lib/utils';

/** La noche: sólo lo que viene de Fourvenues (entradas, listas y reservados, en total y por RRPP) */
export default function EventDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const event = await api.events.get(id);
    if (!event) return null;
    const [rrppNights, employees] = await Promise.all([
      event.fourvenues_id ? api.fourvenuesRrppNights.list({ eq: { event_id: id } }).catch(() => [] as FourvenuesRrppNight[]) : ([] as FourvenuesRrppNight[]),
      api.employees.list(),
    ]);
    return { event, rrppNights, employees };
  }, [id]);

  async function sync() {
    setSyncing(true);
    try {
      // La sincronización normal repasa la última semana: si la noche es más antigua, se trae desde ella
      const weekAgo = isoDate(addDays(businessToday(), -7));
      const r = await syncFourvenues(data && data.event.date < weekAgo ? data.event.date : undefined);
      const warnings = r.result?.warnings ?? [];
      if (r.running) toast.info('Ya hay una sincronización en curso. Prueba en un minuto.');
      else if (warnings.length) warnings.forEach((w) => toast.error(w));
      else toast.success('Datos de Fourvenues actualizados');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <EmptyState title="Noche no encontrada" action={<Link to="/noches" className="text-accent">Volver</Link>} />;

  const { event: ev } = data;
  const synced = !!ev.fourvenues_id;

  return (
    <>
      <Link to="/noches" className="mb-4 inline-flex items-center gap-0.5 text-[15px] text-accent hover:opacity-70">
        <ChevronLeft className="h-5 w-5" /> Noches
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={EVENT_KINDS[ev.kind].tone}>{EVENT_KINDS[ev.kind].label}</Badge>
            {synced && ev.fourvenues_synced_at && (
              <span className="text-[13px] text-ink-2">
                Fourvenues · actualizado el {fmtDate(ev.fourvenues_synced_at)}, {fmtTime(ev.fourvenues_synced_at)}
              </span>
            )}
          </div>
          <h1 className="text-[30px] font-bold tracking-tight md:text-[34px]">{ev.name}</h1>
          <p className="text-[15px] text-ink-2">{fmtDateFull(ev.date)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
            Editar
          </Button>
          {!IS_DEMO && (
            <Button icon={<RefreshCw />} loading={syncing} onClick={sync}>
              Sincronizar con Fourvenues
            </Button>
          )}
        </div>
      </div>

      {synced ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
            <StatCard label="Entradas vendidas" value={num(ev.tickets_paid ?? ev.tickets_sold)} sub="De pago, por cualquier canal" />
            <StatCard label="QR gratis" value={num(ev.tickets_free)} sub={ev.tickets_free == null ? 'Sin acceso a las listas' : 'Personas en las listas'} />
            <StatCard label="Reservados" value={num(ev.bookings)} sub={ev.bookings == null ? 'Sin acceso a las reservas' : 'Reservas de mesa'} />
            <StatCard label="Dentro" value={num(ev.tickets_entered)} sub="Personas que han entrado" />
          </div>
          <RrppBreakdown rows={data.rrppNights} employees={data.employees} />
        </>
      ) : (
        <Card>
          <EmptyState
            title="Esta noche no está en Fourvenues"
            message="Las noches se crean y se rellenan solas al sincronizar con Fourvenues (Ajustes → Fourvenues). Esta se creó a mano y no tiene evento asociado."
          />
        </Card>
      )}

      <EventForm open={editing} onClose={() => setEditing(false)} event={ev} onSaved={reload} onDeleted={() => navigate('/noches')} />
    </>
  );
}

const num = (v: number | null | undefined) => (v == null ? '—' : fmtNum(v, 0));

/**
 * Por RRPP, con el nombre que tiene en Fourvenues: entradas de pago, personas en sus listas y
 * reservados. Lo que no lleva RRPP sale como "Sin RRPP". Si el RRPP no está asociado a una ficha
 * de la app (Ajustes → Fourvenues), se avisa.
 */
function RrppBreakdown({ rows, employees }: { rows: FourvenuesRrppNight[]; employees: Employee[] }) {
  const byFvUser = new Map(employees.filter((e) => e.fourvenues_user_id).map((e) => [e.fourvenues_user_id!, e]));
  const listed = rows
    .map((x) => {
      const employee = x.fourvenues_user_id ? byFvUser.get(x.fourvenues_user_id) : undefined;
      return {
        ...x,
        employee,
        label: x.fourvenues_user_id ? x.name || fullName(employee) || 'Usuario de Fourvenues' : 'Sin RRPP',
        total: x.tickets + (x.lists ?? 0) + (x.bookings ?? 0),
      };
    })
    .sort((a, b) => (!a.fourvenues_user_id ? 1 : !b.fourvenues_user_id ? -1 : b.total - a.total || a.label.localeCompare(b.label)));
  const listsKnown = rows.some((x) => x.lists != null);
  const bookingsKnown = rows.some((x) => x.bookings != null);
  const cols = 'grid-cols-[minmax(0,1fr)_44px_44px_40px] sm:grid-cols-[minmax(0,1fr)_90px_90px_96px]';
  const cell = (v: number | null | undefined, known: boolean) => (v == null ? (known ? '0' : '—') : fmtNum(v, 0));

  return (
    <Card className="mt-4 lg:mt-5">
      <CardHeader title="Por RRPP" subtitle="Entradas, listas (QR gratis) y reservados de cada RRPP en Fourvenues" />
      {listed.length ? (
        <div className="pb-2">
          <div className={cx('grid gap-2 border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 sm:px-5 sm:text-[12px]', cols)}>
            <span>RRPP</span>
            <span className="text-right">
              <span className="sm:hidden">Entr.</span>
              <span className="hidden sm:inline">Entradas</span>
            </span>
            <span className="text-right">Listas</span>
            <span className="text-right">
              <span className="sm:hidden">Res.</span>
              <span className="hidden sm:inline">Reservados</span>
            </span>
          </div>
          <div className="divide-y divide-line">
            {listed.map((r) => (
              <div key={r.id} className={cx('grid items-center gap-2 px-4 py-2.5 sm:px-5', cols)}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={r.label} color={r.employee?.color ?? '#8e8e93'} src={r.employee?.photo_url} size={30} className="hidden sm:inline-grid" />
                  <div className="min-w-0">
                    <div className={cx('truncate text-[14px] font-medium', !r.fourvenues_user_id && 'text-ink-2')}>{r.label}</div>
                    {r.fourvenues_user_id && !r.employee && <div className="truncate text-[12px] text-orange">Sin asociar a una ficha</div>}
                  </div>
                </div>
                <span className="tabular text-right text-[15px] font-semibold">{fmtNum(r.tickets, 0)}</span>
                <span className="tabular text-right text-[15px] font-semibold">{cell(r.lists, listsKnown)}</span>
                <span className="tabular text-right text-[15px] font-semibold">{cell(r.bookings, bookingsKnown)}</span>
              </div>
            ))}
          </div>
          <div className={cx('grid gap-2 border-t border-line bg-fill/40 px-4 py-2.5 text-[14px] font-semibold sm:px-5', cols)}>
            <span>Total</span>
            <span className="tabular text-right">{fmtNum(sumBy(listed, (r) => r.tickets), 0)}</span>
            <span className="tabular text-right">{listsKnown ? fmtNum(sumBy(listed, (r) => r.lists ?? 0), 0) : '—'}</span>
            <span className="tabular text-right">{bookingsKnown ? fmtNum(sumBy(listed, (r) => r.bookings ?? 0), 0) : '—'}</span>
          </div>
        </div>
      ) : (
        <p className="px-5 pb-5 text-[14px] text-ink-2">
          Aún no hay datos por RRPP de esta noche. Pulsa «Sincronizar con Fourvenues»; si sigue vacío, Fourvenues no ha devuelto ventas con RRPP o la
          sincronización ha dado un error (se muestra al sincronizar y en Ajustes → Fourvenues).
        </p>
      )}
    </Card>
  );
}

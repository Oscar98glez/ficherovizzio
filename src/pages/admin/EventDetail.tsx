import { Children, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Pencil, RefreshCw } from 'lucide-react';
import { EventForm } from '../../components/finance-forms';
import { Modal, useFeedback } from '../../components/overlay';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Loading, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { IS_DEMO } from '../../lib/config';
import { EVENT_KINDS } from '../../lib/constants';
import { addDays, businessToday, isoDate } from '../../lib/dates';
import { fmtDate, fmtDateFull, fmtMoney, fmtNum, fmtTime } from '../../lib/format';
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
          <RrppBreakdown rows={data.rrppNights} employees={data.employees} onChanged={reload} />
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
const shortId = (id: string) => id.slice(-6);

/**
 * Por RRPP, con el nombre que tiene en Fourvenues: entradas de pago, personas en sus listas y
 * reservados. Lo que no lleva RRPP sale como "Sin RRPP". Si el RRPP no está asociado a una ficha
 * de la app (Ajustes → Fourvenues), se avisa.
 */
function RrppBreakdown({ rows, employees, onChanged }: { rows: FourvenuesRrppNight[]; employees: Employee[]; onChanged: () => void }) {
  const [naming, setNaming] = useState<string | null>(null);
  const [open, setOpen] = useState<(typeof listed)[number] | null>(null);
  const byFvUser = new Map(employees.filter((e) => e.fourvenues_user_id).map((e) => [e.fourvenues_user_id!, e]));
  const listed = rows
    .map((x) => {
      const employee = x.fourvenues_user_id ? byFvUser.get(x.fourvenues_user_id) : undefined;
      return {
        ...x,
        employee,
        // El nombre tal y como está en Fourvenues; si Fourvenues no lo da, el de su ficha o su código
        label: !x.fourvenues_user_id ? 'Sin RRPP' : x.name || (employee ? fullName(employee) : `RRPP ${shortId(x.fourvenues_user_id)}`),
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
      <CardHeader title="Por RRPP" subtitle="Entradas, listas (QR gratis) y reservados de cada RRPP en Fourvenues. Pulsa uno para ver el desglose." />
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
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpen(r)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(r))}
                className={cx('grid cursor-pointer items-center gap-2 px-4 py-2.5 transition hover:bg-fill/60 sm:px-5', cols)}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={r.label} color={r.employee?.color ?? '#8e8e93'} src={r.employee?.photo_url} size={30} className="hidden sm:inline-grid" />
                  <div className="min-w-0">
                    <div className={cx('truncate text-[14px] font-medium', !r.fourvenues_user_id && 'text-ink-2')}>{r.label}</div>
                    {r.fourvenues_user_id && !r.name && (
                      <button
                        type="button"
                        onClick={(e) => (e.stopPropagation(), setNaming(r.fourvenues_user_id))}
                        className="truncate text-left text-[12px] font-medium text-accent hover:opacity-70">
                        Fourvenues no da su nombre · Poner nombre
                      </button>
                    )}
                    {r.fourvenues_user_id && r.name && r.employee && fullName(r.employee) !== r.name && (
                      <div className="truncate text-[12px] text-ink-2">Ficha: {fullName(r.employee)}</div>
                    )}
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
      <RrppNameModal fourvenuesUserId={naming} onClose={() => setNaming(null)} onSaved={onChanged} />
      <RrppDetailModal row={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

/** Lo que ha vendido un RRPP esa noche: entradas por tipo y precio, reservados (cortesía o pagados) y listas */
function RrppDetailModal({ row, onClose }: { row: (FourvenuesRrppNight & { label: string }) | null; onClose: () => void }) {
  const d = row?.detail;
  const courtesy = d?.bookings?.filter((b) => b.kind === 'cortesia') ?? [];
  const paid = d?.bookings?.filter((b) => b.kind === 'pagado') ?? [];
  return (
    <Modal open={!!row} onClose={onClose} title={row?.label ?? ''}>
      {row && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Entradas" value={row.tickets} />
            <MiniStat label="Listas" value={row.lists} />
            <MiniStat label="Reservados" value={row.bookings} />
          </div>
          {!d ? (
            <p className="rounded-xl bg-fill/60 px-4 py-3 text-[14px] text-ink-2">
              Aún no hay desglose de esta noche. Pulsa «Sincronizar con Fourvenues» y vuelve a abrirlo.
            </p>
          ) : (
            <>
              <DetailSection title="Entradas" empty="Sin entradas de pago" total={d.tickets.length > 1 ? `${fmtNum(sumBy(d.tickets, (t) => t.people), 0)} · ${fmtMoney(sumBy(d.tickets, (t) => t.amount))}` : undefined}>
                {d.tickets.map((t) => (
                  <DetailRow
                    key={`${t.rate}-${t.price}`}
                    title={t.rate}
                    sub={`${fmtMoney(t.price)} cada una${t.entered ? ` · ${fmtNum(t.entered, 0)} dentro` : ''}`}
                    value={fmtNum(t.people, 0)}
                    extra={fmtMoney(t.amount)}
                  />
                ))}
              </DetailSection>
              {d.bookings && (
                <DetailSection title="Reservados" empty="Sin reservados">
                  {[
                    ['Pagados', paid],
                    ['De cortesía', courtesy],
                  ].map(([label, list]) =>
                    (list as typeof paid).length ? (
                      <div key={label as string}>
                        <div className="px-3 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                          {label as string} · {fmtNum(sumBy(list as typeof paid, (b) => b.count), 0)}
                        </div>
                        {(list as typeof paid).map((b) => (
                          <DetailRow
                            key={`${b.kind}-${b.zone}`}
                            title={b.zone}
                            sub={b.people ? `${fmtNum(b.people, 0)} personas` : undefined}
                            value={fmtNum(b.count, 0)}
                            extra={b.kind === 'pagado' ? fmtMoney(b.amount) : 'Cortesía'}
                          />
                        ))}
                      </div>
                    ) : null,
                  )}
                </DetailSection>
              )}
              {d.lists && (
                <DetailSection title="Listas (QR gratis)" empty="Sin personas en listas">
                  {d.lists.map((l) => (
                    <DetailRow key={l.rate} title={l.rate} sub={l.entered ? `${fmtNum(l.entered, 0)} dentro` : undefined} value={fmtNum(l.people, 0)} extra="personas" />
                  ))}
                </DetailSection>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function MiniStat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-xl bg-fill/60 px-3 py-2.5 text-center">
      <div className="tabular text-[20px] font-semibold">{num(value)}</div>
      <div className="text-[12px] text-ink-2">{label}</div>
    </div>
  );
}

function DetailSection({ title, empty, total, children }: { title: string; empty: string; total?: string; children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {total && <span className="tabular text-[13px] text-ink-2">{total}</span>}
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-fill/40">{items.length ? items : <p className="px-3 py-3 text-[14px] text-ink-2">{empty}</p>}</div>
    </section>
  );
}

function DetailRow({ title, sub, value, extra }: { title: string; sub?: string; value: string; extra?: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{title}</div>
        {sub && <div className="truncate text-[12px] text-ink-2">{sub}</div>}
      </div>
      <div className="text-right">
        <div className="tabular text-[15px] font-semibold">{value}</div>
        {extra && <div className="tabular text-[12px] text-ink-2">{extra}</div>}
      </div>
    </div>
  );
}

/** Nombre a mano para un RRPP del que Fourvenues no da el nombre (vale para todas sus noches) */
function RrppNameModal({ fourvenuesUserId, onClose, onSaved }: { fourvenuesUserId: string | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(''), [fourvenuesUserId]);

  async function submit() {
    if (!fourvenuesUserId) return;
    if (!name.trim()) return toast.error('Escribe el nombre del RRPP');
    setSaving(true);
    try {
      await api.setFourvenuesRrppName(fourvenuesUserId, name.trim());
      toast.success('Nombre guardado en todas sus noches');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!fourvenuesUserId} onClose={onClose} title="Nombre del RRPP" onSubmit={submit} saving={saving}>
      <div className="space-y-3">
        <p className="text-[14px] text-ink-2">
          Fourvenues no da el nombre de este RRPP (no está entre sus usuarios). Escríbelo tal y como aparece en Fourvenues: se usará en todas sus noches. Si más
          adelante Fourvenues lo da, se usará el suyo.
        </p>
        <Field label="Nombre" hint={`Código en Fourvenues: ${fourvenuesUserId ?? ''}`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

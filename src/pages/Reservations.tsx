import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Coins, Plus, Settings2, Sofa, Users } from 'lucide-react';
import { useAuth } from '../auth';
import { ReservationForm, VipTablesManager } from '../components/reservation-forms';
import { Badge, Button, Card, EmptyState, ErrorBox, IconButton, Input, List, ListRow, Loading, PageHeader, SectionTitle, Segmented, StatCard } from '../components/ui';
import { useLoad } from '../hooks';
import { api } from '../lib/api';
import { hhmm } from '../lib/availability';
import { isActiveReservation, RESERVATION_STATUS } from '../lib/constants';
import { addDays, businessToday, isoDate, parseDate } from '../lib/dates';
import { fmtDateFull, fmtMoneyExact } from '../lib/format';
import type { Employee, Reservation, VipTable } from '../lib/types';
import { cx, groupBy, sumBy } from '../lib/utils';

type Filter = 'all' | 'mine';

const byName = (a: VipTable, b: VipTable) => a.sort - b.sort || a.name.localeCompare(b.name, 'es', { numeric: true });
/** Las reservas activas primero, por hora de llegada (la madrugada va detrás de la noche) */
const arrivalKey = (r: Reservation) => {
  const t = hhmm(r.arrival_time);
  return `${isActiveReservation(r) ? 0 : 1}${t ? (t < '06:00' ? `1${t}` : `0${t}`) : '2'}${r.customer_name}`;
};

export default function Reservations() {
  const { isAdmin, employee } = useAuth();
  const today = isoDate(businessToday());
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<{ reservation?: Reservation; table?: VipTable } | null>(null);
  const [managing, setManaging] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const [tables, reservations, events] = await Promise.all([
      api.vipTables.list(),
      api.reservations.list({ eq: { date } }),
      api.events.list({ eq: { date } }),
    ]);
    // El administrador puede asignar la reserva a cualquier RRPP (o a relaciones públicas sin cuenta)
    let rrpps: Employee[] = [];
    if (isAdmin) {
      const [employees, profiles] = await Promise.all([api.employees.list({ eq: { active: true } }), api.profiles.list()]);
      const roles = new Map(profiles.map((p) => [p.id, p.role]));
      rrpps = employees
        .filter((e) => e.department === 'relaciones' || (e.user_id && ['rrpp', 'admin'].includes(roles.get(e.user_id) ?? '')))
        .sort((a, b) => a.first_name.localeCompare(b.first_name, 'es'));
    }
    return { tables: tables.sort(byName), reservations, event: events[0] ?? null, rrpps };
  }, [date, isAdmin]);

  const view = useMemo(() => {
    if (!data) return null;
    const active = data.reservations.filter(isActiveReservation);
    const byTable = new Map(active.filter((r) => r.table_id).map((r) => [r.table_id!, r]));
    const tables = data.tables.filter((t) => t.active || byTable.has(t.id));
    const zones = groupBy(tables, (t) => t.zone || 'Sin zona');
    const list = data.reservations
      .filter((r) => filter === 'all' || r.rrpp_id === employee?.id)
      .sort((a, b) => arrivalKey(a).localeCompare(arrivalKey(b)));
    return {
      active,
      byTable,
      zones: Object.entries(zones),
      list,
      tablesById: new Map(data.tables.map((t) => [t.id, t])),
      freeCount: tables.filter((t) => t.active && !byTable.has(t.id)).length,
      activeTables: tables.filter((t) => t.active).length,
    };
  }, [data, filter, employee?.id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !view) return null;

  const canEdit = (r: Reservation) => isAdmin || (!!employee && r.rrpp_id === employee.id);
  const move = (days: number) => setDate(isoDate(addDays(parseDate(date), days)));

  return (
    <>
      <PageHeader
        title="Reservados"
        subtitle="Reservas de cada noche"
        actions={
          <>
            {isAdmin && (
              <Button variant="secondary" icon={<Settings2 />} onClick={() => setManaging(true)}>
                Reservados del local
              </Button>
            )}
            <Button icon={<Plus />} onClick={() => setForm({})}>
              Nueva reserva
            </Button>
          </>
        }
      />

      {/* Noche */}
      <Card className="mb-5 flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <IconButton label="Noche anterior" onClick={() => move(-1)}>
          <ChevronLeft />
        </IconButton>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="truncate text-[17px] font-semibold">{date === today ? 'Esta noche' : fmtDateFull(date)}</div>
          <div className="truncate text-[13px] text-ink-2">
            {date === today ? fmtDateFull(date) : ''}
            {data.event ? `${date === today ? ' · ' : ''}${data.event.name}` : date === today ? '' : 'Sin noche programada'}
          </div>
        </div>
        <IconButton label="Noche siguiente" onClick={() => move(1)}>
          <ChevronRight />
        </IconButton>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {date !== today && (
            <Button variant="tinted" size="sm" onClick={() => setDate(today)}>
              Esta noche
            </Button>
          )}
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 flex-1 rounded-lg py-0 text-[14px] sm:w-auto" aria-label="Elegir noche" />
        </div>
      </Card>

      <div className={cx('transition-opacity', loading && 'opacity-50')}>
      <div className="mb-2 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Reservas" value={view.active.length} icon={<CalendarDays />} tone="blue" />
        <StatCard label="Personas" value={sumBy(view.active, (r) => r.guests)} icon={<Users />} tone="purple" />
        <StatCard label="Reservados libres" value={`${view.freeCount} / ${view.activeTables}`} icon={<Sofa />} tone="green" />
        <StatCard label="Señales cobradas" value={fmtMoneyExact(sumBy(view.active, (r) => r.deposit))} icon={<Coins />} tone="orange" />
      </div>

      {/* Reservados */}
      <SectionTitle>Reservados</SectionTitle>
      {view.zones.length ? (
        <div className="space-y-4">
          {view.zones.map(([zone, tables]) => (
            <div key={zone}>
              {view.zones.length > 1 && <div className="mb-2 px-1 text-[13px] font-medium text-ink-2">{zone}</div>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {tables.map((t) => {
                  const r = view.byTable.get(t.id);
                  const mine = !!r && r.rrpp_id === employee?.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setForm(r ? { reservation: r } : { table: t })}
                      className={cx(
                        'card flex min-h-[112px] flex-col items-start p-3.5 text-left transition hover:scale-[1.01] active:scale-[0.99]',
                        r ? 'ring-2 ring-inset' : 'border-dashed',
                        r && (mine ? 'ring-accent/60' : 'ring-line'),
                      )}
                    >
                      <div className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold leading-tight">{t.name}</span>
                        {r ? <Badge tone={RESERVATION_STATUS[r.status].tone}>{RESERVATION_STATUS[r.status].label}</Badge> : <Badge tone="green" dot>Libre</Badge>}
                      </div>
                      {r ? (
                        <>
                          <div className="mt-2 w-full truncate text-[14px] font-medium">{r.customer_name}</div>
                          <div className="tabular w-full truncate text-[12px] text-ink-2">
                            {r.guests} pers.{hhmm(r.arrival_time) ? ` · ${hhmm(r.arrival_time)}` : ''}
                          </div>
                          <div className="mt-auto w-full truncate pt-1 text-[12px] text-ink-3">{mine ? 'Tu reserva' : r.rrpp_name ?? 'Sin RRPP'}</div>
                        </>
                      ) : (
                        <div className="mt-auto w-full text-[12px] text-ink-2">
                          {[t.capacity ? `${t.capacity} pers.` : null, t.min_spend != null ? `mín. ${fmtMoneyExact(t.min_spend)}` : null].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Sofa />}
            title="Aún no hay reservados"
            message={isAdmin ? 'Crea los reservados del local para poder asignarlos a las reservas.' : 'El administrador todavía no ha creado los reservados del local.'}
            action={isAdmin && <Button icon={<Plus />} onClick={() => setManaging(true)}>Crear reservados</Button>}
          />
        </Card>
      )}

      {/* Reservas */}
      <SectionTitle
        action={
          !isAdmin && (
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Todas' },
                { value: 'mine', label: 'Mías' },
              ]}
            />
          )
        }
      >
        Reservas de la noche
      </SectionTitle>
      {view.list.length ? (
        <List>
          {view.list.map((r) => {
            const t = r.table_id ? view.tablesById.get(r.table_id) : undefined;
            const st = RESERVATION_STATUS[r.status];
            return (
              <ListRow
                key={r.id}
                onClick={() => setForm({ reservation: r })}
                className={cx(!isActiveReservation(r) && 'opacity-55')}
                leading={
                  <div className="tabular w-12 shrink-0 rounded-[10px] bg-fill/70 py-1.5 text-center text-[14px] font-semibold">{hhmm(r.arrival_time) || '—'}</div>
                }
                title={r.customer_name}
                subtitle={[t ? t.name : 'Sin reservado', `${r.guests} pers.`, r.rrpp_id === employee?.id ? 'Tu reserva' : r.rrpp_name].filter(Boolean).join(' · ')}
                trailing={
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {r.deposit > 0 && <span className="tabular text-[12px] text-ink-2">Señal {fmtMoneyExact(r.deposit)}</span>}
                  </div>
                }
              />
            );
          })}
        </List>
      ) : (
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title={filter === 'mine' ? 'No tienes reservas esta noche' : 'No hay reservas esta noche'}
            action={<Button icon={<Plus />} onClick={() => setForm({})}>Nueva reserva</Button>}
          />
        </Card>
      )}

      </div>

      <ReservationForm
        open={!!form}
        onClose={() => setForm(null)}
        date={date}
        tables={data.tables}
        reservations={data.reservations}
        reservation={form?.reservation}
        table={form?.table}
        rrpps={data.rrpps}
        canEdit={!form?.reservation || canEdit(form.reservation)}
        isAdmin={isAdmin}
        myEmployeeId={employee?.id ?? null}
        onSaved={reload}
      />
      {isAdmin && <VipTablesManager open={managing} onClose={() => setManaging(false)} tables={data.tables} onSaved={reload} />}
    </>
  );
}

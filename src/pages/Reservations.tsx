import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Coins, Plus, Settings2, Sofa, Users } from 'lucide-react';
import { useAuth } from '../auth';
import { ClubMap } from '../components/ClubMap';
import { itemsText, ReservationForm, VipTablesManager } from '../components/reservation-forms';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  IconButton,
  Input,
  List,
  ListRow,
  Loading,
  PageHeader,
  SectionTitle,
  Segmented,
  StatCard,
} from '../components/ui';
import { useLoad } from '../hooks';
import { api } from '../lib/api';
import { hhmm } from '../lib/availability';
import { isActiveReservation, RESERVATION_STATUS } from '../lib/constants';
import { addDays, businessToday, isoDate, parseDate } from '../lib/dates';
import { fmtDateFull, fmtMoneyExact } from '../lib/format';
import type { Reservation, VipTable } from '../lib/types';
import { cx, groupBy, sumBy } from '../lib/utils';

type Filter = 'all' | 'mine';

const byName = (a: VipTable, b: VipTable) => a.sort - b.sort || a.name.localeCompare(b.name, 'es', { numeric: true });
/** Las reservas activas primero, por hora de llegada (la madrugada va detrás de la noche) */
const arrivalKey = (r: Reservation) => {
  const t = hhmm(r.arrival_time);
  return `${isActiveReservation(r) ? 0 : 1}${t ? (t < '06:00' ? `1${t}` : `0${t}`) : '2'}${r.customer_name}`;
};

export default function Reservations() {
  const { isAdmin, employee, userId } = useAuth();
  const today = isoDate(businessToday());
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<{
    reservation?: Reservation;
    table?: VipTable;
  } | null>(null);
  const [managing, setManaging] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    // RRPP que se pueden elegir como "RRPP" y "RRPP que atiende"
    const [tables, reservations, events, staff] = await Promise.all([
      api.vipTables.list(),
      api.reservations.list({ eq: { date } }),
      api.events.list({ eq: { date } }),
      api.reservationStaff(),
    ]);
    return {
      tables: tables.sort(byName),
      reservations,
      event: events[0] ?? null,
      staff,
    };
  }, [date]);

  const view = useMemo(() => {
    if (!data) return null;
    const active = data.reservations.filter(isActiveReservation);
    const byTable = new Map(active.filter((r) => r.table_id).map((r) => [r.table_id!, r]));
    const tables = data.tables.filter((t) => t.active || byTable.has(t.id));
    // En el plano van los reservados ubicados; el resto, en tarjetas debajo
    const placed = tables.filter((t) => t.map_x != null && t.map_y != null);
    const zones = groupBy(
      tables.filter((t) => t.map_x == null || t.map_y == null),
      (t) => t.zone || 'Sin zona',
    );
    const list = data.reservations
      .filter((r) => filter === 'all' || (!!employee && (r.rrpp_id === employee.id || r.host_rrpp_id === employee.id)))
      .sort((a, b) => arrivalKey(a).localeCompare(arrivalKey(b)));
    return {
      active,
      byTable,
      placed,
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

  // Puede editarla quien la creó, su RRPP, el RRPP que la atiende o un administrador
  const canEdit = (r: Reservation) =>
    isAdmin || (!!userId && r.created_by === userId) || (!!employee && (r.rrpp_id === employee.id || r.host_rrpp_id === employee.id));
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
          <Input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-8 flex-1 rounded-lg py-0 text-[14px] sm:w-auto"
            aria-label="Elegir noche"
          />
        </div>
      </Card>

      <div className={cx('transition-opacity', loading && 'opacity-50')}>
        <div className="mb-2 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Reservas" value={view.active.length} icon={<CalendarDays />} tone="blue" />
          <StatCard label="Personas" value={sumBy(view.active, (r) => r.guests)} icon={<Users />} tone="purple" />
          <StatCard label="Reservados libres" value={`${view.freeCount} / ${view.activeTables}`} icon={<Sofa />} tone="green" />
          <StatCard
            label="Coste total"
            value={fmtMoneyExact(sumBy(view.active, (r) => r.total_amount ?? 0))}
            sub={`Señales ${fmtMoneyExact(sumBy(view.active, (r) => r.deposit))}`}
            icon={<Coins />}
            tone="orange"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
          {/* Plano interactivo */}
          <Card className="p-4 sm:p-5 lg:sticky lg:top-6">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="text-[17px] font-semibold">Plano</h3>
              <span className="text-[12px] text-ink-2">Pulsa un reservado</span>
            </div>
            {view.placed.length ? (
              <ClubMap
                tables={view.placed}
                reservationByTable={view.byTable}
                myEmployeeId={employee?.id ?? null}
                onSelect={(t, r) => setForm(r ? { reservation: r } : { table: t })}
              />
            ) : (
              <EmptyState
                icon={<Sofa />}
                title="Aún no hay reservados en el plano"
                message={
                  isAdmin
                    ? 'Crea los reservados del local para poder asignarlos a las reservas.'
                    : 'El administrador todavía no ha creado los reservados del local.'
                }
                action={
                  isAdmin && (
                    <Button icon={<Plus />} onClick={() => setManaging(true)}>
                      Reservados del local
                    </Button>
                  )
                }
              />
            )}
          </Card>

          <div className="min-w-0">
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
                        <div className="tabular w-12 shrink-0 rounded-[10px] bg-fill/70 py-1.5 text-center text-[14px] font-semibold">
                          {hhmm(r.arrival_time) || '—'}
                        </div>
                      }
                      title={r.customer_name}
                      subtitle={[
                        t ? t.name : 'Sin reservado',
                        `${r.guests} pers.`,
                        itemsText(r.bottles),
                        r.rrpp_id === employee?.id ? 'Tu reserva' : r.rrpp_name,
                        r.host_rrpp_name && `atiende ${r.host_rrpp_id === employee?.id ? 'tú' : r.host_rrpp_name}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      trailing={
                        <div className="flex flex-col items-end gap-1">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {r.total_amount != null ? (
                            <span className="tabular text-[13px] font-semibold">{fmtMoneyExact(r.total_amount)}</span>
                          ) : (
                            r.deposit > 0 && <span className="tabular text-[12px] text-ink-2">Señal {fmtMoneyExact(r.deposit)}</span>
                          )}
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
                  action={
                    <Button icon={<Plus />} onClick={() => setForm({})}>
                      Nueva reserva
                    </Button>
                  }
                />
              </Card>
            )}
          </div>
        </div>

        {/* Reservados sin ubicar en el plano */}
        {view.zones.length > 0 && (
          <>
            <SectionTitle>Otros reservados</SectionTitle>
            <div className="space-y-4">
              {view.zones.map(([zone, tables]) => (
                <div key={zone}>
                  {view.zones.length > 1 && <div className="mb-2 px-1 text-[13px] font-medium text-ink-2">{zone}</div>}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {tables.map((t) => {
                      const r = view.byTable.get(t.id);
                      const mine = !!r && !!employee && (r.rrpp_id === employee.id || r.host_rrpp_id === employee.id);
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
                            {r ? (
                              <Badge tone={RESERVATION_STATUS[r.status].tone}>{RESERVATION_STATUS[r.status].label}</Badge>
                            ) : (
                              <Badge tone="green" dot>
                                Libre
                              </Badge>
                            )}
                          </div>
                          {r ? (
                            <>
                              <div className="mt-2 w-full truncate text-[14px] font-medium">{r.customer_name}</div>
                              <div className="tabular w-full truncate text-[12px] text-ink-2">
                                {r.guests} pers.
                                {hhmm(r.arrival_time) ? ` · ${hhmm(r.arrival_time)}` : ''}
                              </div>
                              <div className="mt-auto w-full truncate pt-1 text-[12px] text-ink-3">
                                {mine ? 'Tu reserva' : (r.rrpp_name ?? 'Sin RRPP')}
                              </div>
                            </>
                          ) : (
                            <div className="mt-auto w-full text-[12px] text-ink-2">
                              {[t.capacity ? `${t.capacity} pers.` : null, t.min_spend != null ? `mín. ${fmtMoneyExact(t.min_spend)}` : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
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
        staff={data.staff}
        canEdit={!form?.reservation || canEdit(form.reservation)}
        myEmployeeId={employee?.id ?? null}
        onSaved={reload}
      />
      {isAdmin && <VipTablesManager open={managing} onClose={() => setManaging(false)} tables={data.tables} onSaved={reload} />}
    </>
  );
}

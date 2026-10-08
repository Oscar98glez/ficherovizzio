import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Banknote, ChevronLeft, Pencil, Plus } from 'lucide-react';
import { HBarList } from '../../components/charts';
import { CloseoutForm, EventForm, TransactionForm } from '../../components/finance-forms';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorBox, ListRow, Loading, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { EVENT_KINDS, METHODS } from '../../lib/constants';
import { addDays, businessDate, businessStart, isoDate, parseDate } from '../../lib/dates';
import { fmtDateFull, fmtHours, fmtMoney, fmtMoney0, fmtNum, fmtTime, fmtMoneyExact, fmtShiftTimes } from '../../lib/format';
import { isFourvenuesTx } from '../../lib/fourvenues';
import type { Employee, FourvenuesRrppNight, Reservation, ReservationStatus, Transaction } from '../../lib/types';
import { byId, cx, entryCost, entryHours, fullName, groupBy, sumBy, categoryRank, compareByCategory } from '../../lib/utils';

export default function EventDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [closeout, setCloseout] = useState(false);
  const [txModal, setTxModal] = useState<{ tx: Transaction | null } | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const event = await api.events.get(id);
    if (!event) return null;
    const next = isoDate(addDays(parseDate(event.date), 1));
    const [entries, tx, shifts, employees, events, rrppNights, reservations] = await Promise.all([
      api.timeEntries.list({ gte: ['clock_in', businessStart(event.date)], lt: ['clock_in', businessStart(next)] }),
      api.transactions.list({ eq: { event_id: id } }),
      api.shifts.list({ gte: ['start_at', businessStart(event.date)], lt: ['start_at', businessStart(next)] }),
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.events.list({ gte: ['date', isoDate(addDays(parseDate(event.date), -14))], lt: ['date', isoDate(addDays(parseDate(event.date), 14))], order: ['date', 'asc'] }),
      // Desglose por RRPP de Fourvenues y reservados de la noche (si faltan las migraciones, la noche se ve igual)
      event.fourvenues_id ? api.fourvenuesRrppNights.list({ eq: { event_id: id } }).catch(() => [] as FourvenuesRrppNight[]) : ([] as FourvenuesRrppNight[]),
      api.reservations.list({ eq: { date: event.date } }).catch(() => [] as Reservation[]),
    ]);
    return { event, entries, tx, shifts, employees, events, rrppNights, reservations };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <EmptyState title="Noche no encontrada" action={<Link to="/noches" className="text-accent">Volver</Link>} />;

  const { event: ev } = data;
  const emps = byId(data.employees);
  const income = data.tx.filter((t) => t.kind === 'income');
  const expenses = data.tx.filter((t) => t.kind === 'expense');
  const totalIncome = sumBy(income, (t) => t.amount);
  const totalExpenses = sumBy(expenses, (t) => t.amount);
  const staffCost = sumBy(data.entries, (e) => entryCost(e));
  const result = totalIncome - totalExpenses - staffCost;
  const plannedShifts = data.shifts.filter((s) => s.status !== 'cancelled');
  const incomeByCat = Object.entries(groupBy(income, (t) => t.category))
    .map(([label, ts]) => ({ label, value: sumBy(ts, (t) => t.amount) }))
    .sort((a, b) => categoryRank('income', a.label) - categoryRank('income', b.label));
  const cash = sumBy(income.filter((t) => t.method === 'efectivo'), (t) => t.amount);
  const isFuture = ev.date > businessDate(Date.now());

  return (
    <>
      <Link to="/noches" className="mb-4 inline-flex items-center gap-0.5 text-[15px] text-accent hover:opacity-70">
        <ChevronLeft className="h-5 w-5" /> Noches
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Badge tone={EVENT_KINDS[ev.kind].tone}>{EVENT_KINDS[ev.kind].label}</Badge>
            {ev.expected_attendance != null && <span className="text-[13px] text-ink-2">Aforo previsto {fmtNum(ev.expected_attendance, 0)}</span>}
            {ev.tickets_sold != null && (
              <span className="text-[13px] text-ink-2">
                Fourvenues:{' '}
                {ev.tickets_paid != null
                  ? `${fmtNum(ev.tickets_paid, 0)} vendidas${ev.tickets_free != null ? ` · ${fmtNum(ev.tickets_free, 0)} QR gratis (listas)` : ''}`
                  : `${fmtNum(ev.tickets_sold, 0)} con entrada`}
                {ev.tickets_entered ? ` · ${fmtNum(ev.tickets_entered, 0)} dentro` : ''}
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
          <Button variant="secondary" icon={<Plus />} onClick={() => setTxModal({ tx: null })}>
            Gasto
          </Button>
          <Button icon={<Banknote />} onClick={() => setCloseout(true)}>
            Cierre de caja
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
        <StatCard label="Ingresos" value={fmtMoney0(totalIncome)} tone="green" sub={totalIncome ? `Efectivo ${fmtMoney0(cash)}` : 'Sin cierre de caja'} />
        <StatCard label="Gastos" value={fmtMoney0(totalExpenses)} sub={`${expenses.length} movimientos`} />
        <StatCard
          label={isFuture ? 'Personal previsto' : 'Coste de personal'}
          value={isFuture ? `${plannedShifts.length} personas` : fmtMoney0(staffCost)}
          sub={isFuture ? 'Turnos asignados' : `${new Set(data.entries.map((e) => e.employee_id)).size} personas`}
        />
        <StatCard
          label="Resultado"
          value={<span className={result >= 0 ? 'text-green' : 'text-red'}>{fmtMoneyExact(result)}</span>}
          sub={totalIncome ? `Margen ${Math.round((result / totalIncome) * 100)}%` : undefined}
        />
      </div>

      {ev.fourvenues_id && <RrppBreakdown rows={data.rrppNights} reservations={data.reservations} employees={data.employees} />}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-2 lg:gap-5">
        <Card className="p-5">
          <h3 className="mb-4 text-[17px] font-semibold">Ingresos por concepto</h3>
          <HBarList items={incomeByCat} color="rgb(var(--green))" empty="Registra el cierre de caja para ver el desglose." />
        </Card>

        <Card>
          <CardHeader title={isFuture ? 'Equipo planificado' : 'Equipo que trabajó'} subtitle={isFuture ? undefined : `${fmtHours(sumBy(data.entries, (e) => entryHours(e)))} en total`} />
          <div className="divide-y divide-line pb-2">
            {(isFuture ? plannedShifts : data.entries).length === 0 && <p className="px-5 pb-4 text-[14px] text-ink-2">Nadie todavía.</p>}
            {isFuture
              ? plannedShifts.map((s) => {
                  const emp = emps.get(s.employee_id);
                  return (
                    <ListRow
                      key={s.id}
                      leading={<Avatar name={fullName(emp)} color={emp?.color} src={emp?.photo_url} size={32} />}
                      title={fullName(emp)}
                      subtitle={`${s.position ?? emp?.position ?? ''} · ${fmtShiftTimes(s)}`}
                    />
                  );
                })
              : data.entries
                  .sort((a, b) => a.clock_in.localeCompare(b.clock_in))
                  .map((e) => {
                    const emp = emps.get(e.employee_id);
                    return (
                      <ListRow
                        key={e.id}
                        onClick={() => navigate(`/personal/${e.employee_id}`)}
                        leading={<Avatar name={fullName(emp)} color={emp?.color} src={emp?.photo_url} size={32} />}
                        title={fullName(emp)}
                        subtitle={`${fmtTime(e.clock_in)}–${e.clock_out ? fmtTime(e.clock_out) : 'en curso'} · ${fmtHours(entryHours(e))}`}
                        trailing={<span className="tabular text-[14px] font-semibold">{fmtMoney(entryCost(e))}</span>}
                      />
                    );
                  })}
          </div>
        </Card>
      </div>

      <Card className="mt-4 lg:mt-5">
        <CardHeader title="Movimientos" subtitle="Ingresos y gastos asociados a esta noche" />
        {data.tx.length ? (
          <div className="divide-y divide-line pb-2">
            {[...data.tx]
              .sort(compareByCategory)
              .map((t) => (
                <ListRow
                  key={t.id}
                  onClick={() => setTxModal({ tx: t })}
                  title={
                    <span className="flex items-center gap-2">
                      {t.category}
                      {isFourvenuesTx(t) && <Badge tone="indigo">Fourvenues</Badge>}
                    </span>
                  }
                  subtitle={[METHODS[t.method], t.description].filter(Boolean).join(' · ')}
                  trailing={
                    <span className={cx('tabular text-[15px] font-semibold', t.kind === 'income' && 'text-green')}>
                      {t.kind === 'income' ? '+' : '−'}
                      {fmtMoney(t.amount)}
                    </span>
                  }
                />
              ))}
          </div>
        ) : (
          <EmptyState title="Sin movimientos" message="Registra el cierre de caja al terminar la noche." action={<Button icon={<Banknote />} onClick={() => setCloseout(true)}>Cierre de caja</Button>} />
        )}
      </Card>

      <EventForm open={editing} onClose={() => setEditing(false)} event={ev} onSaved={reload} onDeleted={() => navigate('/noches')} />
      <CloseoutForm open={closeout} onClose={() => setCloseout(false)} events={data.events} defaultEventId={ev.id} onSaved={reload} />
      <TransactionForm
        open={!!txModal}
        onClose={() => setTxModal(null)}
        tx={txModal?.tx}
        defaults={{ kind: 'expense', date: ev.date, event_id: ev.id }}
        employees={data.employees}
        events={data.events}
        onSaved={reload}
      />
    </>
  );
}

/** Reservados que cuentan (sin cancelados ni los que no se presentaron) */
const LIVE_RESERVATION: ReservationStatus[] = ['pending', 'confirmed', 'arrived'];

/**
 * Por RRPP (con su nombre de Fourvenues): entradas de pago y personas en listas de la sincronización,
 * y los reservados de la app de esa noche. Un RRPP de la app cuenta como su usuario de Fourvenues si
 * está asociado (Ajustes → Fourvenues); si no, sale con el nombre de su ficha.
 */
function RrppBreakdown({ rows, reservations, employees }: { rows: FourvenuesRrppNight[]; reservations: Reservation[]; employees: Employee[] }) {
  const emps = byId(employees);
  const byFvUser = new Map(employees.filter((e) => e.fourvenues_user_id).map((e) => [e.fourvenues_user_id!, e]));
  type Row = { key: string; name: string; employee?: Employee; linked: boolean; tickets: number; lists: number | null; reservations: number };
  const map = new Map<string, Row>();
  const get = (key: string, init: () => Omit<Row, 'key' | 'tickets' | 'lists' | 'reservations'>) => {
    let r = map.get(key);
    if (!r) map.set(key, (r = { key, tickets: 0, lists: null, reservations: 0, ...init() }));
    return r;
  };

  for (const x of rows) {
    const emp = x.fourvenues_user_id ? byFvUser.get(x.fourvenues_user_id) : undefined;
    const r = get(x.fourvenues_user_id, () => ({
      name: x.fourvenues_user_id ? x.name || fullName(emp) || 'Usuario de Fourvenues' : 'Sin RRPP',
      employee: emp,
      linked: !!emp,
    }));
    r.tickets += x.tickets;
    if (x.lists != null) r.lists = (r.lists ?? 0) + x.lists;
  }
  for (const res of reservations.filter((x) => LIVE_RESERVATION.includes(x.status))) {
    const emp = res.rrpp_id ? emps.get(res.rrpp_id) : undefined;
    const key = !res.rrpp_id ? '' : emp?.fourvenues_user_id ?? `app:${res.rrpp_id}`;
    const r = get(key, () => ({
      name: key === '' ? 'Sin RRPP' : fullName(emp) || res.rrpp_name || 'RRPP',
      employee: emp,
      linked: !!emp?.fourvenues_user_id,
    }));
    r.reservations++;
  }

  const listed = [...map.values()].sort((a, b) =>
    a.key === '' ? 1 : b.key === '' ? -1 : b.tickets + (b.lists ?? 0) + b.reservations - (a.tickets + (a.lists ?? 0) + a.reservations) || a.name.localeCompare(b.name),
  );
  const listsKnown = rows.some((x) => x.lists != null);
  const total = { tickets: sumBy(listed, (r) => r.tickets), lists: sumBy(listed, (r) => r.lists ?? 0), reservations: sumBy(listed, (r) => r.reservations) };
  const cols = 'grid-cols-[minmax(0,1fr)_44px_44px_40px] sm:grid-cols-[minmax(0,1fr)_90px_90px_96px]';

  return (
    <Card className="mt-4 lg:mt-5">
      <CardHeader
        title="Por RRPP"
        subtitle={`Entradas y listas de Fourvenues${rows[0] ? ` (sincronizado ${fmtTime(rows[0].synced_at)})` : ''}; reservados de la app`}
      />
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
              <div key={r.key} className={cx('grid items-center gap-2 px-4 py-2.5 sm:px-5', cols)}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={r.name} color={r.employee?.color ?? '#8e8e93'} src={r.employee?.photo_url} size={30} className="hidden sm:inline-grid" />
                  <div className="min-w-0">
                    <div className={cx('truncate text-[14px] font-medium', r.key === '' && 'text-ink-2')}>{r.name}</div>
                    {r.key && !r.key.startsWith('app:') && !r.linked && <div className="truncate text-[12px] text-orange">Sin asociar a una ficha</div>}
                    {r.key.startsWith('app:') && <div className="truncate text-[12px] text-ink-3">De la app (sin usuario de Fourvenues)</div>}
                  </div>
                </div>
                <span className="tabular text-right text-[15px] font-semibold">{fmtNum(r.tickets, 0)}</span>
                <span className="tabular text-right text-[15px] font-semibold">{r.lists == null ? (listsKnown ? '0' : '—') : fmtNum(r.lists, 0)}</span>
                <span className="tabular text-right text-[15px] font-semibold">{fmtNum(r.reservations, 0)}</span>
              </div>
            ))}
          </div>
          <div className={cx('grid gap-2 border-t border-line bg-fill/40 px-4 py-2.5 text-[14px] font-semibold sm:px-5', cols)}>
            <span>Total</span>
            <span className="tabular text-right">{fmtNum(total.tickets, 0)}</span>
            <span className="tabular text-right">{listsKnown ? fmtNum(total.lists, 0) : '—'}</span>
            <span className="tabular text-right">{fmtNum(total.reservations, 0)}</span>
          </div>
        </div>
      ) : (
        <p className="px-5 pb-5 text-[14px] text-ink-2">Aún no hay datos por RRPP. Se rellenan en la próxima sincronización con Fourvenues.</p>
      )}
    </Card>
  );
}

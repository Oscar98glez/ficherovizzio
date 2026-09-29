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
import { fmtDateFull, fmtHours, fmtMoney, fmtMoney0, fmtNum, fmtTime } from '../../lib/format';
import type { Transaction } from '../../lib/types';
import { byId, cx, entryCost, entryHours, fullName, groupBy, shiftHours, sumBy } from '../../lib/utils';

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
    const [entries, tx, shifts, employees, events] = await Promise.all([
      api.timeEntries.list({ gte: ['clock_in', businessStart(event.date)], lt: ['clock_in', businessStart(next)] }),
      api.transactions.list({ eq: { event_id: id } }),
      api.shifts.list({ gte: ['start_at', businessStart(event.date)], lt: ['start_at', businessStart(next)] }),
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.events.list({ gte: ['date', isoDate(addDays(parseDate(event.date), -14))], lt: ['date', isoDate(addDays(parseDate(event.date), 14))], order: ['date', 'asc'] }),
    ]);
    return { event, entries, tx, shifts, employees, events };
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
  const plannedCost = sumBy(plannedShifts, (s) => shiftHours(s) * (emps.get(s.employee_id)?.hourly_rate ?? 0));
  const incomeByCat = Object.entries(groupBy(income, (t) => t.category))
    .map(([label, ts]) => ({ label, value: sumBy(ts, (t) => t.amount) }))
    .sort((a, b) => b.value - a.value);
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Ingresos" value={fmtMoney0(totalIncome)} tone="green" sub={totalIncome ? `Efectivo ${fmtMoney0(cash)}` : 'Sin cierre de caja'} />
        <StatCard label="Gastos" value={fmtMoney0(totalExpenses)} sub={`${expenses.length} movimientos`} />
        <StatCard
          label={isFuture ? 'Personal previsto' : 'Coste de personal'}
          value={fmtMoney0(isFuture ? plannedCost : staffCost)}
          sub={isFuture ? `${plannedShifts.length} turnos` : `${new Set(data.entries.map((e) => e.employee_id)).size} personas`}
        />
        <StatCard
          label="Resultado"
          value={<span className={result >= 0 ? 'text-green' : 'text-red'}>{fmtMoney0(result)}</span>}
          sub={totalIncome ? `Margen ${Math.round((result / totalIncome) * 100)}%` : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:mt-5 lg:grid-cols-2 lg:gap-5">
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
                      leading={<Avatar name={fullName(emp)} color={emp?.color} size={32} />}
                      title={fullName(emp)}
                      subtitle={`${s.position ?? emp?.position ?? ''} · ${fmtTime(s.start_at)}–${fmtTime(s.end_at)}`}
                      trailing={<span className="tabular text-[14px] text-ink-2">{fmtMoney0(shiftHours(s) * (emp?.hourly_rate ?? 0))}</span>}
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
                        leading={<Avatar name={fullName(emp)} color={emp?.color} size={32} />}
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
              .sort((a, b) => a.kind.localeCompare(b.kind) || b.amount - a.amount)
              .map((t) => (
                <ListRow
                  key={t.id}
                  onClick={() => setTxModal({ tx: t })}
                  title={t.category}
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

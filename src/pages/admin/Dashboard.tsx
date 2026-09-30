import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Clock, Euro, Inbox, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '../../auth';
import { BarChart, HBarList } from '../../components/charts';
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorBox, ListRow, LiveDot, Loading, PageHeader, StatCard } from '../../components/ui';
import { useInterval, useLoad, useNow } from '../../hooks';
import { api } from '../../lib/api';
import { DEPARTMENTS, EVENT_KINDS, isStaffExpense, REQUEST_KINDS } from '../../lib/constants';
import { addDays, businessDate, businessStart, businessToday, isoDate, makePeriod, periodRange, startOfWeek } from '../../lib/dates';
import { fmtDate, fmtDateFull, fmtDuration, fmtHours, fmtMoney, fmtMoney0, fmtPercent, fmtTime, fmtWeekday, fmtMoneyExact } from '../../lib/format';
import { byId, entryCost, entryHours, fullName, groupBy, shiftHours, sumBy } from '../../lib/utils';

const WEEKS = 8;

export default function Dashboard() {
  const { profile, employee } = useAuth();
  const navigate = useNavigate();
  const now = useNow(1000);

  const month = useMemo(() => makePeriod('month'), []);
  const firstWeek = useMemo(() => addDays(startOfWeek(businessToday()), -7 * (WEEKS - 1)), []);

  const { data, loading, error, reload } = useLoad(async () => {
    const from = [isoDate(firstWeek), month.from].sort()[0];
    const to = isoDate(addDays(businessToday(), 1));
    const today = isoDate(businessToday());
    const [employees, open, entries, tx, events, requests, shifts] = await Promise.all([
      api.employees.list(),
      api.timeEntries.list({ eq: { clock_out: null } }),
      api.timeEntries.list({ gte: ['clock_in', businessStart(from)], lt: ['clock_in', businessStart(to)] }),
      api.transactions.list({ gte: ['date', from], lt: ['date', to] }),
      api.events.list({ gte: ['date', today], order: ['date', 'asc'], limit: 5 }),
      api.requests.list({ eq: { status: 'pending' }, order: ['created_at', 'desc'] }),
      api.shifts.list({ gte: ['start_at', businessStart(today)], lt: ['start_at', businessStart(isoDate(addDays(businessToday(), 30)))] }),
    ]);
    return { employees, open, entries, tx, events, requests, shifts };
  }, []);

  useInterval(reload, 30_000);

  const stats = useMemo(() => {
    if (!data) return null;
    const { start, end } = periodRange(month);
    const monthEntries = data.entries.filter((e) => e.clock_in >= start && e.clock_in < end);
    const monthTx = data.tx.filter((t) => t.date >= month.from && t.date < month.to);
    const income = sumBy(monthTx.filter((t) => t.kind === 'income'), (t) => t.amount);
    // Gastos de personal = nóminas + camareros pagados; los fichajes sólo informan de las horas
    const expenses = sumBy(monthTx.filter((t) => t.kind === 'expense' && !isStaffExpense(t)), (t) => t.amount);
    const staff = sumBy(monthTx.filter(isStaffExpense), (t) => t.amount);
    const hours = sumBy(monthEntries, (e) => entryHours(e));
    const result = income - expenses - staff;

    const emps = byId(data.employees);
    const byDept = groupBy(monthEntries, (e) => emps.get(e.employee_id)?.department ?? 'barra');
    const deptCost = Object.entries(byDept)
      .map(([d, es]) => ({ label: DEPARTMENTS[d as keyof typeof DEPARTMENTS]?.label ?? d, value: sumBy(es, (e) => entryCost(e)) }))
      .sort((a, b) => b.value - a.value);

    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const from = addDays(firstWeek, i * 7);
      const to = addDays(from, 7);
      const f = isoDate(from);
      const t = isoDate(to);
      const wtx = data.tx.filter((x) => x.date >= f && x.date < t);
      const inc = sumBy(wtx.filter((x) => x.kind === 'income'), (x) => x.amount);
      const exp = sumBy(wtx.filter((x) => x.kind === 'expense'), (x) => x.amount);
      return { label: fmtDate(from, { day: 'numeric', month: 'numeric' }), detail: `Semana del ${fmtDate(from)}`, values: [inc, exp] };
    });

    return { income, expenses, staff, hours, result, deptCost, weeks };
  }, [data, month, firstWeek]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !stats) return null;

  const emps = byId(data.employees);
  const liveCost = sumBy(data.open, (e) => entryCost(e, now));
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Buenas noches' : hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  const name = employee?.first_name ?? profile?.full_name?.split(' ')[0] ?? '';
  const shiftsByDate = groupBy(data.shifts.filter((s) => s.status !== 'cancelled'), (s) => businessDate(s.start_at));

  return (
    <>
      <PageHeader title={`${greeting}${name ? `, ${name}` : ''}`} subtitle={fmtDateFull(new Date())} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Ingresos del mes" value={fmtMoney0(stats.income)} icon={<TrendingUp />} tone="green" sub={month.label} />
        <StatCard label="Gastos operativos" value={fmtMoney0(stats.expenses)} icon={<TrendingDown />} tone="red" sub="Sin incluir personal" />
        <StatCard label="Gastos de personal" value={fmtMoney0(stats.staff)} icon={<Users />} tone="purple" sub={`${fmtHours(stats.hours)} trabajadas`} />
        <StatCard
          label="Resultado"
          value={<span className={stats.result >= 0 ? 'text-green' : 'text-red'}>{fmtMoneyExact(stats.result)}</span>}
          icon={<Euro />}
          tone={stats.result >= 0 ? 'green' : 'red'}
          sub={stats.income ? `Margen ${fmtPercent(stats.result / stats.income)}` : '—'}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-5 lg:gap-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                En turno ahora {data.open.length > 0 && <LiveDot />}
              </span>
            }
            subtitle={data.open.length ? `${data.open.length} personas · ${fmtMoney(liveCost)} acumulado` : 'Nadie ha fichado todavía'}
            action={
              <Link to="/fichajes" className="text-[14px] font-medium text-accent">
                Ver todo
              </Link>
            }
          />
          {data.open.length ? (
            <div className="divide-y divide-line pb-2">
              {data.open
                .sort((a, b) => a.clock_in.localeCompare(b.clock_in))
                .map((e) => {
                  const emp = emps.get(e.employee_id);
                  return (
                    <ListRow
                      key={e.id}
                      onClick={() => navigate(`/personal/${e.employee_id}`)}
                      leading={<Avatar name={fullName(emp)} color={emp?.color} size={36} />}
                      title={fullName(emp)}
                      subtitle={`${emp?.position ?? ''} · desde ${fmtTime(e.clock_in)}`}
                      trailing={
                        <div>
                          <div className="tabular text-[15px] font-semibold">{fmtDuration(now - Date.parse(e.clock_in))}</div>
                          <div className="tabular text-[12px] text-ink-2">{fmtMoney(entryCost(e, now))}</div>
                        </div>
                      }
                    />
                  );
                })}
            </div>
          ) : (
            <EmptyState icon={<Clock />} title="Local cerrado" message="Cuando el equipo fiche su entrada aparecerá aquí en tiempo real." />
          )}
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-1 text-[17px] font-semibold tracking-tight">Ingresos vs. gastos</h3>
          <p className="mb-4 text-[13px] text-ink-2">Últimas {WEEKS} semanas · gastos incluye nóminas y camareros</p>
          <BarChart
            data={stats.weeks}
            series={[
              { name: 'Ingresos', color: 'rgb(var(--green))' },
              { name: 'Gastos', color: 'rgb(var(--ink-3))' },
            ]}
          />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-3 lg:gap-5">
        <Card>
          <CardHeader
            title="Próximas noches"
            action={
              <Link to="/noches" className="text-[14px] font-medium text-accent">
                Ver todas
              </Link>
            }
          />
          {data.events.length ? (
            <div className="divide-y divide-line pb-2">
              {data.events.map((ev) => {
                const s = shiftsByDate[ev.date] ?? [];
                const cost = sumBy(s, (x) => shiftHours(x) * (emps.get(x.employee_id)?.hourly_rate ?? 0));
                return (
                  <ListRow
                    key={ev.id}
                    onClick={() => navigate(`/noches/${ev.id}`)}
                    leading={
                      <div className="w-11 shrink-0 text-center leading-none">
                        <div className="text-[11px] font-semibold uppercase text-red">{fmtWeekday(ev.date)}</div>
                        <div className="mt-0.5 text-[22px] font-semibold">{ev.date.slice(8)}</div>
                      </div>
                    }
                    title={ev.name}
                    subtitle={`${s.length} en turno · ${fmtMoney0(cost)} previsto`}
                    trailing={<Badge tone={EVENT_KINDS[ev.kind].tone}>{EVENT_KINDS[ev.kind].label}</Badge>}
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState title="Sin noches programadas" message="Crea la próxima noche desde la sección Noches." />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Solicitudes pendientes"
            action={
              <Link to="/solicitudes" className="text-[14px] font-medium text-accent">
                Gestionar
              </Link>
            }
          />
          {data.requests.length ? (
            <div className="divide-y divide-line pb-2">
              {data.requests.slice(0, 5).map((r) => {
                const emp = emps.get(r.employee_id);
                return (
                  <ListRow
                    key={r.id}
                    onClick={() => navigate('/solicitudes')}
                    leading={<Avatar name={fullName(emp)} color={emp?.color} size={36} />}
                    title={fullName(emp)}
                    subtitle={`${REQUEST_KINDS[r.kind]} · ${fmtDate(r.start_date)}${r.end_date !== r.start_date ? ` – ${fmtDate(r.end_date)}` : ''}`}
                    chevron
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<Inbox />} title="Todo al día" message="No hay solicitudes pendientes." />
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[17px] font-semibold tracking-tight">Personal por departamento</h3>
              <p className="text-[13px] text-ink-2">{month.label}</p>
            </div>
            <Link to="/nominas" className="grid h-8 w-8 place-items-center rounded-full bg-fill text-ink-2 hover:text-ink" aria-label="Nóminas">
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
          <HBarList items={stats.deptCost} color="rgb(var(--purple))" empty="Sin fichajes este mes" />
        </Card>
      </div>
    </>
  );
}

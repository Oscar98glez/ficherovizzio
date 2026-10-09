import { useMemo, useState } from 'react';
import { Clock, Download, Plus, Square } from 'lucide-react';
import { LocationTag } from '../../components/clock-location';
import { EntryForm } from '../../components/forms';
import { useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, IconButton, LiveDot, Loading, PageHeader, Select, StatCard } from '../../components/ui';
import { useInterval, useLoad, useNow } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { businessDate, makePeriod, periodRange } from '../../lib/dates';
import { fmtDateLong, fmtDuration, fmtHours, fmtMoney, fmtMoney0, fmtTime } from '../../lib/format';
import type { TimeEntry } from '../../lib/types';
import { byId, cx, downloadCSV, entryCost, entryHours, fullName, groupBy, sumBy } from '../../lib/utils';

export default function TimeEntries() {
  const { toast } = useFeedback();
  const now = useNow(1000);
  const [period, setPeriod] = useState(() => makePeriod('week'));
  const [employeeId, setEmployeeId] = useState('');
  const [modal, setModal] = useState<{ entry: TimeEntry | null } | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [employees, entries, open] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end], order: ['clock_in', 'desc'] }),
      api.timeEntries.list({ eq: { clock_out: null } }),
    ]);
    return { employees, entries, open };
  }, [period]);

  useInterval(reload, 60_000);

  const filtered = useMemo(
    () => (data?.entries ?? []).filter((e) => !employeeId || e.employee_id === employeeId),
    [data, employeeId],
  );

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const emps = byId(data.employees);
  const nights = groupBy(filtered, (e) => businessDate(e.clock_in));
  const nightKeys = Object.keys(nights).sort().reverse();
  const totalHours = sumBy(filtered, (e) => entryHours(e, now));
  const totalCost = sumBy(filtered, (e) => entryCost(e, now));

  async function closeEntry(e: TimeEntry) {
    try {
      await api.timeEntries.update(e.id, { clock_out: new Date().toISOString() });
      toast.success(`Salida de ${fullName(emps.get(e.employee_id))} registrada`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const exportCsv = () =>
    downloadCSV(`fichajes-${period.from}.csv`, [
      ['Noche', 'Empleado', 'Puesto', 'Entrada', 'Salida', 'Pausa (min)', 'Horas', '€/hora', 'Coste', 'Origen', 'Notas', 'Entrada: m al local', 'Entrada fuera', 'Salida: m al local', 'Salida fuera'],
      ...[...filtered].reverse().map((e) => {
        const emp = emps.get(e.employee_id);
        return [
          businessDate(e.clock_in),
          fullName(emp),
          emp?.position,
          new Date(e.clock_in).toLocaleString('es-ES'),
          e.clock_out ? new Date(e.clock_out).toLocaleString('es-ES') : '',
          e.break_minutes,
          Math.round(entryHours(e) * 100) / 100,
          e.hourly_rate,
          Math.round(entryCost(e) * 100) / 100,
          e.source === 'app' ? 'App' : 'Manual',
          e.notes,
          e.clock_in_distance ?? '',
          e.clock_in_outside == null ? '' : e.clock_in_outside ? 'Sí' : 'No',
          e.clock_out_distance ?? '',
          e.clock_out_outside == null ? '' : e.clock_out_outside ? 'Sí' : 'No',
        ];
      }),
    ]);

  return (
    <>
      <PageHeader
        title="Fichajes"
        subtitle="Registro de entradas y salidas del equipo"
        actions={
          <>
            <Button variant="secondary" icon={<Download />} onClick={exportCsv} className="hidden sm:inline-flex">
              Exportar
            </Button>
            <Button icon={<Plus />} onClick={() => setModal({ entry: null })}>
              Añadir fichaje
            </Button>
          </>
        }
      />

      {data.open.length > 0 && (
        <Card className="mb-5 p-4">
          <div className="mb-3 flex items-center gap-2 px-1">
            <LiveDot />
            <span className="text-[15px] font-semibold">En turno ahora</span>
            <span className="text-[14px] text-ink-2">· {data.open.length}</span>
          </div>
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
            {data.open.map((e) => {
              const emp = emps.get(e.employee_id);
              return (
                <div key={e.id} className="flex shrink-0 items-center gap-2.5 rounded-2xl bg-fill/60 py-2 pl-2 pr-2">
                  <Avatar name={fullName(emp)} color={emp?.color} src={emp?.photo_url} size={34} />
                  <div className="leading-tight">
                    <div className="text-[14px] font-medium">{emp?.first_name}</div>
                    <div className="tabular text-[12px] text-ink-2">{fmtDuration(now - Date.parse(e.clock_in))}</div>
                    {e.clock_in_outside && <div className="text-[11px] font-medium text-red">Fuera del local</div>}
                  </div>
                  <IconButton label="Fichar salida" onClick={() => closeEntry(e)} className="ml-1 bg-red/10 text-red hover:bg-red/20 hover:text-red">
                    <Square className="!h-3.5 !w-3.5" fill="currentColor" />
                  </IconButton>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PeriodPicker period={period} onChange={setPeriod} />
        <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="h-9 rounded-[10px] text-[14px] sm:w-60">
          <option value="">Todo el equipo</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {fullName(e)}
            </option>
          ))}
        </Select>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3 lg:gap-4">
        <StatCard label="Horas" value={fmtHours(totalHours)} />
        <StatCard label="Coste" value={fmtMoney0(totalCost)} />
        <StatCard label="Noches" value={nightKeys.length} />
      </div>

      {nightKeys.length ? (
        <div className="space-y-5">
          {nightKeys.map((date) => {
            const list = nights[date].sort((a, b) => a.clock_in.localeCompare(b.clock_in));
            return (
              <section key={date}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-[15px] font-semibold">{fmtDateLong(date)}</h2>
                  <span className="tabular text-[13px] text-ink-2">
                    {list.length} pers. · {fmtHours(sumBy(list, (e) => entryHours(e, now)))} · {fmtMoney0(sumBy(list, (e) => entryCost(e, now)))}
                  </span>
                </div>
                <Card className="divide-y divide-line overflow-hidden">
                  {list.map((e) => {
                    const emp = emps.get(e.employee_id);
                    return (
                      <button
                        key={e.id}
                        onClick={() => setModal({ entry: e })}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60 md:grid-cols-[minmax(0,1.6fr)_150px_90px_90px_100px] md:px-5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={fullName(emp)} color={emp?.color} src={emp?.photo_url} size={36} />
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-medium">{fullName(emp)}</div>
                            <div className="truncate text-[13px] text-ink-2">
                              <span className="md:hidden">
                                {fmtTime(e.clock_in)} – {e.clock_out ? fmtTime(e.clock_out) : 'en curso'} ·{' '}
                              </span>
                              {emp?.position}
                            </div>
                            <LocationTag entry={e} className="max-w-full" />
                          </div>
                        </div>
                        <div className="tabular hidden text-[14px] md:block">
                          {fmtTime(e.clock_in)} – {e.clock_out ? fmtTime(e.clock_out) : <span className="font-medium text-green">en curso</span>}
                        </div>
                        <div className="hidden md:block">
                          <Badge tone={e.source === 'app' ? 'blue' : 'gray'}>{e.source === 'app' ? 'App' : 'Manual'}</Badge>
                        </div>
                        <div className={cx('tabular hidden text-right text-[14px] text-ink-2 md:block')}>
                          {fmtHours(entryHours(e, now))}
                          {e.break_minutes > 0 && <div className="text-[11px]">−{e.break_minutes} min</div>}
                        </div>
                        <div className="tabular text-right text-[15px] font-semibold md:text-[14px]">
                          {fmtMoney(entryCost(e, now))}
                          <div className="text-[12px] font-normal text-ink-2 md:hidden">{fmtHours(entryHours(e, now))}</div>
                        </div>
                      </button>
                    );
                  })}
                </Card>
              </section>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Clock />} title="Sin fichajes en este periodo" message="Los fichajes del equipo aparecerán aquí agrupados por noche." />
        </Card>
      )}

      <EntryForm open={!!modal} onClose={() => setModal(null)} entry={modal?.entry} employees={data.employees} onSaved={reload} />
    </>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Download, Plus, Users } from 'lucide-react';
import { EmployeeForm } from '../../components/forms';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, LiveDot, Loading, PageHeader, SearchInput, Segmented, Select } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { CONTRACTS, DEPARTMENTS } from '../../lib/constants';
import { makePeriod, periodRange } from '../../lib/dates';
import { fmtHours, fmtMoney, fmtMoney0 } from '../../lib/format';
import type { Department } from '../../lib/types';
import { downloadCSV, entryCost, entryHours, fullName, groupBy, sumBy } from '../../lib/utils';

type Filter = 'active' | 'inactive' | 'all';

export default function Employees() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [dept, setDept] = useState<Department | ''>('');
  const [creating, setCreating] = useState(false);
  const month = useMemo(() => makePeriod('month'), []);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(month);
    const [employees, entries] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] }),
    ]);
    return { employees, entries };
  }, [month]);

  const rows = useMemo(() => {
    if (!data) return [];
    const byEmp = groupBy(data.entries, (e) => e.employee_id);
    const term = q.trim().toLowerCase();
    return data.employees
      .filter((e) => (filter === 'all' ? true : filter === 'active' ? e.active : !e.active))
      .filter((e) => !dept || e.department === dept)
      .filter((e) => !term || `${fullName(e)} ${e.position} ${e.email ?? ''}`.toLowerCase().includes(term))
      .map((e) => {
        const es = byEmp[e.id] ?? [];
        return { e, hours: sumBy(es, (x) => entryHours(x)), cost: sumBy(es, (x) => entryCost(x)), live: es.some((x) => !x.clock_out) };
      });
  }, [data, q, filter, dept]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const activeCount = data.employees.filter((e) => e.active).length;
  const totalCost = sumBy(rows, (r) => r.cost);

  const exportCsv = () =>
    downloadCSV(`personal-${month.from.slice(0, 7)}.csv`, [
      ['Nombre', 'Email', 'Teléfono', 'Puesto', 'Departamento', 'Contrato', '€/hora', `Horas ${month.label}`, `Coste ${month.label}`, 'Activo'],
      ...rows.map(({ e, hours, cost }) => [
        fullName(e),
        e.email,
        e.phone,
        e.position,
        DEPARTMENTS[e.department].label,
        CONTRACTS[e.contract_type],
        e.hourly_rate,
        Math.round(hours * 100) / 100,
        Math.round(cost * 100) / 100,
        e.active ? 'Sí' : 'No',
      ]),
    ]);

  return (
    <>
      <PageHeader
        title="Personal"
        subtitle={`${activeCount} personas activas · ${fmtMoney0(totalCost)} en ${month.label.toLowerCase()}`}
        actions={
          <>
            <Button variant="secondary" icon={<Download />} onClick={exportCsv} className="hidden sm:inline-flex">
              Exportar
            </Button>
            <Button icon={<Plus />} onClick={() => setCreating(true)}>
              Nuevo empleado
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, puesto o email" className="sm:w-80" />
        <div className="flex flex-wrap gap-2">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Activos' },
              { value: 'inactive', label: 'Inactivos' },
              { value: 'all', label: 'Todos' },
            ]}
          />
          <Select value={dept} onChange={(e) => setDept(e.target.value as Department | '')} className="h-9 w-full rounded-[10px] text-[14px] sm:w-auto">
            <option value="">Todos los departamentos</option>
            {Object.entries(DEPARTMENTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length ? (
          <>
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_90px_100px_110px_24px] gap-4 border-b border-line px-5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3 md:grid">
              <span>Nombre</span>
              <span>Departamento</span>
              <span className="text-right">€/hora</span>
              <span className="text-right">Horas mes</span>
              <span className="text-right">Coste mes</span>
              <span />
            </div>
            <div className="divide-y divide-line">
              {rows.map(({ e, hours, cost, live }) => (
                <button
                  key={e.id}
                  onClick={() => navigate(`/personal/${e.id}`)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_90px_100px_110px_24px] md:gap-4 md:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={fullName(e)} color={e.color} src={e.photo_url} size={40} className={e.active ? '' : 'opacity-40 grayscale'} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-medium">{fullName(e)}</span>
                        {live && <LiveDot />}
                      </div>
                      <div className="truncate text-[13px] text-ink-2">
                        {e.position}
                        {!e.user_id && <span className="text-ink-3"> · sin cuenta</span>}
                        {e.hourly_rate === 0 && <span className="font-medium text-orange"> · falta tarifa</span>}
                      </div>
                    </div>
                  </div>
                  <div className="hidden md:block">
                    <Badge tone={DEPARTMENTS[e.department].tone}>{DEPARTMENTS[e.department].label}</Badge>
                  </div>
                  <div className="tabular hidden text-right text-[14px] md:block">{fmtMoney(e.hourly_rate)}</div>
                  <div className="tabular hidden text-right text-[14px] text-ink-2 md:block">{fmtHours(hours)}</div>
                  <div className="tabular text-right text-[15px] font-semibold md:text-[14px]">
                    {fmtMoney0(cost)}
                    <div className="text-[12px] font-normal text-ink-2 md:hidden">{fmtHours(hours)}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-3" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Users />}
            title={data.employees.length ? 'Sin resultados' : 'Aún no hay personal'}
            message={data.employees.length ? 'Prueba con otra búsqueda o filtro.' : 'Da de alta a tu equipo para empezar a controlar horas y costes.'}
            action={!data.employees.length && <Button icon={<Plus />} onClick={() => setCreating(true)}>Añadir el primero</Button>}
          />
        )}
      </Card>

      <EmployeeForm open={creating} onClose={() => setCreating(false)} onSaved={(e) => navigate(`/personal/${e.id}`)} />
    </>
  );
}

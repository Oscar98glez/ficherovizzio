import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Download, Plus, Users } from 'lucide-react';
import { EmployeeForm } from '../../components/forms';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, LiveDot, Loading, PageHeader, SearchInput, Segmented, Select } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api } from '../../lib/api';
import { CONTRACTS, DEPARTMENTS, isActiveReservation } from '../../lib/constants';
import { makePeriod, periodRange } from '../../lib/dates';
import { fmtHours, fmtMoney, fmtMoney0 } from '../../lib/format';
import type { Department, Employee, Role } from '../../lib/types';
import { cx, downloadCSV, entryCost, entryHours, fullName, groupBy, sumBy } from '../../lib/utils';

type Filter = 'active' | 'inactive' | 'all';
type Kind = Role;

const KINDS: { value: Kind; label: string }[] = [
  { value: 'worker', label: 'Camareros' },
  { value: 'rrpp', label: 'RRPP' },
  { value: 'admin', label: 'Administración' },
];

const KIND_KEY = 'vizzio.personal.kind';
const savedKind = (): Kind => {
  try {
    const v = localStorage.getItem(KIND_KEY);
    return v === 'rrpp' || v === 'admin' ? v : 'worker';
  } catch {
    return 'worker';
  }
};

/** Tipo de usuario: el rol de su cuenta; sin cuenta, RRPP si es de relaciones públicas y camarero si no */
const kindOf = (e: Employee, roles: Map<string, Role>): Kind => (e.user_id && roles.get(e.user_id)) || (e.department === 'relaciones' ? 'rrpp' : 'worker');

export default function Employees() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [dept, setDept] = useState<Department | ''>('');
  const [kind, setKindState] = useState<Kind>(savedKind);
  const setKind = (k: Kind) => {
    setKindState(k);
    try {
      localStorage.setItem(KIND_KEY, k);
    } catch {
      /* sin almacenamiento */
    }
  };
  const [creating, setCreating] = useState(false);
  const month = useMemo(() => makePeriod('month'), []);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(month);
    const [employees, entries, profiles, reservations] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] }),
      api.profiles.list(),
      // Reservas del mes, para la pestaña de RRPP (si aún no existe la tabla, se omiten)
      api.reservations.list({ gte: ['date', month.from], lt: ['date', month.to] }).catch(() => []),
    ]);
    const roles = new Map(profiles.map((p) => [p.id, p.role]));
    return { employees: employees.map((e) => ({ ...e, kind: kindOf(e, roles) })), entries, reservations };
  }, [month]);

  const rows = useMemo(() => {
    if (!data) return [];
    const byEmp = groupBy(data.entries, (e) => e.employee_id);
    const resByRrpp = groupBy(
      data.reservations.filter((r) => r.rrpp_id && isActiveReservation(r)),
      (r) => r.rrpp_id!,
    );
    const term = q.trim().toLowerCase();
    return data.employees
      .filter((e) => e.kind === kind)
      .filter((e) => (filter === 'all' ? true : filter === 'active' ? e.active : !e.active))
      .filter((e) => !dept || e.department === dept)
      .filter((e) => !term || `${fullName(e)} ${e.position} ${e.email ?? ''}`.toLowerCase().includes(term))
      .map((e) => {
        const es = byEmp[e.id] ?? [];
        const rs = resByRrpp[e.id] ?? [];
        return {
          e,
          hours: sumBy(es, (x) => entryHours(x)),
          cost: sumBy(es, (x) => entryCost(x)),
          live: es.some((x) => !x.clock_out),
          reservations: rs.length,
          sales: sumBy(rs, (r) => r.total_amount ?? 0),
        };
      });
  }, [data, q, filter, dept, kind]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const activeCount = data.employees.filter((e) => e.active).length;
  const counts = Object.fromEntries(KINDS.map((k) => [k.value, data.employees.filter((e) => e.kind === k.value && e.active).length])) as Record<Kind, number>;
  const isRrpp = kind === 'rrpp';
  const cols = isRrpp
    ? 'md:grid-cols-[minmax(0,2.2fr)_90px_120px_100px_110px_24px]'
    : 'md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_90px_100px_110px_24px]';
  const totalCost = sumBy(data.entries, (x) => entryCost(x));

  const exportCsv = () =>
    downloadCSV(`personal-${KINDS.find((k) => k.value === kind)!.label.toLowerCase()}-${month.from.slice(0, 7)}.csv`, [
      [
        'Nombre', 'Email', 'Teléfono', 'Puesto', 'Departamento', 'Contrato', '€/hora', `Horas ${month.label}`, `Coste ${month.label}`,
        ...(isRrpp ? [`Reservas ${month.label}`, `Importe reservas ${month.label}`] : []),
        'Activo',
      ],
      ...rows.map(({ e, hours, cost, reservations, sales }) => [
        fullName(e),
        e.email,
        e.phone,
        e.position,
        DEPARTMENTS[e.department].label,
        CONTRACTS[e.contract_type],
        e.hourly_rate,
        Math.round(hours * 100) / 100,
        Math.round(cost * 100) / 100,
        ...(isRrpp ? [reservations, Math.round(sales * 100) / 100] : []),
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

      <div className="mb-4 overflow-x-auto">
        <Segmented
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({ value: k.value, label: `${k.label} · ${counts[k.value]}` }))}
        />
      </div>

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
            <div className={cx('hidden gap-4 border-b border-line px-5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3 md:grid', cols)}>
              <span>Nombre</span>
              {isRrpp ? (
                <>
                  <span className="text-right">Reservas mes</span>
                  <span className="text-right">Importe reservas</span>
                </>
              ) : (
                <>
                  <span>Departamento</span>
                  <span className="text-right">€/hora</span>
                </>
              )}
              <span className="text-right">Horas mes</span>
              <span className="text-right">Coste mes</span>
              <span />
            </div>
            <div className="divide-y divide-line">
              {rows.map(({ e, hours, cost, live, reservations, sales }) => (
                <button
                  key={e.id}
                  onClick={() => navigate(`/personal/${e.id}`)}
                  className={cx('grid w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60 md:gap-4 md:px-5', cols)}
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
                  {isRrpp ? (
                    <>
                      <div className="tabular hidden text-right text-[14px] md:block">{reservations}</div>
                      <div className="tabular hidden text-right text-[14px] md:block">{fmtMoney0(sales)}</div>
                    </>
                  ) : (
                    <>
                      <div className="hidden md:block">
                        <Badge tone={DEPARTMENTS[e.department].tone}>{DEPARTMENTS[e.department].label}</Badge>
                      </div>
                      <div className="tabular hidden text-right text-[14px] md:block">{fmtMoney(e.hourly_rate)}</div>
                    </>
                  )}
                  <div className="tabular hidden text-right text-[14px] text-ink-2 md:block">{fmtHours(hours)}</div>
                  <div className="tabular text-right text-[15px] font-semibold md:text-[14px]">
                    {fmtMoney0(cost)}
                    <div className="text-[12px] font-normal text-ink-2 md:hidden">
                      {fmtHours(hours)}
                      {isRrpp && ` · ${reservations} reservas`}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-3" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Users />}
            title={data.employees.length ? (counts[kind] || filter !== 'active' || q || dept ? 'Sin resultados' : `No hay ${KINDS.find((k) => k.value === kind)!.label.toLowerCase()} activos`) : 'Aún no hay personal'}
            message={data.employees.length ? 'Prueba con otra pestaña, búsqueda o filtro.' : 'Da de alta a tu equipo para empezar a controlar horas y costes.'}
            action={!data.employees.length && <Button icon={<Plus />} onClick={() => setCreating(true)}>Añadir el primero</Button>}
          />
        )}
      </Card>

      <EmployeeForm open={creating} onClose={() => setCreating(false)} onSaved={(e) => navigate(`/personal/${e.id}`)} />
    </>
  );
}

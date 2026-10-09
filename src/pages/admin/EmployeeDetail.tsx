import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Copy, LogIn, LogOut, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth';
import { EmployeeForm, EntryForm } from '../../components/forms';
import { RrppCommissionCard } from '../../components/rrpp-commissions';
import { useFeedback } from '../../components/overlay';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorBox, ListRow, LiveDot, Loading, Segmented, StatCard } from '../../components/ui';
import { useLoad, useNow } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { CONTRACTS, DEPARTMENTS, ROLES, SHIFT_STATUS } from '../../lib/constants';
import { addDays, businessDate, businessStart, businessToday, isoDate, makePeriod, periodRange } from '../../lib/dates';
import { fmtDate, fmtDateLong, fmtDuration, fmtHours, fmtMoney, fmtTime, fmtShiftTimes } from '../../lib/format';
import type { Role, TimeEntry } from '../../lib/types';
import { entryCost, entryHours, fullName, sumBy } from '../../lib/utils';

export default function EmployeeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { userId } = useAuth();
  const { toast, confirm } = useFeedback();
  const now = useNow(1000);
  const [editing, setEditing] = useState(false);
  const [entryModal, setEntryModal] = useState<{ entry: TimeEntry | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const month = useMemo(() => makePeriod('month'), []);

  const { data, loading, error, reload } = useLoad(async () => {
    const since = isoDate(addDays(businessToday(), -45));
    const [employee, entries, shifts, allEmployees] = await Promise.all([
      api.employees.get(id),
      api.timeEntries.list({ eq: { employee_id: id }, gte: ['clock_in', businessStart([since, month.from].sort()[0])], order: ['clock_in', 'desc'] }),
      api.shifts.list({ eq: { employee_id: id }, gte: ['start_at', businessStart(isoDate(businessToday()))], order: ['start_at', 'asc'], limit: 8 }),
      api.employees.list({ order: ['first_name', 'asc'] }),
    ]);
    const profile = employee?.user_id ? await api.profiles.get(employee.user_id).catch(() => null) : null;
    return { employee, entries, shifts, profile, allEmployees };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data?.employee) return <EmptyState title="Empleado no encontrado" action={<Link to="/personal" className="text-accent">Volver a Personal</Link>} />;

  const e = data.employee;
  const { start, end } = periodRange(month);
  const monthEntries = data.entries.filter((x) => x.clock_in >= start && x.clock_in < end);
  const hours = sumBy(monthEntries, (x) => entryHours(x, now));
  const cost = sumBy(monthEntries, (x) => entryCost(x, now));
  const nights = new Set(monthEntries.map((x) => businessDate(x.clock_in))).size;
  const open = data.entries.find((x) => !x.clock_out);
  // RRPP: por el perfil de su cuenta o, sin cuenta, por ser de relaciones públicas
  const isRrpp = data.profile ? data.profile.role === 'rrpp' : e.department === 'relaciones';

  async function toggleClock() {
    setBusy(true);
    try {
      if (open) {
        await api.timeEntries.update(open.id, { clock_out: new Date().toISOString() });
        toast.success(`Salida registrada a las ${fmtTime(new Date())}`);
      } else {
        const [ev] = await api.events.list({ eq: { date: isoDate(businessToday()) }, limit: 1 });
        await api.timeEntries.create({ employee_id: e.id, clock_in: new Date().toISOString(), hourly_rate: e.hourly_rate, source: 'manual', event_id: ev?.id ?? null });
        toast.success(`Entrada registrada a las ${fmtTime(new Date())}`);
      }
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setRole(role: Role) {
    if (!data?.profile) return;
    try {
      await api.profiles.update(data.profile.id, { role });
      toast.success(`Ahora es ${role === 'rrpp' || role === 'tech' ? ROLES[role] : ROLES[role].toLowerCase()}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `¿Eliminar a ${fullName(e)}?`,
      message: 'Se borrarán también todos sus fichajes y turnos. Si solo ha dejado de trabajar, mejor márcalo como inactivo.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.employees.remove(e.id);
      toast.success('Empleado eliminado');
      navigate('/personal');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const signupUrl = `${window.location.origin}/registro`;

  return (
    <>
      <Link to="/personal" className="mb-4 inline-flex items-center gap-0.5 text-[15px] text-accent hover:opacity-70">
        <ChevronLeft className="h-5 w-5" /> Personal
      </Link>

      <Card className="mb-4 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={fullName(e)} color={e.color} src={e.photo_url} size={84} className={e.active ? '' : 'opacity-50 grayscale'} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[26px] font-bold tracking-tight">{fullName(e)}</h1>
              {open && (
                <Badge tone="green">
                  <LiveDot className="mr-0.5" /> En turno
                </Badge>
              )}
              {!e.active && <Badge>Inactivo</Badge>}
            </div>
            <p className="text-[15px] text-ink-2">
              {e.position} · {DEPARTMENTS[e.department].label} · {CONTRACTS[e.contract_type]}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {e.email && (
                <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[13px] font-medium hover:bg-fill-2">
                  <Mail className="h-3.5 w-3.5" /> {e.email}
                </a>
              )}
              {e.phone && (
                <a href={`tel:${e.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[13px] font-medium hover:bg-fill-2">
                  <Phone className="h-3.5 w-3.5" /> {e.phone}
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
            {e.active && (
              <Button variant={open ? 'danger' : 'success'} icon={open ? <LogOut /> : <LogIn />} loading={busy} onClick={toggleClock}>
                {open ? `Fichar salida · ${fmtDuration(now - Date.parse(open.clock_in))}` : 'Fichar entrada'}
              </Button>
            )}
            <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
              Editar
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
        <StatCard label="Coste por hora" value={fmtMoney(e.hourly_rate)} />
        <StatCard label={`Horas · ${month.label}`} value={fmtHours(hours)} />
        <StatCard label={`Coste · ${month.label}`} value={fmtMoney(cost)} tone="purple" />
        <StatCard label="Noches trabajadas" value={nights} sub={nights ? `${fmtHours(hours / nights)} de media` : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-3 lg:gap-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Fichajes recientes"
            subtitle="Últimos 45 días"
            action={
              <Button size="sm" variant="tinted" icon={<Plus />} onClick={() => setEntryModal({ entry: null })}>
                Añadir
              </Button>
            }
          />
          {data.entries.length ? (
            <div className="divide-y divide-line pb-2">
              {data.entries.slice(0, 25).map((x) => (
                <ListRow
                  key={x.id}
                  onClick={() => setEntryModal({ entry: x })}
                  title={fmtDateLong(businessDate(x.clock_in))}
                  subtitle={
                    <>
                      {fmtTime(x.clock_in)} – {x.clock_out ? fmtTime(x.clock_out) : 'en curso'}
                      {x.break_minutes > 0 && ` · pausa ${x.break_minutes} min`}
                      {x.source === 'manual' && ' · manual'}
                    </>
                  }
                  trailing={
                    <div>
                      <div className="tabular text-[15px] font-semibold">{fmtHours(entryHours(x, now))}</div>
                      <div className="tabular text-[12px] text-ink-2">{fmtMoney(entryCost(x, now))}</div>
                    </div>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState title="Sin fichajes" message="Todavía no hay fichajes registrados." />
          )}
        </Card>

        <div className="space-y-4 lg:space-y-5">
          <Card>
            <CardHeader title="Acceso a la app" />
            <div className="px-5 pb-5">
              {e.user_id ? (
                <>
                  <p className="mb-3 text-[14px] text-ink-2">Cuenta vinculada{data.profile ? ` a ${data.profile.email}` : ''}.</p>
                  {data.profile && (
                    <Segmented
                      full
                      value={data.profile.role}
                      onChange={(r) => (data.profile!.id === userId ? toast.error('No puedes cambiar tu propio rol') : setRole(r))}
                      options={[
                        { value: 'worker', label: 'Barra' },
                        { value: 'tray', label: 'Bandeja' },
                        { value: 'tech', label: 'DJ / Técnico' },
                        { value: 'rrpp', label: 'RRPP' },
                        { value: 'admin', label: 'Admin' },
                      ]}
                    />
                  )}
                </>
              ) : e.email ? (
                <>
                  <p className="text-[14px] text-ink-2">
                    Aún no tiene cuenta. Pídele que se registre con <strong className="text-ink">{e.email}</strong> en:
                  </p>
                  <button
                    onClick={() => navigator.clipboard?.writeText(signupUrl).then(() => toast.success('Enlace copiado'))}
                    className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl bg-fill px-3.5 py-2.5 text-left text-[14px] font-medium text-accent"
                  >
                    <span className="truncate">{signupUrl}</span>
                    <Copy className="h-4 w-4 shrink-0" />
                  </button>
                </>
              ) : (
                <p className="text-[14px] text-ink-2">Añade un email a su ficha para que pueda registrarse y fichar desde el móvil.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Próximos turnos" />
            {data.shifts.length ? (
              <div className="divide-y divide-line pb-2">
                {data.shifts.map((s) => (
                  <ListRow
                    key={s.id}
                    title={fmtDate(businessDate(s.start_at), { weekday: 'long', day: 'numeric', month: 'short' })}
                    subtitle={fmtShiftTimes(s)}
                    trailing={<Badge tone={SHIFT_STATUS[s.status].tone}>{SHIFT_STATUS[s.status].label}</Badge>}
                  />
                ))}
              </div>
            ) : (
              <p className="px-5 pb-5 text-[14px] text-ink-2">Sin turnos asignados.</p>
            )}
          </Card>

          {e.notes && (
            <Card className="p-5">
              <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Notas</h3>
              <p className="whitespace-pre-wrap text-[14px]">{e.notes}</p>
            </Card>
          )}

          <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={remove}>
            Eliminar empleado
          </Button>
        </div>
      </div>

      {isRrpp && (
        <div className="mt-4 lg:mt-5">
          <RrppCommissionCard employee={e} />
        </div>
      )}

      <EmployeeForm open={editing} onClose={() => setEditing(false)} employee={e} onSaved={reload} rrpp={isRrpp} />
      <EntryForm
        open={!!entryModal}
        onClose={() => setEntryModal(null)}
        entry={entryModal?.entry}
        employees={data.allEmployees}
        defaultEmployeeId={e.id}
        onSaved={reload}
      />
    </>
  );
}

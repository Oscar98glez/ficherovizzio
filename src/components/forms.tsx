import { useEffect, useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { CONTRACTS, DEPARTMENTS, departmentOfPosition, EMPLOYEE_COLORS, POSITION_GROUPS, POSITIONS, SHIFT_STATUS } from '../lib/constants';

const OTHER_POSITION = '__otro__';
import { businessDate, businessToday, fromLocalInput, isoDate, nightStart, toLocalInput, toTimeInput } from '../lib/dates';
import { fmtHours, fmtMoney, fmtTime } from '../lib/format';
import type { Availability, ClubEvent, ContractType, Department, Employee, Shift, ShiftStatus, TimeEntry } from '../lib/types';
import { availabilityLabel, hhmm } from '../lib/availability';
import { cx, entryHours, fullName, parseAmount } from '../lib/utils';
import { Modal, useFeedback } from './overlay';
import { PhotoPicker } from './PhotoPicker';
import { Avatar, Button, Field, Input, Segmented, Select, Switch, Textarea } from './ui';

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={onClick}>
      {label}
    </Button>
  );
}

function useDelete() {
  const { confirm, toast } = useFeedback();
  return async (opts: { title: string; message?: string; run: () => Promise<void>; done: () => void }) => {
    if (!(await confirm({ title: opts.title, message: opts.message ?? 'Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', destructive: true })))
      return;
    try {
      await opts.run();
      toast.success('Eliminado');
      opts.done();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

// =====================================================================
//  Empleado
// =====================================================================

interface EmployeeFormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  position: string;
  department: Department;
  contract_type: ContractType;
  hourly_rate: string;
  hire_date: string;
  color: string;
  active: boolean;
  notes: string;
  photo_url: string | null;
}

const toEmployeeForm = (e?: Employee | null): EmployeeFormState => ({
  first_name: e?.first_name ?? '',
  last_name: e?.last_name ?? '',
  email: e?.email ?? '',
  phone: e?.phone ?? '',
  position: e?.position ?? 'Camarero/a',
  department: e?.department ?? 'barra',
  contract_type: e?.contract_type ?? 'fijo_discontinuo',
  hourly_rate: e ? String(e.hourly_rate).replace('.', ',') : '',
  hire_date: e?.hire_date ?? isoDate(new Date()),
  color: e?.color ?? EMPLOYEE_COLORS[Math.floor(Math.random() * EMPLOYEE_COLORS.length)],
  active: e?.active ?? true,
  notes: e?.notes ?? '',
  photo_url: e?.photo_url ?? null,
});

export function EmployeeForm({
  open,
  onClose,
  employee,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  employee?: Employee | null;
  onSaved: (e: Employee) => void;
}) {
  const { toast } = useFeedback();
  const [f, setF] = useState(() => toEmployeeForm(employee));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setF(toEmployeeForm(employee));
  }, [open, employee]);
  const set = <K extends keyof EmployeeFormState>(k: K, v: EmployeeFormState[K]) => setF((s) => ({ ...s, [k]: v }));
  // Puesto escrito a mano (no está en la lista)
  const [otherPosition, setOtherPosition] = useState(false);
  useEffect(() => {
    if (open) setOtherPosition(!!employee && !POSITIONS.includes(employee.position));
  }, [open, employee]);

  async function submit() {
    if (!f.first_name.trim()) return toast.error('El nombre es obligatorio');
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email.trim())) return toast.error('El email no es válido');
    setSaving(true);
    try {
      const values: Partial<Employee> = {
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        email: f.email.trim().toLowerCase() || null,
        phone: f.phone.trim() || null,
        position: f.position.trim() || 'Camarero/a',
        department: f.department,
        contract_type: f.contract_type,
        hourly_rate: parseAmount(f.hourly_rate),
        hire_date: f.hire_date || null,
        color: f.color,
        active: f.active,
        notes: f.notes.trim() || null,
        // La foto sólo se envía si ha cambiado
        ...(f.photo_url !== (employee?.photo_url ?? null) ? { photo_url: f.photo_url } : {}),
      };
      const saved = employee ? await api.employees.update(employee.id, values) : await api.employees.create(values);
      toast.success(employee ? 'Cambios guardados' : 'Empleado creado');
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const name = `${f.first_name} ${f.last_name}`.trim() || '?';

  return (
    <Modal open={open} onClose={onClose} title={employee ? 'Editar empleado' : 'Nuevo empleado'} onSubmit={submit} submitLabel={employee ? 'Guardar' : 'Crear'} saving={saving}>
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3">
          <PhotoPicker name={name} color={f.color} src={f.photo_url} size={96} folder={employee?.id ?? 'nuevos'} onChange={(url) => set('photo_url', url)} removeOld={false} />
          <div className="flex flex-wrap justify-center gap-2">
            {EMPLOYEE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => set('color', c)}
                className={cx('grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-surface transition', f.color === c && 'ring-2 ring-accent')}
                style={{ background: c }}
              >
                {f.color === c && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre">
            <Input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} autoFocus required />
          </Field>
          <Field label="Apellidos">
            <Input value={f.last_name} onChange={(e) => set('last_name', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email" hint="Con este email podrá registrarse y fichar desde su móvil.">
            <Input type="email" inputMode="email" autoComplete="off" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Teléfono">
            <Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Puesto">
            <Select
              value={otherPosition ? OTHER_POSITION : f.position}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OTHER_POSITION) {
                  setOtherPosition(true);
                  set('position', '');
                } else {
                  setOtherPosition(false);
                  // Al elegir un puesto se asigna también su departamento
                  setF((s) => ({ ...s, position: v, department: departmentOfPosition(v) ?? s.department }));
                }
              }}
            >
              {POSITION_GROUPS.map((g) => (
                <optgroup key={g.department} label={DEPARTMENTS[g.department].label}>
                  {g.positions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={OTHER_POSITION}>Otro…</option>
            </Select>
            {otherPosition && (
              <Input className="mt-2" value={f.position} onChange={(e) => set('position', e.target.value)} placeholder="Escribe el puesto" autoFocus />
            )}
          </Field>
          <Field label="Departamento">
            <Select value={f.department} onChange={(e) => set('department', e.target.value as Department)}>
              {Object.entries(DEPARTMENTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Coste por hora (€)" className="sm:col-span-1">
            <Input inputMode="decimal" placeholder="0,00" value={f.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} />
          </Field>
          <Field label="Contrato">
            <Select value={f.contract_type} onChange={(e) => set('contract_type', e.target.value as ContractType)}>
              {Object.entries(CONTRACTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha de alta">
            <Input type="date" value={f.hire_date} onChange={(e) => set('hire_date', e.target.value)} />
          </Field>
        </div>

        <Field label="Notas">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Tallas de uniforme, disponibilidad, observaciones…" />
        </Field>

        <div className="rounded-xl bg-fill/60 p-4">
          <Switch checked={f.active} onChange={(v) => set('active', v)} label="Empleado activo" description="Los empleados inactivos no pueden fichar ni aparecen en turnos." />
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
//  Fichaje (entrada / salida manual)
// =====================================================================

export function EntryForm({
  open,
  onClose,
  entry,
  employees,
  defaultEmployeeId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  entry?: TimeEntry | null;
  employees: Employee[];
  defaultEmployeeId?: string;
  onSaved: () => void;
}) {
  const { toast } = useFeedback();
  const del = useDelete();
  const [saving, setSaving] = useState(false);
  const init = () => ({
    employee_id: entry?.employee_id ?? defaultEmployeeId ?? '',
    clock_in: toLocalInput(entry?.clock_in ?? new Date()),
    clock_out: entry?.clock_out ? toLocalInput(entry.clock_out) : '',
    break_minutes: String(entry?.break_minutes ?? 0),
    hourly_rate: entry ? String(entry.hourly_rate).replace('.', ',') : String(employees.find((e) => e.id === defaultEmployeeId)?.hourly_rate ?? '').replace('.', ','),
    notes: entry?.notes ?? '',
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, defaultEmployeeId]);

  const pickEmployee = (id: string) => {
    const emp = employees.find((e) => e.id === id);
    setF((s) => ({ ...s, employee_id: id, hourly_rate: emp ? String(emp.hourly_rate).replace('.', ',') : s.hourly_rate }));
  };

  const preview = useMemo(() => {
    if (!f.clock_in) return null;
    const draft = {
      clock_in: fromLocalInput(f.clock_in),
      clock_out: f.clock_out ? fromLocalInput(f.clock_out) : null,
      break_minutes: Number(f.break_minutes) || 0,
    };
    const h = entryHours(draft);
    return { h, cost: h * parseAmount(f.hourly_rate) };
  }, [f]);

  async function submit() {
    if (!f.employee_id) return toast.error('Selecciona un empleado');
    if (f.clock_out && f.clock_out <= f.clock_in) return toast.error('La salida debe ser posterior a la entrada');
    setSaving(true);
    try {
      const clockIn = fromLocalInput(f.clock_in);
      const values: Partial<TimeEntry> = {
        employee_id: f.employee_id,
        clock_in: clockIn,
        clock_out: f.clock_out ? fromLocalInput(f.clock_out) : null,
        break_minutes: Math.max(0, Math.round(Number(f.break_minutes) || 0)),
        hourly_rate: parseAmount(f.hourly_rate),
        notes: f.notes.trim() || null,
      };
      if (entry) await api.timeEntries.update(entry.id, values);
      else {
        const [ev] = await api.events.list({ eq: { date: businessDate(clockIn) }, limit: 1 });
        await api.timeEntries.create({ ...values, source: 'manual', event_id: ev?.id ?? null });
      }
      toast.success(entry ? 'Fichaje actualizado' : 'Fichaje añadido');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const activeEmployees = employees.filter((e) => e.active || e.id === f.employee_id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? 'Editar fichaje' : 'Nuevo fichaje'}
      onSubmit={submit}
      saving={saving}
      footer={
        entry && (
          <DeleteButton
            label="Eliminar fichaje"
            onClick={() => del({ title: '¿Eliminar este fichaje?', run: () => api.timeEntries.remove(entry.id), done: () => (onSaved(), onClose()) })}
          />
        )
      }
    >
      <div className="space-y-4">
        <Field label="Empleado">
          <Select value={f.employee_id} onChange={(e) => pickEmployee(e.target.value)} disabled={!!entry}>
            <option value="">Selecciona…</option>
            {activeEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {fullName(e)} · {e.position}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Entrada">
            <Input type="datetime-local" value={f.clock_in} onChange={(e) => setF({ ...f, clock_in: e.target.value })} required />
          </Field>
          <Field label="Salida" hint="Déjala vacía si sigue trabajando.">
            <Input type="datetime-local" value={f.clock_out} onChange={(e) => setF({ ...f, clock_out: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pausa (minutos)">
            <Input inputMode="numeric" value={f.break_minutes} onChange={(e) => setF({ ...f, break_minutes: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Tarifa (€/h)">
            <Input inputMode="decimal" value={f.hourly_rate} onChange={(e) => setF({ ...f, hourly_rate: e.target.value })} />
          </Field>
        </div>
        <Field label="Notas">
          <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Opcional" />
        </Field>
        {preview && (
          <div className="flex items-center justify-between rounded-xl bg-fill/60 px-4 py-3 text-[14px]">
            <span className="text-ink-2">{f.clock_out ? 'Total' : 'Hasta ahora'}</span>
            <span className="tabular font-semibold">
              {fmtHours(preview.h)} · {fmtMoney(preview.cost)}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}

const availRank = (a: Availability | undefined) => (!a ? 1 : a.available ? 0 : 2);

// =====================================================================
//  Turno planificado (permite asignar varios empleados a la vez)
// =====================================================================

export function ShiftForm({
  open,
  onClose,
  shift,
  date,
  employees,
  events,
  onSaved,
  employeeIds,
  availability,
}: {
  open: boolean;
  onClose: () => void;
  shift?: Shift | null;
  date?: string;
  employees: Employee[];
  events: ClubEvent[];
  onSaved: () => void;
  /** Empleados preseleccionados al crear (p. ej. desde la tabla de disponibilidad) */
  employeeIds?: string[];
  /** Disponibilidad de la semana para mostrarla junto a cada empleado */
  availability?: Availability[];
}) {
  const { toast } = useFeedback();
  const del = useDelete();
  const [saving, setSaving] = useState(false);
  const availFor = (employeeId: string, day: string) => availability?.find((a) => a.employee_id === employeeId && a.date === day);
  const init = () => {
    const d = shift ? businessDate(shift.start_at) : date ?? isoDate(businessToday());
    // Si se crea para una sola persona que ha indicado desde qué hora puede, se usa esa hora
    const only = !shift && employeeIds?.length === 1 ? availFor(employeeIds[0], d) : undefined;
    return {
      selected: new Set<string>(shift ? [shift.employee_id] : employeeIds ?? []),
      date: d,
      start: shift ? toTimeInput(shift.start_at) : hhmm(only?.available ? only.start_time : null) || '23:30',
      status: (shift?.status ?? 'planned') as ShiftStatus,
      notes: shift?.notes ?? '',
    };
  };
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shift, date, employeeIds?.join(',')]);

  const toggle = (id: string) =>
    setF((s) => {
      const selected = new Set(shift ? [] : s.selected);
      if (s.selected.has(id) && !shift) selected.delete(id);
      else selected.add(id);
      return { ...s, selected };
    });

  const selectedEmps = employees.filter((e) => f.selected.has(e.id));

  async function submit() {
    if (!f.selected.size) return toast.error('Selecciona al menos un empleado');
    if (!f.start) return toast.error('Indica la hora de entrada');
    setSaving(true);
    try {
      const start_at = nightStart(f.date, f.start);
      // La noche se asocia sola al evento de ese día (si existe)
      const event_id = events.find((e) => e.date === f.date)?.id ?? null;
      const base = { start_at, event_id, status: f.status, notes: f.notes.trim() || null };
      if (shift) {
        // Si cambia la entrada y la salida fichada queda antes, se descarta la salida
        const end_at = shift.end_at && shift.end_at > start_at ? shift.end_at : null;
        await api.shifts.update(shift.id, { ...base, end_at, employee_id: [...f.selected][0] });
      } else {
        await api.shifts.createMany(selectedEmps.map((e) => ({ ...base, end_at: null, employee_id: e.id, position: e.position })));
      }
      toast.success(shift ? 'Turno actualizado' : f.selected.size > 1 ? `${f.selected.size} turnos creados` : 'Turno creado');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shift ? 'Editar turno' : 'Nuevo turno'}
      onSubmit={submit}
      saving={saving}
      wide
      footer={
        shift && (
          <DeleteButton label="Eliminar turno" onClick={() => del({ title: '¿Eliminar este turno?', run: () => api.shifts.remove(shift.id), done: () => (onSaved(), onClose()) })} />
        )
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Noche">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="Hora de entrada">
            <Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required />
          </Field>
        </div>
        <p className="-mt-1 text-[12px] text-ink-3">
          {shift?.end_at
            ? `Salida registrada a las ${fmtTime(shift.end_at)} (se toma del fichaje de salida).`
            : 'La hora de salida se rellena sola cuando el empleado fiche la salida.'}
        </p>

        <Field label="Estado">
          <Segmented
            full
            value={f.status}
            onChange={(status) => setF({ ...f, status })}
            options={Object.entries(SHIFT_STATUS).map(([k, v]) => ({ value: k as ShiftStatus, label: v.label }))}
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">{shift ? 'Empleado' : `Empleados (${f.selected.size})`}</span>
            {!shift && (
              <button
                type="button"
                className="text-[13px] font-medium text-accent"
                onClick={() =>
                  setF((s) => ({
                    ...s,
                    selected: s.selected.size
                      ? new Set()
                      : new Set(employees.filter((e) => e.active && (!availability || availFor(e.id, s.date)?.available)).map((e) => e.id)),
                  }))
                }
              >
                {f.selected.size ? 'Quitar todos' : availability ? 'Seleccionar disponibles' : 'Seleccionar todos'}
              </button>
            )}
          </div>
          <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl bg-fill/50 p-1.5 sm:grid-cols-2">
            {employees
              .filter((e) => e.active || f.selected.has(e.id))
              .map((e) => ({ e, a: availFor(e.id, f.date) }))
              .sort((x, y) => (availability ? availRank(x.a) - availRank(y.a) : 0))
              .map(({ e, a }) => {
                const on = f.selected.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.id)}
                    className={cx(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                      on ? 'bg-surface shadow-card dark:bg-elevated' : 'hover:bg-fill',
                    )}
                  >
                    <Avatar name={fullName(e)} color={e.color} src={e.photo_url} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{fullName(e)}</span>
                      {availability ? (
                        <span className={cx('block truncate text-[12px]', !a ? 'text-ink-3' : a.available ? 'text-green' : 'text-red')} title={a?.note ?? undefined}>
                          {availabilityLabel(a)}
                        </span>
                      ) : (
                        <span className="block truncate text-[12px] text-ink-2">{e.position}</span>
                      )}
                    </span>
                    <span className={cx('grid h-5 w-5 place-items-center rounded-full border-2', on ? 'border-accent bg-accent text-on-accent' : 'border-ink-3/50')}>
                      {on && <Check className="h-3 w-3" strokeWidth={3.5} />}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>

        <Field label="Notas">
          <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Opcional" />
        </Field>
      </div>
    </Modal>
  );
}

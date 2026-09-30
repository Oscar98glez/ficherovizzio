import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import {
  CLOSEOUT_CATEGORIES,
  EVENT_KINDS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  METHODS,
  PAYROLL_CATEGORY,
  PRIVATE_EVENT_CATEGORY,
  WAITERS_CATEGORY,
  REQUEST_KINDS,
} from '../lib/constants';
import { businessToday, isoDate, monthKey } from '../lib/dates';
import { fmtMoney } from '../lib/format';
import type { ClubEvent, Employee, EventKind, LeaveRequest, PaymentMethod, RequestKind, Transaction, TxKind } from '../lib/types';
import { cx, fullName, parseAmount } from '../lib/utils';
import { Modal, useFeedback } from './overlay';
import { Button, Field, Input, Segmented, Select, Textarea } from './ui';

// =====================================================================
//  Noche / evento
// =====================================================================

export function EventForm({
  open,
  onClose,
  event,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  event?: ClubEvent | null;
  onSaved: (e: ClubEvent) => void;
  onDeleted?: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [saving, setSaving] = useState(false);
  const init = () => ({
    name: event?.name ?? '',
    date: event?.date ?? isoDate(businessToday()),
    kind: (event?.kind ?? 'sesion') as EventKind,
    expected_attendance: event?.expected_attendance != null ? String(event.expected_attendance) : '',
    notes: event?.notes ?? '',
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event]);

  async function submit() {
    if (!f.name.trim()) return toast.error('Ponle un nombre a la noche');
    setSaving(true);
    try {
      const values: Partial<ClubEvent> = {
        name: f.name.trim(),
        date: f.date,
        kind: f.kind,
        expected_attendance: f.expected_attendance ? Number(f.expected_attendance) : null,
        notes: f.notes.trim() || null,
      };
      const saved = event ? await api.events.update(event.id, values) : await api.events.create(values);
      toast.success(event ? 'Noche actualizada' : 'Noche creada');
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    const ok = await confirm({
      title: '¿Eliminar esta noche?',
      message: 'Los fichajes, turnos y movimientos asociados se conservarán sin evento.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.events.remove(event.id);
      toast.success('Noche eliminada');
      onClose();
      onDeleted?.();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? 'Editar noche' : 'Nueva noche'}
      onSubmit={submit}
      saving={saving}
      footer={event && <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={remove}>Eliminar noche</Button>}
    >
      <div className="space-y-4">
        <Field label="Nombre">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Viernes Vizzio" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="Aforo previsto">
            <Input inputMode="numeric" value={f.expected_attendance} onChange={(e) => setF({ ...f, expected_attendance: e.target.value.replace(/\D/g, '') })} placeholder="0" />
          </Field>
        </div>
        <Field label="Tipo">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EventKind })}>
            {Object.entries(EVENT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notas">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Line-up, reservas, necesidades especiales…" />
        </Field>
      </div>
    </Modal>
  );
}

const DEFAULT_EXPENSE_CATEGORY = 'Proveedores bebida';

// =====================================================================
//  Movimiento (ingreso / gasto)
// =====================================================================

export function TransactionForm({
  open,
  onClose,
  tx,
  defaults,
  employees,
  events,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tx?: Transaction | null;
  defaults?: Partial<Transaction>;
  employees: Employee[];
  events: ClubEvent[];
  onSaved: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [saving, setSaving] = useState(false);
  const init = () => {
    const src = { ...defaults, ...tx };
    const kind = (src.kind ?? 'expense') as TxKind;
    return {
      kind,
      amount: src.amount != null ? String(src.amount).replace('.', ',') : '',
      category: src.category ?? (kind === 'income' ? INCOME_CATEGORIES[0] : DEFAULT_EXPENSE_CATEGORY),
      date: src.date ?? isoDate(businessToday()),
      method: (src.method ?? (kind === 'income' ? 'tarjeta' : 'transferencia')) as PaymentMethod,
      event_id: src.event_id ?? '',
      employee_id: src.employee_id ?? '',
      period: src.period ?? '',
      description: src.description ?? '',
    };
  };
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tx]);

  const baseCategories = f.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  // Conserva categorías antiguas (p. ej. "Barra") al editar movimientos anteriores
  const categories = baseCategories.includes(f.category) ? baseCategories : [...baseCategories, f.category];
  const isPayroll = f.kind === 'expense' && f.category === PAYROLL_CATEGORY;
  const isPrivateEvent = f.kind === 'income' && f.category === PRIVATE_EVENT_CATEGORY;
  const isWaiters = f.kind === 'expense' && f.category === WAITERS_CATEGORY;
  const privateEventSuggestions = events.filter((e) => e.kind === 'evento_privado').map((e) => e.name);
  const nearEvents = events.filter((e) => Math.abs(Date.parse(e.date) - Date.parse(f.date)) < 8 * 86400000);

  async function submit() {
    const amount = parseAmount(f.amount);
    if (amount <= 0) return toast.error('Introduce un importe mayor que 0');
    if (isPayroll && !f.employee_id) return toast.error('Selecciona el empleado de la nómina');
    if (isPrivateEvent && !f.description.trim()) return toast.error('Indica de qué evento privado se trata');
    setSaving(true);
    try {
      const values: Partial<Transaction> = {
        kind: f.kind,
        amount,
        category: f.category,
        date: f.date,
        method: f.method,
        event_id: f.event_id || null,
        employee_id: isPayroll || isWaiters ? f.employee_id || null : null,
        period: isPayroll ? f.period || monthKey(f.date) : null,
        description: f.description.trim() || null,
      };
      if (tx) await api.transactions.update(tx.id, values);
      else await api.transactions.create(values);
      toast.success(tx ? 'Movimiento actualizado' : f.kind === 'income' ? 'Ingreso registrado' : 'Gasto registrado');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!tx || !(await confirm({ title: '¿Eliminar este movimiento?', confirmLabel: 'Eliminar', destructive: true }))) return;
    try {
      await api.transactions.remove(tx.id);
      toast.success('Movimiento eliminado');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx ? 'Editar movimiento' : 'Nuevo movimiento'}
      onSubmit={submit}
      saving={saving}
      footer={tx && <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={remove}>Eliminar movimiento</Button>}
    >
      <div className="space-y-4">
        <Segmented
          full
          value={f.kind}
          onChange={(kind) =>
            setF({ ...f, kind, category: kind === 'income' ? INCOME_CATEGORIES[0] : DEFAULT_EXPENSE_CATEGORY, method: kind === 'income' ? 'tarjeta' : 'transferencia' })
          }
          options={[
            { value: 'income', label: 'Ingreso' },
            { value: 'expense', label: 'Gasto' },
          ]}
        />
        <div className="flex items-center justify-center py-2">
          <span className={cx('text-[40px] font-semibold', f.kind === 'income' ? 'text-green' : 'text-ink')}>{f.kind === 'income' ? '+' : '−'}</span>
          <input
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            placeholder="0,00"
            autoFocus
            className="tabular w-48 bg-transparent text-center text-[40px] font-semibold tracking-tight outline-none placeholder:text-ink-3"
          />
          <span className="text-[28px] font-medium text-ink-2">€</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Método">
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
              {Object.entries(METHODS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="Noche asociada">
            <Select value={f.event_id} onChange={(e) => setF({ ...f, event_id: e.target.value })}>
              <option value="">Ninguna</option>
              {nearEvents.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date.slice(8, 10)}/{e.date.slice(5, 7)} · {e.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {isPayroll && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Empleado">
              <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
                <option value="">Selecciona…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {fullName(e)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mes de la nómina">
              <Input type="month" value={f.period || monthKey(f.date)} onChange={(e) => setF({ ...f, period: e.target.value })} />
            </Field>
          </div>
        )}
        {isWaiters && (
          <Field label="Camarero/a (opcional)" hint="Cuenta como gasto de personal junto con las nóminas.">
            <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
              <option value="">Sin especificar</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {fullName(e)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {isPrivateEvent ? (
          <Field label="¿Qué evento privado es?" hint="Por ejemplo: cena de empresa, boda, cumpleaños… con el nombre del cliente.">
            <Input
              list="private-events"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="Ej. Boda García-López"
              required
            />
            <datalist id="private-events">
              {[...new Set(privateEventSuggestions)].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
        ) : (
          <Field label="Concepto">
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Opcional" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// =====================================================================
//  Cierre de caja de una noche
// =====================================================================

export function CloseoutForm({
  open,
  onClose,
  events,
  defaultEventId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  events: ClubEvent[];
  defaultEventId?: string;
  onSaved: () => void;
}) {
  const { toast } = useFeedback();
  const [saving, setSaving] = useState(false);
  const blank = () => Object.fromEntries(CLOSEOUT_CATEGORIES.map((c) => [c, { efectivo: '', tarjeta: '' }])) as Record<string, { efectivo: string; tarjeta: string }>;
  const today = isoDate(businessToday());
  const initEvent = () => defaultEventId ?? events.find((e) => e.date === today)?.id ?? '';
  const [date, setDate] = useState(today);
  const [eventId, setEventId] = useState(initEvent);
  const [amounts, setAmounts] = useState(blank);
  const [other, setOther] = useState('');

  useEffect(() => {
    if (!open) return;
    const ev = events.find((e) => e.id === initEvent());
    setEventId(ev?.id ?? '');
    setDate(ev?.date ?? today);
    setAmounts(blank());
    setOther('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultEventId]);

  const total =
    Object.values(amounts).reduce((a, v) => a + parseAmount(v.efectivo) + parseAmount(v.tarjeta), 0) + parseAmount(other);
  const cash = Object.values(amounts).reduce((a, v) => a + parseAmount(v.efectivo), 0);

  async function submit() {
    const rows: Partial<Transaction>[] = [];
    for (const [category, v] of Object.entries(amounts)) {
      for (const method of ['efectivo', 'tarjeta'] as const) {
        const amount = parseAmount(v[method]);
        if (amount > 0) rows.push({ kind: 'income', category, amount, method, date, event_id: eventId || null, description: 'Cierre de caja' });
      }
    }
    if (parseAmount(other) > 0)
      rows.push({ kind: 'income', category: 'Otros ingresos', amount: parseAmount(other), method: 'efectivo', date, event_id: eventId || null, description: 'Cierre de caja' });
    if (!rows.length) return toast.error('Introduce al menos un importe');
    setSaving(true);
    try {
      await api.transactions.createMany(rows);
      toast.success(`Cierre registrado: ${fmtMoney(total)}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const recent = events.filter((e) => e.date <= today || e.id === defaultEventId).slice(-10).reverse();

  return (
    <Modal open={open} onClose={onClose} title="Cierre de caja" onSubmit={submit} submitLabel="Registrar" saving={saving}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Noche">
            <Select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                const ev = events.find((x) => x.id === e.target.value);
                if (ev) setDate(ev.date);
              }}
            >
              <option value="">Sin evento</option>
              {recent.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date.slice(8, 10)}/{e.date.slice(5, 7)} · {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <div className="overflow-hidden rounded-xl bg-fill/50">
          <div className="grid grid-cols-[1fr_96px_96px] gap-2 px-3 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-2 sm:grid-cols-[1fr_120px_120px]">
            <span>Concepto</span>
            <span className="text-right">Efectivo</span>
            <span className="text-right">Tarjeta</span>
          </div>
          {CLOSEOUT_CATEGORIES.map((c) => (
            <div key={c} className="grid grid-cols-[1fr_96px_96px] items-center gap-2 px-3 py-1.5 sm:grid-cols-[1fr_120px_120px]">
              <span className="text-[15px] font-medium">{c}</span>
              {(['efectivo', 'tarjeta'] as const).map((m) => (
                <input
                  key={m}
                  inputMode="decimal"
                  placeholder="0"
                  value={amounts[c][m]}
                  onChange={(e) => setAmounts({ ...amounts, [c]: { ...amounts[c], [m]: e.target.value } })}
                  className="input tabular h-10 px-2.5 text-right"
                />
              ))}
            </div>
          ))}
          <div className="grid grid-cols-[1fr_96px_96px] items-center gap-2 px-3 pb-3 pt-1.5 sm:grid-cols-[1fr_120px_120px]">
            <span className="text-[15px] font-medium">Otros</span>
            <input inputMode="decimal" placeholder="0" value={other} onChange={(e) => setOther(e.target.value)} className="input tabular h-10 px-2.5 text-right" />
            <span />
          </div>
        </div>

        <div className="rounded-xl bg-green/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-medium text-green">Total de la noche</span>
            <span className="tabular text-[22px] font-semibold text-green">{fmtMoney(total)}</span>
          </div>
          <div className="tabular mt-0.5 text-right text-[12px] text-ink-2">
            Efectivo en caja {fmtMoney(cash)} · Tarjeta {fmtMoney(total - cash - parseAmount(other))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
//  Solicitud del trabajador
// =====================================================================

export function RequestForm({
  open,
  onClose,
  employeeId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  onSaved: () => void;
}) {
  const { toast } = useFeedback();
  const [saving, setSaving] = useState(false);
  const today = isoDate(new Date());
  const [f, setF] = useState({ kind: 'vacaciones' as RequestKind, start_date: today, end_date: today, reason: '' });
  useEffect(() => {
    if (open) setF({ kind: 'vacaciones', start_date: today, end_date: today, reason: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (f.end_date < f.start_date) return toast.error('La fecha de fin no puede ser anterior al inicio');
    setSaving(true);
    try {
      await api.requests.create({ ...f, reason: f.reason.trim() || null, employee_id: employeeId, status: 'pending' } as Partial<LeaveRequest>);
      toast.success('Solicitud enviada');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nueva solicitud" onSubmit={submit} submitLabel="Enviar" saving={saving}>
      <div className="space-y-4">
        <Field label="Tipo">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as RequestKind })}>
            {Object.entries(REQUEST_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde">
            <Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} />
          </Field>
          <Field label="Hasta">
            <Input type="date" value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Motivo">
          <Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Explica brevemente el motivo (opcional)" />
        </Field>
      </div>
    </Modal>
  );
}

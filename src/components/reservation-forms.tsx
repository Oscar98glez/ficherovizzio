import { useEffect, useState } from 'react';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { hhmm } from '../lib/availability';
import { isActiveReservation, RESERVATION_STATUS } from '../lib/constants';
import { fmtDateFull, fmtMoneyExact } from '../lib/format';
import type { Employee, Reservation, ReservationStatus, VipTable } from '../lib/types';
import { cx, fullName, parseAmount } from '../lib/utils';
import { Modal, useFeedback } from './overlay';
import { Badge, Button, EmptyState, Field, Input, List, ListRow, Select, Switch, Textarea } from './ui';

const amountText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

export const tableLabel = (t: VipTable) => [t.name, t.zone].filter(Boolean).join(' · ');

// =====================================================================
//  Reserva
// =====================================================================

interface ReservationFormState {
  date: string;
  table_id: string;
  customer_name: string;
  customer_phone: string;
  guests: string;
  arrival_time: string;
  min_spend: string;
  deposit: string;
  status: ReservationStatus;
  rrpp_id: string;
  notes: string;
}

const toForm = (date: string, r?: Reservation | null, table?: VipTable | null, rrppId?: string | null): ReservationFormState => ({
  date: r?.date ?? date,
  table_id: r?.table_id ?? table?.id ?? '',
  customer_name: r?.customer_name ?? '',
  customer_phone: r?.customer_phone ?? '',
  guests: String(r?.guests ?? ''),
  arrival_time: hhmm(r?.arrival_time),
  min_spend: amountText(r ? r.min_spend : table?.min_spend),
  deposit: r && r.deposit ? amountText(r.deposit) : '',
  status: r?.status ?? 'pending',
  rrpp_id: r ? r.rrpp_id ?? '' : rrppId ?? '',
  notes: r?.notes ?? '',
});

export function ReservationForm({
  open,
  onClose,
  date,
  tables,
  reservations,
  reservation,
  table,
  rrpps,
  canEdit,
  isAdmin,
  myEmployeeId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Noche que se está viendo */
  date: string;
  tables: VipTable[];
  /** Reservas de esa noche (para saber qué reservados están ocupados) */
  reservations: Reservation[];
  reservation?: Reservation | null;
  /** Reservado elegido al crear desde la lista de reservados */
  table?: VipTable | null;
  /** Sólo administradores: a quién se le asigna la reserva */
  rrpps: Employee[];
  canEdit: boolean;
  isAdmin: boolean;
  myEmployeeId: string | null;
  onSaved: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [f, setF] = useState(() => toForm(date, reservation, table));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setF(toForm(date, reservation, table, isAdmin ? myEmployeeId : null));
  }, [open, date, reservation, table, isAdmin, myEmployeeId]);
  const set = <K extends keyof ReservationFormState>(k: K, v: ReservationFormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const taken = new Set(
    f.date === date ? reservations.filter((r) => r.id !== reservation?.id && r.table_id && isActiveReservation(r)).map((r) => r.table_id!) : [],
  );
  const selected = tables.find((t) => t.id === f.table_id);
  const guests = parseInt(f.guests, 10) || 0;

  function chooseTable(id: string) {
    const t = tables.find((x) => x.id === id);
    setF((s) => ({ ...s, table_id: id, min_spend: t?.min_spend != null && (!s.min_spend || !reservation) ? amountText(t.min_spend) : s.min_spend }));
  }

  async function submit() {
    if (!f.customer_name.trim()) return toast.error('Escribe el nombre del cliente');
    if (guests < 1) return toast.error('Indica cuántas personas vienen');
    if (!f.date) return toast.error('Elige la noche');
    setSaving(true);
    try {
      const values: Partial<Reservation> = {
        date: f.date,
        table_id: f.table_id || null,
        customer_name: f.customer_name.trim(),
        customer_phone: f.customer_phone.trim() || null,
        guests,
        arrival_time: f.arrival_time || null,
        min_spend: f.min_spend.trim() ? parseAmount(f.min_spend) : null,
        deposit: parseAmount(f.deposit),
        status: f.status,
        notes: f.notes.trim() || null,
        // El RRPP queda siempre como autor de sus reservas; el administrador puede asignarlas
        ...(isAdmin ? { rrpp_id: f.rrpp_id || null } : {}),
      };
      if (reservation) await api.reservations.update(reservation.id, values);
      else await api.reservations.create(values);
      toast.success(reservation ? 'Reserva actualizada' : 'Reserva creada');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!reservation) return;
    if (!(await confirm({ title: '¿Eliminar la reserva?', message: 'Si el cliente no viene, mejor márcala como "No vino" o "Cancelada".', confirmLabel: 'Eliminar', destructive: true })))
      return;
    try {
      await api.reservations.remove(reservation.id);
      toast.success('Reserva eliminada');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  // Reserva de otro RRPP: sólo consulta
  if (reservation && !canEdit) {
    const t = tables.find((x) => x.id === reservation.table_id);
    const st = RESERVATION_STATUS[reservation.status];
    return (
      <Modal open={open} onClose={onClose} title="Reserva">
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-[22px] font-semibold tracking-tight">{reservation.customer_name}</div>
            <div className="mt-1 text-[14px] text-ink-2">{fmtDateFull(reservation.date)}</div>
            <div className="mt-2">
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
          </div>
          <List>
            <ListRow title="Reservado" trailing={<span className="text-ink-2">{t ? tableLabel(t) : 'Sin asignar'}</span>} />
            <ListRow title="Personas" trailing={<span className="tabular text-ink-2">{reservation.guests}</span>} />
            <ListRow title="Llegada" trailing={<span className="tabular text-ink-2">{hhmm(reservation.arrival_time) || '—'}</span>} />
            <ListRow title="RRPP" trailing={<span className="text-ink-2">{reservation.rrpp_name ?? '—'}</span>} />
          </List>
          <p className="text-center text-[13px] text-ink-3">Sólo quien gestiona la reserva (o un administrador) puede modificarla.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={reservation ? 'Editar reserva' : 'Nueva reserva'} onSubmit={submit} submitLabel={reservation ? 'Guardar' : 'Crear'} saving={saving}>
      <div className="space-y-4">
        <Field label="Cliente">
          <Input value={f.customer_name} onChange={(e) => set('customer_name', e.target.value)} placeholder="Nombre o grupo" autoFocus={!reservation} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Teléfono">
            <Input type="tel" inputMode="tel" value={f.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} placeholder="Opcional" />
          </Field>
          <Field label="Personas" hint={selected?.capacity && guests > selected.capacity ? `El reservado es para ${selected.capacity}` : undefined}>
            <Input type="number" inputMode="numeric" min={1} value={f.guests} onChange={(e) => set('guests', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Noche">
            <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Hora de llegada">
            <Input type="time" value={f.arrival_time} onChange={(e) => set('arrival_time', e.target.value)} />
          </Field>
        </div>
        <Field label="Reservado">
          <Select value={f.table_id} onChange={(e) => chooseTable(e.target.value)}>
            <option value="">Sin asignar</option>
            {tables
              .filter((t) => t.active || t.id === f.table_id)
              .map((t) => (
                <option key={t.id} value={t.id} disabled={taken.has(t.id)}>
                  {tableLabel(t)}
                  {t.capacity ? ` · ${t.capacity} pers.` : ''}
                  {taken.has(t.id) ? ' · ocupado' : ''}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Consumo mínimo (€)">
            <Input inputMode="decimal" value={f.min_spend} onChange={(e) => set('min_spend', e.target.value)} placeholder="0" />
          </Field>
          <Field label="Señal cobrada (€)">
            <Input inputMode="decimal" value={f.deposit} onChange={(e) => set('deposit', e.target.value)} placeholder="0" />
          </Field>
        </div>
        <Field label="Estado">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(Object.keys(RESERVATION_STATUS) as ReservationStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set('status', s)}
                className={cx(
                  'h-9 rounded-[10px] px-2 text-[13px] font-medium transition',
                  f.status === s ? 'bg-accent text-on-accent shadow-sm' : 'bg-fill text-ink hover:bg-fill-2',
                )}
              >
                {RESERVATION_STATUS[s].label}
              </button>
            ))}
          </div>
        </Field>
        {isAdmin && (
          <Field label="RRPP">
            <Select value={f.rrpp_id} onChange={(e) => set('rrpp_id', e.target.value)}>
              <option value="">Sin RRPP</option>
              {rrpps.map((e) => (
                <option key={e.id} value={e.id}>
                  {fullName(e)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Notas">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Botellas, cumpleaños, peticiones…" />
        </Field>
        {reservation && (
          <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={remove}>
            Eliminar reserva
          </Button>
        )}
      </div>
    </Modal>
  );
}

// =====================================================================
//  Reservados del local (sólo administrador)
// =====================================================================

interface TableFormState {
  name: string;
  zone: string;
  capacity: string;
  min_spend: string;
  active: boolean;
  notes: string;
}

const toTableForm = (t?: VipTable | null): TableFormState => ({
  name: t?.name ?? '',
  zone: t?.zone ?? '',
  capacity: t?.capacity ? String(t.capacity) : '',
  min_spend: amountText(t?.min_spend),
  active: t?.active ?? true,
  notes: t?.notes ?? '',
});

export function VipTablesManager({ open, onClose, tables, onSaved }: { open: boolean; onClose: () => void; tables: VipTable[]; onSaved: () => void }) {
  const { toast, confirm } = useFeedback();
  // null = lista · 'new' = nuevo reservado · VipTable = edición
  const [editing, setEditing] = useState<VipTable | 'new' | null>(null);
  const [f, setF] = useState(toTableForm());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setEditing(null);
  }, [open]);
  const set = <K extends keyof TableFormState>(k: K, v: TableFormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const zones = [...new Set(tables.map((t) => t.zone).filter(Boolean))] as string[];

  function edit(t: VipTable | 'new') {
    setF(toTableForm(t === 'new' ? null : t));
    setEditing(t);
  }

  async function submit() {
    if (!f.name.trim()) return toast.error('Ponle un nombre al reservado');
    setSaving(true);
    try {
      const values: Partial<VipTable> = {
        name: f.name.trim(),
        zone: f.zone.trim() || null,
        capacity: parseInt(f.capacity, 10) || null,
        min_spend: f.min_spend.trim() ? parseAmount(f.min_spend) : null,
        active: f.active,
        notes: f.notes.trim() || null,
      };
      if (editing && editing !== 'new') await api.vipTables.update(editing.id, values);
      else await api.vipTables.create({ ...values, sort: Math.max(0, ...tables.map((t) => t.sort)) + 1 });
      toast.success(editing === 'new' ? 'Reservado creado' : 'Cambios guardados');
      onSaved();
      setEditing(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: VipTable) {
    if (!(await confirm({ title: `¿Eliminar ${t.name}?`, message: 'Sus reservas se conservan, pero quedarán sin reservado asignado. Si sólo no se usa, mejor desactívalo.', confirmLabel: 'Eliminar', destructive: true })))
      return;
    try {
      await api.vipTables.remove(t.id);
      toast.success('Reservado eliminado');
      onSaved();
      setEditing(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (editing)
    return (
      <Modal open={open} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo reservado' : 'Editar reservado'} onSubmit={submit} submitLabel={editing === 'new' ? 'Crear' : 'Guardar'} saving={saving}>
        <div className="space-y-4">
          <button type="button" onClick={() => setEditing(null)} className="-mt-1 flex items-center gap-1 text-[15px] text-accent hover:opacity-70">
            <ChevronLeft className="h-4 w-4" /> Reservados
          </button>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre">
              <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="VIP 1" autoFocus />
            </Field>
            <Field label="Zona">
              <Input value={f.zone} onChange={(e) => set('zone', e.target.value)} placeholder="Pista, Altillo…" list="vip-zones" />
              <datalist id="vip-zones">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capacidad (personas)">
              <Input type="number" inputMode="numeric" min={1} value={f.capacity} onChange={(e) => set('capacity', e.target.value)} />
            </Field>
            <Field label="Consumo mínimo (€)">
              <Input inputMode="decimal" value={f.min_spend} onChange={(e) => set('min_spend', e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Notas">
            <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <Switch checked={f.active} onChange={(v) => set('active', v)} label="Activo" description="Los reservados inactivos no se pueden reservar" />
          {editing !== 'new' && (
            <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={() => remove(editing)}>
              Eliminar reservado
            </Button>
          )}
        </div>
      </Modal>
    );

  return (
    <Modal open={open} onClose={onClose} title="Reservados del local">
      <div className="space-y-4">
        {tables.length ? (
          <List>
            {tables.map((t) => (
              <ListRow
                key={t.id}
                onClick={() => edit(t)}
                chevron
                title={
                  <span className={cx(!t.active && 'text-ink-3')}>
                    {t.name}
                    {!t.active && ' · inactivo'}
                  </span>
                }
                subtitle={[t.zone, t.capacity ? `${t.capacity} pers.` : null, t.min_spend != null ? `mín. ${fmtMoneyExact(t.min_spend)}` : null].filter(Boolean).join(' · ') || 'Sin detalles'}
              />
            ))}
          </List>
        ) : (
          <EmptyState title="Aún no hay reservados" message="Crea los reservados del local para poder asignarlos a las reservas." />
        )}
        <Button className="w-full" icon={<Plus />} onClick={() => edit('new')}>
          Nuevo reservado
        </Button>
      </div>
    </Modal>
  );
}

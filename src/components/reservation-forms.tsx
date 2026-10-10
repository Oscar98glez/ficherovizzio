import { useEffect, useState } from 'react';
import { ChevronLeft, Minus, Plus, PlusCircle, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { hhmm } from '../lib/availability';
import { isActiveReservation, RESERVATION_ORIGINS, RESERVATION_STATUS } from '../lib/constants';
import { fmtDateFull, fmtMoneyExact, fmtTime } from '../lib/format';
import { BOTTLE_GROUPS, menuPrice, MIXER_GROUPS, type MenuGroup } from '../lib/menu';
import { allBottles, allMixers, extraOrdersTotal, itemsTotal, ordersOf } from '../lib/orders';
import type { OrderItem, Reservation, ReservationOrigin, ReservationStatus, StaffOption, VipTable } from '../lib/types';
import { cx, parseAmount, uid } from '../lib/utils';
import { useAuth } from '../auth';
import { Modal, useFeedback } from './overlay';
import { Badge, Button, EmptyState, Field, Input, List, ListRow, Select, Switch, Textarea } from './ui';

const amountText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

const ORIGIN_PREFIX = '__origen_';

export const tableLabel = (t: VipTable) => [t.name, t.zone].filter(Boolean).join(' · ');

/** "2× Grey Goose, 1× Moët" */
export const itemsText = (items: OrderItem[] | null | undefined) =>
  (items ?? []).map((i) => `${i.qty}× ${i.name}${i.courtesy ? ' (cortesía)' : ''}`).join(', ');

/**
 * Pedidos de una reserva, cada uno por separado con sus botellas y sus refrescos (los refrescos de
 * una botella añadida después no se juntan con los del pedido anterior).
 */
function OrdersView({ reservation, onRemove }: { reservation: Reservation; onRemove?: (index: number) => void }) {
  const orders = ordersOf(reservation).filter((o, i) => i > 0 || o.bottles.length || o.mixers.length);
  if (!orders.length) return null;
  const several = (reservation.extra_orders ?? []).length > 0;
  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <div key={o.n} className="rounded-xl bg-fill/60 px-3.5 py-2.5">
          {several && (
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                Pedido {o.n}
                {o.n > 1 && o.at ? ` · ${fmtTime(o.at)}` : ''}
                {o.n > 1 && o.by ? ` · ${o.by}` : ''}
              </span>
              {onRemove && o.n > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(o.n - 2)}
                  className="grid h-7 w-7 place-items-center rounded-full text-ink-3 hover:bg-fill hover:text-red"
                  aria-label={`Quitar el pedido ${o.n}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <div className="text-[14px]">
            <span className="text-ink-2">Botellas: </span>
            {itemsText(o.bottles) || '—'}
          </div>
          <div className="text-[14px]">
            <span className="text-ink-2">Refrescos: </span>
            {itemsText(o.mixers) || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Botellas añadidas a un reservado ya apuntado: van en un pedido nuevo, con sus propios refrescos */
function NewOrderModal({ reservation, onClose, onSaved }: { reservation: Reservation; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const { profile, employee } = useAuth();
  const [bottles, setBottles] = useState<OrderItem[]>([{ name: '', qty: 1 }]);
  const [mixers, setMixers] = useState<OrderItem[]>([]);
  const [saving, setSaving] = useState(false);
  const total = round2(itemsTotal(bottles) + itemsTotal(mixers));

  async function submit() {
    const b = cleanItems(bottles);
    const m = cleanItems(mixers);
    if (!b.length && !m.length) return toast.error('Añade al menos una botella o un refresco');
    setSaving(true);
    try {
      // Se parte de la reserva tal y como está ahora (por si otro ha añadido un pedido a la vez)
      const latest = (await api.reservations.get(reservation.id)) ?? reservation;
      const orderTotal = round2(itemsTotal(b) + itemsTotal(m));
      const before = latest.total_amount ?? round2(itemsTotal(allBottles(latest)) + itemsTotal(allMixers(latest)));
      const by = employee ? `${employee.first_name} ${employee.last_name ?? ''}`.trim() : profile?.full_name || null;
      await api.reservations.update(reservation.id, {
        extra_orders: [...(latest.extra_orders ?? []), { id: uid(), at: new Date().toISOString(), by, bottles: b, mixers: m }],
        total_amount: round2(before + orderTotal),
      });
      toast.success('Pedido añadido: les llega un aviso a los camareros de bandeja');
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo pedido" onSubmit={submit} submitLabel="Añadir" saving={saving}>
      <div className="space-y-4">
        <p className="text-[14px] text-ink-2">
          {reservation.customer_name}: las botellas que añadas aquí van en un pedido aparte, con sus propios refrescos, y se avisa a los camareros de
          bandeja.
        </p>
        <div className="space-y-4 rounded-2xl bg-fill/50 p-3.5">
          <ItemsEditor
            label="Botellas"
            addLabel="Añadir botella"
            items={bottles}
            onChange={setBottles}
            groups={BOTTLE_GROUPS}
            emptyLabel="Elige una botella"
            otherLabel="Otra…"
            placeholder="Escribe la botella"
            courtesy
          />
          <ItemsEditor
            label="Refrescos de este pedido"
            addLabel="Añadir refresco"
            items={mixers}
            onChange={setMixers}
            groups={MIXER_GROUPS}
            emptyLabel="Elige un refresco"
            otherLabel="Otro…"
            placeholder="Escribe el refresco"
          />
          {total > 0 && (
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-ink-2">Este pedido</span>
              <span className="tabular font-semibold">{fmtMoneyExact(total)}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

const OTHER = '__otro__';
const round2 = (n: number) => Math.round(n * 100) / 100;

export { allBottles, allMixers, extraOrdersTotal, itemsTotal, ordersOf };

/**
 * Lista editable de botellas o refrescos con su cantidad, elegidos de la carta del local
 * (con "Otra…" para escribir una que no esté, con su precio).
 */
function ItemsEditor({
  label,
  addLabel,
  emptyLabel,
  otherLabel,
  items,
  onChange,
  groups,
  placeholder,
  courtesy = false,
}: {
  label: string;
  addLabel: string;
  emptyLabel: string;
  otherLabel: string;
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
  groups: MenuGroup[];
  placeholder: string;
  /** Permite marcar cada línea como cortesía (0 €) */
  courtesy?: boolean;
}) {
  const set = (i: number, patch: Partial<OrderItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const listed = new Map(groups.flatMap((g) => g.items).map((m) => [m.name, m.price]));
  // Filas en las que se ha elegido "Otra…" y aún no se ha escrito nada
  const [typing, setTyping] = useState<Set<number>>(new Set());
  const isOther = (i: number) => typing.has(i) || (!!items[i].name && !listed.has(items[i].name));
  const remove = (i: number) => {
    onChange(items.filter((_, j) => j !== i));
    setTyping((t) => new Set([...t].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  };
  const total = itemsTotal(items);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
        {total > 0 && <span className="tabular text-[13px] font-medium text-ink-2">{fmtMoneyExact(total)}</span>}
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Select
                value={isOther(i) ? OTHER : it.name}
                onChange={(e) => {
                  const v = e.target.value;
                  setTyping((t) => {
                    const n = new Set(t);
                    if (v === OTHER) n.add(i);
                    else n.delete(i);
                    return n;
                  });
                  set(i, v === OTHER ? { name: '', price: undefined } : { name: v, price: listed.get(v) });
                }}
              >
                <option value="">{emptyLabel}</option>
                {groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} · {courtesy ? fmtMoneyExact(m.price) : m.price > 0 ? `+${fmtMoneyExact(m.price)}` : 'incluido'}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={OTHER}>{otherLabel}</option>
              </Select>
              {isOther(i) && (
                <div className="flex gap-2">
                  <Input
                    value={it.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                    placeholder={placeholder}
                    autoFocus={typing.has(i)}
                    className="min-w-0 flex-1"
                  />
                  <Input
                    inputMode="decimal"
                    defaultValue={it.price != null ? amountText(it.price) : ''}
                    onChange={(e) => set(i, { price: e.target.value.trim() ? parseAmount(e.target.value) : undefined })}
                    placeholder="Precio €"
                    aria-label="Precio"
                    className="w-24 shrink-0"
                  />
                </div>
              )}
              {courtesy && (
                <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={!!it.courtesy}
                    onChange={(e) => set(i, { courtesy: e.target.checked || undefined })}
                    className="h-4 w-4 rounded accent-[rgb(var(--accent))]"
                  />
                  Cortesía <span className="text-ink-3">(0 €)</span>
                </label>
              )}
            </div>
            <div className="flex h-10 shrink-0 items-center rounded-[10px] bg-fill">
              <button
                type="button"
                onClick={() => set(i, { qty: Math.max(1, it.qty - 1) })}
                className="grid h-10 w-8 place-items-center text-ink-2 hover:text-ink"
                aria-label="Una menos"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="tabular w-6 text-center text-[15px] font-semibold">{it.qty}</span>
              <button
                type="button"
                onClick={() => set(i, { qty: it.qty + 1 })}
                className="grid h-10 w-8 place-items-center text-ink-2 hover:text-ink"
                aria-label="Una más"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-fill hover:text-red"
              aria-label="Quitar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, { name: '', qty: 1 }])}
        className="mt-2 flex items-center gap-1.5 text-[14px] font-medium text-accent hover:opacity-70"
      >
        <Plus className="h-4 w-4" /> {addLabel}
      </button>
    </div>
  );
}

const cleanItems = (items: OrderItem[]): OrderItem[] =>
  items
    .map((i) => {
      const name = i.name.trim();
      const price = i.price ?? menuPrice(name);
      return { name, qty: Math.max(1, Math.round(i.qty) || 1), ...(price != null ? { price } : {}), ...(i.courtesy ? { courtesy: true } : {}) };
    })
    .filter((i) => i.name);

// =====================================================================
//  Reserva
// =====================================================================

interface ReservationFormState {
  date: string;
  table_id: string;
  customer_name: string;
  guests: string;
  arrival_time: string;
  min_spend: string;
  deposit: string;
  bottles: OrderItem[];
  mixers: OrderItem[];
  total_amount: string;
  status: ReservationStatus;
  rrpp_id: string;
  host_rrpp_id: string;
  notes: string;
}

const toForm = (date: string, r?: Reservation | null, table?: VipTable | null, rrppId?: string | null): ReservationFormState => ({
  date: r?.date ?? date,
  table_id: r?.table_id ?? table?.id ?? '',
  customer_name: r?.customer_name ?? '',
  guests: String(r?.guests ?? ''),
  arrival_time: hhmm(r?.arrival_time),
  min_spend: amountText(r ? r.min_spend : table?.min_spend),
  deposit: r && r.deposit ? amountText(r.deposit) : '',
  bottles: r?.bottles?.length ? r.bottles.map((b) => ({ ...b })) : [{ name: '', qty: 1 }],
  mixers: r?.mixers?.length ? r.mixers.map((m) => ({ ...m })) : [],
  total_amount: amountText(r?.total_amount),
  status: r?.status ?? 'pending',
  // "Otros" y "Empresa" van en el mismo desplegable que los RRPP
  rrpp_id: r ? (r.rrpp_origin ? ORIGIN_PREFIX + r.rrpp_origin : (r.rrpp_id ?? '')) : (rrppId ?? ''),
  host_rrpp_id: r?.host_rrpp_id ?? '',
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
  staff,
  canEdit,
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
  /** RRPP que se pueden elegir como "RRPP" y "RRPP que atiende" */
  staff: StaffOption[];
  canEdit: boolean;
  myEmployeeId: string | null;
  onSaved: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [f, setF] = useState(() => toForm(date, reservation, table));
  const [saving, setSaving] = useState(false);
  // Añadiendo botellas en un pedido nuevo
  const [adding, setAdding] = useState(false);
  // El coste total se calcula con la carta hasta que se escribe a mano
  const [autoTotal, setAutoTotal] = useState(true);
  useEffect(() => {
    if (!open) return;
    setF(toForm(date, reservation, table, myEmployeeId && staff.some((s) => s.id === myEmployeeId) ? myEmployeeId : null));
    setAutoTotal(
      !reservation ||
        reservation.total_amount == null ||
        Math.abs(reservation.total_amount - itemsTotal(allBottles(reservation)) - itemsTotal(allMixers(reservation))) < 0.005,
    );
    setAdding(false);
  }, [open, date, reservation, table, myEmployeeId, staff]);
  const set = <K extends keyof ReservationFormState>(k: K, v: ReservationFormState[K]) => setF((s) => ({ ...s, [k]: v }));
  // El total incluye los pedidos añadidos después (que no se editan aquí)
  const menuTotal = (s: Pick<ReservationFormState, 'bottles' | 'mixers'>) =>
    round2(itemsTotal(s.bottles) + itemsTotal(s.mixers) + extraOrdersTotal(reservation));
  const totalText = (n: number) => (n > 0 ? (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) : '');
  const setItems = (k: 'bottles' | 'mixers', v: OrderItem[]) =>
    setF((s) => {
      const next = { ...s, [k]: v };
      return autoTotal ? { ...next, total_amount: totalText(menuTotal(next)) } : next;
    });
  const computed = menuTotal(f);

  const taken = new Set(
    f.date === date ? reservations.filter((r) => r.id !== reservation?.id && r.table_id && isActiveReservation(r)).map((r) => r.table_id!) : [],
  );
  const selected = tables.find((t) => t.id === f.table_id);
  const guests = parseInt(f.guests, 10) || 0;

  function chooseTable(id: string) {
    const t = tables.find((x) => x.id === id);
    setF((s) => ({
      ...s,
      table_id: id,
      min_spend: t?.min_spend != null && (!s.min_spend || !reservation) ? amountText(t.min_spend) : s.min_spend,
    }));
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
        guests,
        arrival_time: f.arrival_time || null,
        min_spend: f.min_spend.trim() ? parseAmount(f.min_spend) : null,
        deposit: parseAmount(f.deposit),
        bottles: cleanItems(f.bottles),
        mixers: cleanItems(f.mixers),
        total_amount: f.total_amount.trim() ? parseAmount(f.total_amount) : null,
        status: f.status,
        notes: f.notes.trim() || null,
        ...(f.rrpp_id.startsWith(ORIGIN_PREFIX)
          ? { rrpp_id: null, rrpp_origin: f.rrpp_id.slice(ORIGIN_PREFIX.length) as ReservationOrigin }
          : { rrpp_id: f.rrpp_id || null, rrpp_origin: null }),
        host_rrpp_id: f.host_rrpp_id || null,
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

  async function removeOrder(index: number) {
    if (!reservation) return;
    const order = reservation.extra_orders?.[index];
    if (!order) return;
    if (!(await confirm({ title: `¿Quitar el pedido ${index + 2}?`, message: itemsText(order.bottles) || undefined, confirmLabel: 'Quitar', destructive: true }))) return;
    try {
      const orderTotal = round2(itemsTotal(order.bottles) + itemsTotal(order.mixers));
      await api.reservations.update(reservation.id, {
        extra_orders: (reservation.extra_orders ?? []).filter((_, i) => i !== index),
        total_amount: reservation.total_amount != null ? Math.max(0, round2(reservation.total_amount - orderTotal)) : null,
      });
      toast.success('Pedido quitado');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove() {
    if (!reservation) return;
    if (
      !(await confirm({
        title: '¿Eliminar la reserva?',
        message: 'Si el cliente no viene, mejor márcala como "No vino" o "Cancelada".',
        confirmLabel: 'Eliminar',
        destructive: true,
      }))
    )
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
            <ListRow title="Número de personas" trailing={<span className="tabular text-ink-2">{reservation.guests}</span>} />
            <ListRow title="Llegada" trailing={<span className="tabular text-ink-2">{hhmm(reservation.arrival_time) || '—'}</span>} />
            <ListRow title="RRPP" trailing={<span className="text-ink-2">{reservation.rrpp_name ?? '—'}</span>} />
            <ListRow title="RRPP que atiende" trailing={<span className="text-ink-2">{reservation.host_rrpp_name ?? '—'}</span>} />
            {reservation.total_amount != null && (
              <ListRow title="Coste total" trailing={<span className="tabular font-semibold">{fmtMoneyExact(reservation.total_amount)}</span>} />
            )}
          </List>
          <OrdersView reservation={reservation} />
          <p className="text-center text-[13px] text-ink-3">Sólo quien la creó, su RRPP, el RRPP que la atiende o un administrador pueden modificarla.</p>
        </div>
      </Modal>
    );
  }

  if (reservation && adding && open)
    return (
      <NewOrderModal
        reservation={reservation}
        onClose={() => setAdding(false)}
        onSaved={() => {
          onSaved();
          onClose();
        }}
      />
    );

  const extras = reservation?.extra_orders ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reservation ? 'Editar reserva' : 'Nueva reserva'}
      onSubmit={submit}
      submitLabel={reservation ? 'Guardar' : 'Crear'}
      saving={saving}
    >
      <div className="space-y-4">
        <Field label="Cliente">
          <Input
            value={f.customer_name}
            onChange={(e) => set('customer_name', e.target.value)}
            placeholder="Nombre o grupo"
            autoFocus={!reservation}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Número de personas" hint={selected?.capacity && guests > selected.capacity ? `El reservado es para ${selected.capacity}` : undefined}>
            <Input type="number" inputMode="numeric" min={1} value={f.guests} onChange={(e) => set('guests', e.target.value)} />
          </Field>
          <Field label="Hora de llegada">
            <Input type="time" value={f.arrival_time} onChange={(e) => set('arrival_time', e.target.value)} />
          </Field>
        </div>
        <Field label="Noche">
          <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
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
          <Field label="RRPP">
            <Select value={f.rrpp_id} onChange={(e) => set('rrpp_id', e.target.value)}>
              <option value="">Sin RRPP</option>
              <optgroup label="RRPP">
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Otros orígenes">
                {(Object.keys(RESERVATION_ORIGINS) as ReservationOrigin[]).map((o) => (
                  <option key={o} value={ORIGIN_PREFIX + o}>
                    {RESERVATION_ORIGINS[o]}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="RRPP que atiende">
            <Select value={f.host_rrpp_id} onChange={(e) => set('host_rrpp_id', e.target.value)}>
              <option value="">Sin asignar</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="space-y-4 rounded-2xl bg-fill/50 p-3.5">
          {extras.length > 0 && <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Pedido 1</div>}
          <ItemsEditor
            label="Botellas"
            addLabel="Añadir botella"
            items={f.bottles}
            onChange={(v) => setItems('bottles', v)}
            groups={BOTTLE_GROUPS}
            emptyLabel="Elige una botella"
            otherLabel="Otra…"
            placeholder="Escribe la botella"
            courtesy
          />
          <ItemsEditor
            label="Refrescos"
            addLabel="Añadir refresco"
            items={f.mixers}
            onChange={(v) => setItems('mixers', v)}
            groups={MIXER_GROUPS}
            emptyLabel="Elige un refresco"
            otherLabel="Otro…"
            placeholder="Escribe el refresco"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Coste total (€)"
              hint={
                autoTotal ? (
                  computed > 0 && 'Según la carta'
                ) : computed > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAutoTotal(true);
                      set('total_amount', totalText(computed));
                    }}
                    className="font-medium text-accent hover:opacity-70"
                  >
                    Usar precio de carta ({fmtMoneyExact(computed)})
                  </button>
                ) : undefined
              }
            >
              <Input
                inputMode="decimal"
                value={f.total_amount}
                onChange={(e) => {
                  setAutoTotal(false);
                  set('total_amount', e.target.value);
                }}
                placeholder="0"
              />
            </Field>
            <Field label="Señal cobrada (€)">
              <Input inputMode="decimal" value={f.deposit} onChange={(e) => set('deposit', e.target.value)} placeholder="0" />
            </Field>
          </div>
        </div>
        {reservation && (
          <div className="space-y-2">
            {extras.length > 0 && (
              <>
                <div className="px-1 text-[13px] font-medium text-ink-2">Pedidos añadidos</div>
                <OrdersView reservation={{ ...reservation, bottles: [], mixers: [] }} onRemove={removeOrder} />
              </>
            )}
            <Button variant="secondary" className="w-full" icon={<PlusCircle />} onClick={() => setAdding(true)}>
              Añadir botellas (pedido nuevo)
            </Button>
          </div>
        )}
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

export function VipTablesManager({
  open,
  onClose,
  tables,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tables: VipTable[];
  onSaved: () => void;
}) {
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
      else
        await api.vipTables.create({
          ...values,
          sort: Math.max(0, ...tables.map((t) => t.sort)) + 1,
        });
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
    if (
      !(await confirm({
        title: `¿Eliminar ${t.name}?`,
        message: 'Sus reservas se conservan, pero quedarán sin reservado asignado. Si sólo no se usa, mejor desactívalo.',
        confirmLabel: 'Eliminar',
        destructive: true,
      }))
    )
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
      <Modal
        open={open}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Nuevo reservado' : 'Editar reservado'}
        onSubmit={submit}
        submitLabel={editing === 'new' ? 'Crear' : 'Guardar'}
        saving={saving}
      >
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
                subtitle={
                  [t.zone, t.capacity ? `${t.capacity} pers.` : null, t.min_spend != null ? `mín. ${fmtMoneyExact(t.min_spend)}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'Sin detalles'
                }
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

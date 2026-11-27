import { useState } from 'react';
import { Check, ChefHat, ChevronDown, ChevronUp, Hand, RotateCcw } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { ORDER_SERVICE } from '../lib/constants';
import { fmtTime } from '../lib/format';
import { ordersOf, serviceOf } from '../lib/orders';
import type { OrderItem, OrderServiceStatus, Reservation, VipTable } from '../lib/types';
import { cx } from '../lib/utils';
import { useFeedback } from './overlay';
import { Badge, Button, Card, SectionTitle } from './ui';

/** "2× Grey Goose, 1× Moët (cortesía)" */
const text = (items: OrderItem[]) => items.map((i) => `${i.qty}× ${i.name}${i.courtesy ? ' (cortesía)' : ''}`).join(', ');

const RANK: Record<OrderServiceStatus, number> = { pending: 0, accepted: 1, preparing: 2, served: 3 };

const DONE: Record<OrderServiceStatus, string> = {
  pending: 'Pedido sin aceptar',
  accepted: 'Pedido aceptado',
  preparing: 'Pedido en preparación',
  served: 'Pedido servido',
};

interface QueueItem {
  reservation: Reservation;
  table: VipTable | undefined;
  key: string;
  n: number;
  several: boolean;
  at: string | null | undefined;
  bottles: OrderItem[];
  mixers: OrderItem[];
  status: OrderServiceStatus;
  by: string | null;
  changedAt: string | null;
}

/**
 * Pedidos de los reservados que han llegado, para los camareros de bandeja: cada pedido se acepta
 * y se va marcando "En preparación" y "Servido". Primero los que nadie ha aceptado.
 */
export function TrayOrders({
  reservations,
  tables,
  onChanged,
}: {
  reservations: Reservation[];
  tables: Map<string, VipTable>;
  onChanged: () => void;
}) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const [showServed, setShowServed] = useState(false);

  const items: QueueItem[] = reservations
    .filter((r) => r.status === 'arrived')
    .flatMap((r) => {
      const orders = ordersOf(r).filter((o) => o.bottles.length || o.mixers.length);
      return orders.map((o) => {
        const s = serviceOf(r, o.key);
        return {
          reservation: r,
          table: r.table_id ? tables.get(r.table_id) : undefined,
          key: o.key,
          n: o.n,
          several: orders.length > 1,
          at: o.n > 1 ? o.at : null,
          bottles: o.bottles,
          mixers: o.mixers,
          status: s.status,
          by: s.by,
          changedAt: s.at,
        };
      });
    })
    .sort((a, b) => RANK[a.status] - RANK[b.status] || (a.at ?? '').localeCompare(b.at ?? ''));

  if (!items.length) return null;
  const open = items.filter((i) => i.status !== 'served');
  const served = items.filter((i) => i.status === 'served');

  async function set(item: QueueItem, status: OrderServiceStatus) {
    setBusy(`${item.reservation.id}:${item.key}`);
    try {
      await api.setReservationService(item.reservation.id, item.key, status);
      toast.success(DONE[status]);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const card = (i: QueueItem) => {
    const st = ORDER_SERVICE[i.status];
    const id = `${i.reservation.id}:${i.key}`;
    const working = busy === id;
    return (
      <Card key={id} className={cx('p-4', i.status === 'pending' && 'ring-2 ring-inset ring-orange/50')}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[17px] font-semibold">{i.table ? i.table.name : 'Sin reservado'}</div>
            <div className="truncate text-[13px] text-ink-2">
              {[i.reservation.customer_name, `${i.reservation.guests} pers.`, i.several && `Pedido ${i.n}${i.at ? ` · ${fmtTime(i.at)}` : ''}`]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div className="mt-3 space-y-1 rounded-xl bg-fill/60 px-3.5 py-2.5 text-[15px]">
          <div>
            <span className="text-ink-2">Botellas: </span>
            <span className="font-medium">{text(i.bottles) || '—'}</span>
          </div>
          <div>
            <span className="text-ink-2">Refrescos: </span>
            <span className="font-medium">{text(i.mixers) || '—'}</span>
          </div>
          {i.reservation.notes && <div className="text-[13px] text-ink-2">Notas: {i.reservation.notes}</div>}
        </div>
        {i.status !== 'pending' && i.by && (
          <div className="mt-2 text-[12px] text-ink-3">
            {st.label} por {i.by}
            {i.changedAt ? ` · ${fmtTime(i.changedAt)}` : ''}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {i.status === 'pending' && (
            <Button className="flex-1" icon={<Hand />} loading={working} onClick={() => set(i, 'accepted')}>
              Aceptar
            </Button>
          )}
          {i.status === 'accepted' && (
            <Button variant="secondary" className="flex-1" icon={<ChefHat />} loading={working} onClick={() => set(i, 'preparing')}>
              En preparación
            </Button>
          )}
          {(i.status === 'accepted' || i.status === 'preparing') && (
            <Button className="flex-1" icon={<Check />} loading={working} onClick={() => set(i, 'served')}>
              Servido
            </Button>
          )}
          {i.status === 'served' && (
            <Button variant="secondary" size="sm" icon={<RotateCcw />} loading={working} onClick={() => set(i, 'preparing')}>
              No está servido
            </Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="mb-5">
      <SectionTitle>Pedidos de los reservados</SectionTitle>
      {open.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{open.map(card)}</div>
      ) : (
        <Card className="px-4 py-3 text-[14px] text-ink-2">Todos los pedidos están servidos.</Card>
      )}
      {served.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowServed((v) => !v)}
            className="mt-3 flex items-center gap-1 px-1 text-[14px] font-medium text-accent hover:opacity-70"
          >
            {showServed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showServed ? 'Ocultar los servidos' : `Ver los servidos (${served.length})`}
          </button>
          {showServed && <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{served.map(card)}</div>}
        </>
      )}
    </div>
  );
}

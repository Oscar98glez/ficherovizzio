/** Botellas y refrescos de un reservado: precios, totales y pedidos. */
import { menuPrice } from './menu';
import type { OrderItem, Reservation } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Precio unitario: 0 si es cortesía; si no, el guardado en la reserva o el de la carta */
const priceOf = (i: OrderItem) => (i.courtesy ? 0 : (i.price ?? menuPrice(i.name) ?? 0));

/** Total de una lista de botellas o refrescos (cantidad × precio) */
export const itemsTotal = (items: OrderItem[] | null | undefined) => round2((items ?? []).reduce((a, i) => a + priceOf(i) * i.qty, 0));

/** Pedidos de una reserva: el 1 (el de la reserva) y los añadidos después, cada uno con sus refrescos */
export const ordersOf = (r: Pick<Reservation, 'bottles' | 'mixers' | 'extra_orders' | 'created_at'>) => [
  { n: 1, at: r.created_at, by: null as string | null | undefined, bottles: r.bottles ?? [], mixers: r.mixers ?? [] },
  ...(r.extra_orders ?? []).map((o, i) => ({ n: i + 2, at: o.at, by: o.by, bottles: o.bottles ?? [], mixers: o.mixers ?? [] })),
];

/** Todas las botellas / refrescos de una reserva, de todos sus pedidos */
export const allBottles = (r: Pick<Reservation, 'bottles' | 'extra_orders'>) => [...(r.bottles ?? []), ...(r.extra_orders ?? []).flatMap((o) => o.bottles ?? [])];
export const allMixers = (r: Pick<Reservation, 'mixers' | 'extra_orders'>) => [...(r.mixers ?? []), ...(r.extra_orders ?? []).flatMap((o) => o.mixers ?? [])];

/** Lo que suman los pedidos añadidos después */
export const extraOrdersTotal = (r: Pick<Reservation, 'extra_orders'> | null | undefined) =>
  round2((r?.extra_orders ?? []).reduce((a, o) => a + itemsTotal(o.bottles) + itemsTotal(o.mixers), 0));

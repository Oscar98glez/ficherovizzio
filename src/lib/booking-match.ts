/**
 * Cotejo de las reservas de Fourvenues con las del apartado Reservados de la app: si la reserva
 * está en la app, manda lo que diga la app (cortesía o pagada, y su importe).
 */
import { allBottles, allMixers, itemsTotal } from './orders';
import type { Reservation, RrppNightDetail } from './types';

type BookingItem = NonNullable<RrppNightDetail['bookingItems']>[number];

export interface CheckedBooking {
  item: BookingItem;
  /** Su reserva en la app (null si no está) */
  reservation: Reservation | null;
  courtesy: boolean;
  /** Algunas botellas de cortesía, pero no todas */
  partialCourtesy: boolean;
  amount: number;
  /** Reserva que sólo está en el apartado Reservados (no en Fourvenues) */
  appOnly?: boolean;
}

const normName = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const phoneKey = (s: string | null | undefined) => {
  const d = (s ?? '').replace(/\D/g, '');
  return d.length >= 6 ? d.slice(-9) : null;
};

/** Mismo nombre, o mismo nombre y primer apellido aunque falte el segundo */
function sameName(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(' ');
  const tb = b.split(' ');
  if (ta.length < 2 || tb.length < 2) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

/** La reserva de la app es de cortesía: todas sus botellas lo son, o su importe es 0 € */
export const isAppCourtesy = (r: Reservation) => {
  const bottles = allBottles(r);
  return r.total_amount === 0 || (!!bottles.length && bottles.every((b) => b.courtesy));
};

/** Importe de la reserva en la app: el total guardado o, si no, el de sus botellas y refrescos */
export const appAmount = (r: Reservation) => r.total_amount ?? itemsTotal(allBottles(r)) + itemsTotal(allMixers(r));

/** Empareja cada reserva de Fourvenues con una de la app de esa noche (por teléfono o por nombre) */
export function checkBookings(items: BookingItem[], reservations: Reservation[]): CheckedBooking[] {
  const pool = reservations.filter((r) => r.status !== 'cancelled');
  const used = new Set<string>();
  const find = (match: (r: Reservation) => boolean) => pool.find((r) => !used.has(r.id) && match(r)) ?? null;
  return items.map((item) => {
    const phone = phoneKey(item.phone);
    const name = normName(item.name);
    const reservation =
      (phone && find((r) => phoneKey(r.customer_phone) === phone)) ||
      (name && find((r) => normName(r.customer_name) === name)) ||
      (name && find((r) => sameName(normName(r.customer_name), name))) ||
      null;
    if (!reservation) return { item, reservation: null, courtesy: item.courtesy, partialCourtesy: false, amount: item.courtesy ? 0 : item.price };
    used.add(reservation.id);
    const courtesy = isAppCourtesy(reservation);
    return {
      item,
      reservation,
      courtesy,
      partialCourtesy: !courtesy && allBottles(reservation).some((b) => b.courtesy),
      amount: courtesy ? 0 : appAmount(reservation),
    };
  });
}

/** Desde esta noche (lunes de la semana del cambio), en Noches cuentan también los reservados de la app */
export const APP_RESERVATIONS_FROM = '2026-10-05';

/** Reservas de la app que cuentan: sin las canceladas ni las de clientes que no vinieron */
export const liveReservation = (r: Reservation) => r.status !== 'cancelled' && r.status !== 'no_show';

export interface NightReservados {
  /** Reservas de Fourvenues de cada fila del desglose (por su id), cotejadas con Reservados */
  checkedByRow: Map<string, CheckedBooking[]>;
  /** Reservas de la app que no están en Fourvenues */
  appOnly: Reservation[];
  /** Reservados de la noche: los de Fourvenues más los que sólo están en la app */
  total: number;
}

/**
 * Reservados de una noche: las reservas de Fourvenues (de todas las filas del desglose por RRPP),
 * cotejadas con el apartado Reservados, y las reservas de la app que no están en Fourvenues.
 * Antes de APP_RESERVATIONS_FROM sólo cuentan las de Fourvenues.
 */
export function nightReservados(
  date: string,
  rows: { id: string; bookings?: number | null; detail?: RrppNightDetail | null }[],
  reservations: Reservation[],
): NightReservados {
  const own = reservations.filter((r) => r.date === date);
  const flat = rows.flatMap((r) => (r.detail?.bookingItems ?? []).map((item) => ({ row: r.id, item })));
  const checked = checkBookings(flat.map((f) => f.item), own);
  const checkedByRow = new Map<string, CheckedBooking[]>();
  checked.forEach((c, i) => checkedByRow.set(flat[i].row, [...(checkedByRow.get(flat[i].row) ?? []), c]));
  const matched = new Set(checked.map((c) => c.reservation?.id).filter(Boolean));
  const appOnly = date >= APP_RESERVATIONS_FROM ? own.filter((r) => liveReservation(r) && !matched.has(r.id)) : [];
  const fromFourvenues = rows.reduce((n, r) => n + (r.bookings ?? 0), 0);
  return { checkedByRow, appOnly, total: fromFourvenues + appOnly.length };
}

/** Una reserva que sólo está en la app, con la misma forma que las cotejadas */
export function appOnlyBooking(r: Reservation, zone: string | null): CheckedBooking {
  const courtesy = isAppCourtesy(r);
  const amount = courtesy ? 0 : appAmount(r);
  return {
    item: { name: r.customer_name, phone: r.customer_phone, zone: zone ?? 'Reservado', people: r.guests, price: amount, courtesy },
    reservation: r,
    courtesy,
    partialCourtesy: !courtesy && allBottles(r).some((b) => b.courtesy),
    amount,
    appOnly: true,
  };
}

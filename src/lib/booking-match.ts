/**
 * Cotejo de las reservas de Fourvenues con las del apartado Reservados de la app: si la reserva
 * está en la app, manda lo que diga la app (cortesía o pagada, y su importe).
 */
import { itemsTotal } from '../components/reservation-forms';
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
export const isAppCourtesy = (r: Reservation) =>
  r.total_amount === 0 || (!!r.bottles?.length && r.bottles.every((b) => b.courtesy));

/** Importe de la reserva en la app: el total guardado o, si no, el de sus botellas y refrescos */
export const appAmount = (r: Reservation) => r.total_amount ?? itemsTotal(r.bottles) + itemsTotal(r.mixers);

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
      partialCourtesy: !courtesy && !!reservation.bottles?.some((b) => b.courtesy),
      amount: courtesy ? 0 : appAmount(reservation),
    };
  });
}

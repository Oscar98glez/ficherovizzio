/**
 * Comisiones de los RRPP: un % de lo vendido en botellas (de sus reservas) y en entradas,
 * con un porcentaje distinto para cada día de la semana.
 */
import { isActiveReservation } from './constants';
import { parseDate } from './dates';
import { menuPrice } from './menu';
import type { CommissionRate, Reservation, TicketSale } from './types';

/** Días en el orden de la semana española (lunes primero); el valor es el de Date.getDay() */
export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

export const weekdayOf = (date: string) => parseDate(date).getDay();

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface NightCommission {
  date: string;
  bottles: number;
  bottleSales: number;
  bottlePct: number;
  bottleCommission: number;
  tickets: number;
  ticketSales: number;
  ticketPct: number;
  ticketCommission: number;
  total: number;
}

export interface RrppCommission {
  employeeId: string;
  nights: NightCommission[];
  bottles: number;
  bottleSales: number;
  bottleCommission: number;
  tickets: number;
  ticketSales: number;
  ticketCommission: number;
  total: number;
}

/** Botellas vendidas en una reserva (sin las de cortesía) y su importe según el precio guardado o la carta */
export function reservationBottles(r: Reservation) {
  const sold = (r.bottles ?? []).filter((b) => !b.courtesy);
  return {
    qty: sold.reduce((a, b) => a + b.qty, 0),
    sales: round2(sold.reduce((a, b) => a + b.qty * (b.price ?? menuPrice(b.name) ?? 0), 0)),
  };
}

/**
 * Comisiones de cada RRPP. Cuentan las reservas en las que es el RRPP (no las canceladas
 * ni las de "No vino") y las entradas que tiene registradas, con el % del día de cada noche.
 */
export function computeCommissions(reservations: Reservation[], tickets: TicketSale[], rates: CommissionRate[]): Map<string, RrppCommission> {
  const rate = new Map(rates.map((r) => [r.weekday, r]));
  const nights = new Map<string, Map<string, NightCommission>>();
  const night = (employeeId: string, date: string) => {
    let byDate = nights.get(employeeId);
    if (!byDate) nights.set(employeeId, (byDate = new Map()));
    let n = byDate.get(date);
    if (!n) {
      const r = rate.get(weekdayOf(date));
      n = { date, bottles: 0, bottleSales: 0, bottlePct: Number(r?.bottle_pct ?? 0), bottleCommission: 0, tickets: 0, ticketSales: 0, ticketPct: Number(r?.ticket_pct ?? 0), ticketCommission: 0, total: 0 };
      byDate.set(date, n);
    }
    return n;
  };

  for (const r of reservations) {
    if (!r.rrpp_id || !isActiveReservation(r)) continue;
    const { qty, sales } = reservationBottles(r);
    if (!qty) continue;
    const n = night(r.rrpp_id, r.date);
    n.bottles += qty;
    n.bottleSales = round2(n.bottleSales + sales);
  }
  for (const t of tickets) {
    if (!t.quantity) continue;
    const n = night(t.employee_id, t.date);
    n.tickets += t.quantity;
    n.ticketSales = round2(n.ticketSales + t.quantity * Number(t.unit_price));
  }

  const out = new Map<string, RrppCommission>();
  for (const [employeeId, byDate] of nights) {
    const list = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const n of list) {
      n.bottleCommission = round2((n.bottleSales * n.bottlePct) / 100);
      n.ticketCommission = round2((n.ticketSales * n.ticketPct) / 100);
      n.total = round2(n.bottleCommission + n.ticketCommission);
    }
    const sum = (k: keyof NightCommission) => round2(list.reduce((a, n) => a + (n[k] as number), 0));
    out.set(employeeId, {
      employeeId,
      nights: list,
      bottles: sum('bottles'),
      bottleSales: sum('bottleSales'),
      bottleCommission: sum('bottleCommission'),
      tickets: sum('tickets'),
      ticketSales: sum('ticketSales'),
      ticketCommission: sum('ticketCommission'),
      total: sum('total'),
    });
  }
  return out;
}

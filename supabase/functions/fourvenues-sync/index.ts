// =====================================================================
//  Sincronización con Fourvenues (Integrations API) de Vizzio
//
//  Trae de Fourvenues, para las noches de los últimos días y las próximas:
//  · Noches: cada evento crea su noche en public.events (o se asocia a la
//    que ya hubiera ese día sin evento de Fourvenues).
//  · Entradas de cada noche: vendidas (de pago, cualquier canal), QR gratis
//    (las personas apuntadas en las listas de Fourvenues) y cuántas han entrado.
//    No se apunta ningún ingreso en Finanzas: la venta la mete el administrador a mano.
//  · Reservados: las reservas de mesa de Fourvenues de cada noche (sin canceladas).
//  · Desglose por RRPP de cada noche (public.fourvenues_rrpp_nights): entradas de
//    pago, personas en listas y reservados de cada RRPP, con su nombre de Fourvenues.
//  Si la clave no tiene acceso a las listas o a las reservas, se sincroniza el resto
//  y se avisa (el dato queda vacío) en lugar de fallar toda la sincronización.
//  · Comisiones RRPP: las entradas vendidas con el enlace de cada RRPP pasan a
//    public.rrpp_ticket_sales (cantidad y precio medio; la lista sigue a mano).
//    El RRPP de Fourvenues se asocia a su ficha por employees.fourvenues_user_id
//    (se rellena solo si el email coincide; si no, desde Ajustes).
//  Todo lleva el id de Fourvenues: sincronizar varias veces no duplica nada.
//
//  Secretos de la función (Supabase → Edge Functions → Secrets):
//    FOURVENUES_API_KEY   la clave (cabecera x-api-key). Nunca va al navegador.
//    FOURVENUES_ENV       "production" (por defecto) o "alpha" (pruebas)
//    (Claves antiguas: FOURVENUES_INTEGRATION_ID + FOURVENUES_SECRET en lugar de la API key)
//
//  Peticiones (POST, con la sesión de un administrador de la app):
//    { "action": "status" }                        → si hay clave, entorno y última sincronización
//    { "action": "users" }                         → usuarios de Fourvenues (para asociar los RRPP)
//    { "action": "inspect" }                       → forma de los datos (campos y tipos, sin valores)
//    { "action": "sync", "force"?, "from"? }       → sincroniza; sin "force" no repite si se hizo
//                                                    hace menos de 10 minutos. "from" (AAAA-MM-DD)
//                                                    trae noches más antiguas.
//
//  Despliegue: .github/workflows/deploy-functions.yml (al cambiar en main);
//  a mano: `supabase functions deploy fourvenues-sync --no-verify-jwt`.
//  La sesión se comprueba aquí dentro, como en "notify".
// =====================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const TZ = 'Europe/Madrid';
/** Las noches van de 06:00 a 06:00 (hora de Madrid), como los fichajes */
const NIGHT_OFFSET_MS = 6 * 3600_000;
/** Ventana normal: noches de la última semana y de los próximos dos meses */
const PAST_DAYS = 7;
const FUTURE_DAYS = 60;
/** Lo más atrás que se puede pedir con "from" */
const MAX_BACKFILL_DAYS = 180;
/** Las sincronizaciones automáticas (al abrir Noches) no se repiten antes de esto */
const AUTO_INTERVAL_MS = 10 * 60_000;
/** Si una sincronización se quedó colgada, a los 5 minutos se puede lanzar otra */
const LOCK_MS = 5 * 60_000;
/** Fourvenues pide no pasar de 10 peticiones por segundo */
const REQUEST_GAP_MS = 120;
const TICKETS_PAGE = 500;

/**
 * Entradas que no cuentan para las comisiones de los RRPP: las invitaciones (0 €) y las
 * vendidas en la puerta con la taquilla de Fourvenues.
 */
const NOT_ONLINE_SALES = new Set(['invitation', 'box-office']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

// ---------------------------------------------------------------------
//  Datos de Fourvenues (sólo los campos que se usan)
// ---------------------------------------------------------------------

export interface FvEvent {
  _id: string;
  name?: string;
  /** Inicio del día del evento (unix) */
  date?: number;
  /** Inicio y fin del evento (unix) */
  start?: number;
  end?: number;
  active?: boolean;
}

export interface FvTicket {
  _id: string;
  event_id?: string;
  /** activated · cancelled · filling_client (la documentación lo da como lista) */
  status?: string | string[];
  /** online · sms · imported · invitation · paylink · print · box-office */
  sale_type?: string;
  /** Personas de la entrada */
  for?: number;
  /** Personas que han entrado */
  enter?: number;
  price?: number;
  /** Base + extras + gastos de gestión − descuento */
  total_paid?: number;
  /** Gastos de gestión */
  total_fees?: number;
  refunded?: number;
  /** RRPP que la ha vendido (usuario de Fourvenues): su id o, a veces, el usuario entero */
  referral_id?: Referral;
}

/** Inscripción en una lista de Fourvenues (QR gratis); sólo los campos que se usan */
export interface FvListEntry {
  _id: string;
  event_id?: string;
  /** Igual que en las entradas: activated · cancelled · ... */
  status?: string | string[];
  /** Personas de la inscripción */
  for?: number;
  /** Personas que han entrado */
  enter?: number;
  /** RRPP de la lista (usuario de Fourvenues), como en las entradas */
  referral_id?: Referral;
}

/** Reserva de mesa de Fourvenues; sólo los campos que se usan */
export interface FvBooking {
  _id: string;
  event_id?: string;
  status?: string | string[];
  /** Estado de la reserva (además de status) */
  state?: string;
  /** RRPP de la reserva (usuario de Fourvenues) */
  referral_id?: Referral;
}

export interface FvUser {
  _id: string;
  /** El nombre va dentro de "profile" (por si acaso, también se mira arriba) */
  profile?: { name?: string; last_name?: string } | null;
  name?: string;
  last_name?: string;
  email?: string;
}

/** El RRPP de una venta: normalmente su id; por si acaso, también el usuario con sus datos */
export type Referral = string | { _id?: string; id?: string; name?: string; last_name?: string } | null;

/** Id del RRPP de una venta ('' = sin RRPP) */
export function refId(r: unknown): string {
  if (typeof r === 'string') return r.trim();
  if (r && typeof r === 'object') {
    const o = r as { _id?: unknown; id?: unknown };
    const id = o._id ?? o.id;
    return typeof id === 'string' ? id.trim() : '';
  }
  return '';
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Nombre de una persona en un objeto de Fourvenues (name + last_name, full_name...) */
export function personName(o: unknown): string | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const p = o as Record<string, unknown>;
  const full = [str(p.name) ?? str(p.first_name), str(p.last_name) ?? str(p.surname)].filter(Boolean).join(' ');
  return full || str(p.full_name) || str(p.fullname) || str(p.display_name) || str(p.username) || null;
}

/** Campos en los que alguna versión de la API podría traer el RRPP con su nombre */
const REFERRAL_OBJECTS = ['referral_id', 'referral', 'referral_user', 'referrer', 'rrpp', 'promoter', 'public_relation', 'public_relations'];
const REFERRAL_NAMES = ['referral_name', 'referral_full_name', 'referrer_name', 'rrpp_name', 'promoter_name'];

/** Nombre del RRPP si viene dentro de la propia venta (entrada, lista o reserva) */
export function embeddedReferralName(item: Record<string, unknown>): string | null {
  for (const k of REFERRAL_NAMES) if (str(item[k])) return str(item[k]);
  const ref = refId(item.referral_id);
  for (const k of REFERRAL_OBJECTS) {
    const v = item[k];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const id = refId(v);
    if (ref && id && id !== ref) continue;
    const name = personName(v);
    if (name) return name;
  }
  return null;
}

/** Apunta el nombre de cada RRPP que venga dentro de las ventas */
export function collectReferralNames(items: unknown[], names: Map<string, string>) {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const ref = refId((item as { referral_id?: unknown }).referral_id);
    if (!ref || names.has(ref)) continue;
    const name = embeddedReferralName(item as Record<string, unknown>);
    if (name) names.set(ref, name);
  }
}

// ---------------------------------------------------------------------
//  Cálculos (sin acceso a red ni a la base de datos)
// ---------------------------------------------------------------------

const toMs = (unix: number) => (unix > 1e12 ? unix : unix * 1000);

/** AAAA-MM-DD en hora de Madrid */
export const madridDate = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Noche de la app a la que pertenece un evento: la de su hora de inicio (de 06:00 a 06:00) */
export function eventNight(e: FvEvent): string | null {
  if (e.start) return madridDate(toMs(e.start) - NIGHT_OFFSET_MS);
  if (e.date) return madridDate(toMs(e.date));
  return null;
}

const statuses = (t: { status?: string | string[] }) => (Array.isArray(t.status) ? t.status : t.status ? [t.status] : []);
/** Canceladas o sin terminar de rellenar (SMS) no cuentan */
const isValid = (t: FvTicket) => !statuses(t).some((s) => s === 'cancelled' || s === 'filling_client');
const people = (t: { for?: number }) => Math.max(1, Math.round(num(t.for ?? 1)));
/** Lo que se queda el local: lo pagado sin gastos de gestión ni devoluciones */
export const netAmount = (t: FvTicket) => round2(Math.max(0, num(t.total_paid ?? t.price) - num(t.total_fees) - num(t.refunded)));

export interface Sales {
  people: number;
  revenue: number;
}

export interface TicketSummary {
  /** Personas con entrada (cualquier tipo, sin canceladas ni devueltas del todo) */
  people: number;
  /** De ellas, con entrada de pago (cualquier canal); las invitaciones de 0 € no cuentan */
  paid: number;
  /** Personas con entrada de pago de cada RRPP ('' = sin RRPP) */
  paidByReferral: Map<string, number>;
  /** Personas que ya han entrado */
  entered: number;
  /** Venta online: personas e importe */
  sold: number;
  revenue: number;
  /** Venta online de cada RRPP (por su usuario de Fourvenues) */
  byReferral: Map<string, Sales>;
}

export function summarize(tickets: FvTicket[]): TicketSummary {
  const out: TicketSummary = { people: 0, paid: 0, paidByReferral: new Map(), entered: 0, sold: 0, revenue: 0, byReferral: new Map() };
  for (const t of tickets) {
    if (!isValid(t)) continue;
    const net = netAmount(t);
    if (num(t.refunded) > 0 && net === 0) continue; // devuelta del todo
    const p = people(t);
    out.people += p;
    out.entered += Math.min(p, Math.max(0, Math.round(num(t.enter))));
    if (t.sale_type !== 'invitation' && num(t.total_paid ?? t.price) > 0) {
      out.paid += p;
      const ref = refId(t.referral_id);
      out.paidByReferral.set(ref, (out.paidByReferral.get(ref) ?? 0) + p);
    }
    if (NOT_ONLINE_SALES.has(t.sale_type ?? '') || net <= 0) continue;
    out.sold += p;
    out.revenue += net;
    const ref = refId(t.referral_id);
    if (ref) {
      const r = out.byReferral.get(ref) ?? { people: 0, revenue: 0 };
      r.people += p;
      r.revenue += net;
      out.byReferral.set(ref, r);
    }
  }
  out.revenue = round2(out.revenue);
  for (const r of out.byReferral.values()) r.revenue = round2(r.revenue);
  return out;
}

/** Listas (QR gratis): personas apuntadas, sin las canceladas, y cuántas han entrado */
export function summarizeLists(entries: FvListEntry[]) {
  /** byReferral: personas en las listas de cada RRPP ('' = sin RRPP) */
  const out = { people: 0, entered: 0, byReferral: new Map<string, number>() };
  for (const e of entries) {
    if (statuses(e).some((s) => s === 'cancelled')) continue;
    const p = people(e);
    out.people += p;
    out.entered += Math.min(p, Math.max(0, Math.round(num(e.enter))));
    const ref = refId(e.referral_id);
    out.byReferral.set(ref, (out.byReferral.get(ref) ?? 0) + p);
  }
  return out;
}

/** Reservas que no cuentan */
const DEAD_BOOKING = /cancel|reject|expire|refund|delete/i;

/** Reservados (reservas de mesa, sin canceladas ni rechazadas) de la noche y de cada RRPP */
export function summarizeBookings(bookings: FvBooking[]) {
  const out = { count: 0, byReferral: new Map<string, number>() };
  for (const b of bookings) {
    if ([...statuses(b), b.state ?? ''].some((st) => DEAD_BOOKING.test(st))) continue;
    out.count++;
    const ref = refId(b.referral_id);
    out.byReferral.set(ref, (out.byReferral.get(ref) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------
//  API de Fourvenues
// ---------------------------------------------------------------------

export const envName = () => (Deno.env.get('FOURVENUES_ENV')?.toLowerCase().startsWith('alpha') ? 'alpha' : 'production');

function baseUrl() {
  const custom = Deno.env.get('FOURVENUES_BASE_URL');
  if (custom) return custom.replace(/\/$/, '');
  return envName() === 'alpha' ? 'https://api-alpha.fourvenues.com/integrations' : 'https://api.fourvenues.com/integrations';
}

/** Cabeceras de autenticación: la API key (v2) o el par integration_id + secret (v1) */
function authHeaders(): Record<string, string> | null {
  const key = Deno.env.get('FOURVENUES_API_KEY')?.trim();
  if (key) return { 'x-api-key': key };
  const id = Deno.env.get('FOURVENUES_INTEGRATION_ID')?.trim();
  const secret = Deno.env.get('FOURVENUES_SECRET')?.trim();
  return id && secret ? { integration_id: id, secret } : null;
}

const RESOURCES: Record<string, string> = {
  events: 'los eventos',
  tickets: 'las entradas',
  lists: 'las listas',
  bookings: 'las reservas (reservados)',
  users: 'los usuarios (RRPP)',
  channels: 'los canales',
};

export class FvError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function explain(status: number, path: string, body: unknown) {
  const resource = RESOURCES[path.split('/').filter(Boolean)[0]] ?? path;
  if (status === 401) return 'Fourvenues no acepta la clave: no es válida, ha caducado o es de otro entorno (revisa FOURVENUES_API_KEY y FOURVENUES_ENV).';
  if (status === 403) return `La clave de Fourvenues no tiene permiso para ${resource}. Pide a Fourvenues que la amplíe.`;
  if (status === 429) return 'Fourvenues pide esperar (demasiadas peticiones). Vuelve a intentarlo en unos minutos.';
  const detail = (body as { message?: string; error?: string } | null)?.message ?? (body as { error?: string } | null)?.error;
  return `Fourvenues ha respondido ${status} al pedir ${resource}${detail ? `: ${detail}` : ''}.`;
}

async function fv<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const headers = authHeaders();
  if (!headers) throw new FvError(0, 'Falta la clave de Fourvenues (secreto FOURVENUES_API_KEY de la función).');
  const url = new URL(baseUrl() + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { ...headers, Accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    await sleep(REQUEST_GAP_MS);
    // Límite de peticiones o fallo momentáneo: se reintenta esperando cada vez más
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok || (body as { success?: boolean } | null)?.success === false) throw new FvError(res.status, explain(res.status, path, body));
    return (body as { data?: T } | null)?.data as T;
  }
}

/** Todos los usuarios de Fourvenues (de 500 en 500, por si la API los da por páginas) */
async function allUsers(): Promise<FvUser[]> {
  const byId = new Map<string, FvUser>();
  let previousFirst: string | undefined;
  for (let offset = 0; offset < 20_000; offset += TICKETS_PAGE) {
    let page: FvUser[];
    try {
      page = (await fv<FvUser[]>('/users/', { limit: String(TICKETS_PAGE), offset: String(offset) })) ?? [];
    } catch (e) {
      // Si no admite páginas, se piden todos de una vez
      if (offset === 0 && e instanceof FvError && [400, 422].includes(e.status)) return (await fv<FvUser[]>('/users/')) ?? [];
      throw e;
    }
    if (!page.length || page[0]?._id === previousFirst) break;
    previousFirst = page[0]?._id;
    for (const u of page) if (u?._id) byId.set(u._id, u);
    if (page.length < TICKETS_PAGE) break;
  }
  return [...byId.values()];
}

/** Un usuario de Fourvenues por su id (null si no existe o no se puede ver) */
async function userById(id: string): Promise<FvUser | null> {
  try {
    const u = await fv<FvUser | FvUser[]>(`/users/${encodeURIComponent(id)}`);
    return (Array.isArray(u) ? u[0] : u) ?? null;
  } catch (e) {
    if (e instanceof FvError) return null;
    throw e;
  }
}

/** Todas las entradas de un evento (de 500 en 500) */
async function eventTickets(eventId: string): Promise<FvTicket[]> {
  return eventItems<FvTicket>('/tickets/', eventId);
}

/** Todas las inscripciones en las listas de un evento */
async function eventLists(eventId: string): Promise<FvListEntry[]> {
  return eventItemsWithFallback<FvListEntry>('/lists/', eventId);
}

/**
 * Todas las reservas de mesa de un evento. Fourvenues exige un rango de fechas (start_date y
 * end_date en ISO 8601) y no admite páginas de 500: se pide la noche con un día de margen, de 100 en 100.
 */
async function eventBookings(eventId: string, night: string): Promise<FvBooking[]> {
  const iso = (d: string) => `${d}T00:00:00.000Z`;
  return eventItems<FvBooking>('/bookings/', eventId, { start_date: iso(addDays(night, -1)), end_date: iso(addDays(night, 2)) }, 100);
}

/**
 * Como eventItems, pero si Fourvenues rechaza la petición por los parámetros (400/422) se
 * reintenta con date_field=updated_at, que es como aparece en sus ejemplos para las listas.
 */
async function eventItemsWithFallback<T extends { _id: string }>(path: string, eventId: string): Promise<T[]> {
  try {
    return await eventItems<T>(path, eventId);
  } catch (e) {
    if (!(e instanceof FvError) || ![400, 422].includes(e.status)) throw e;
    return await eventItems<T>(path, eventId, { date_field: 'updated_at' });
  }
}

/** Todo lo de un evento en un recurso paginado (entradas, listas o reservas), de 500 en 500 */
async function eventItems<T extends { _id: string }>(path: string, eventId: string, extra: Record<string, string> = {}, pageSize = TICKETS_PAGE): Promise<T[]> {
  const byId = new Map<string, T>();
  let previousFirst: string | undefined;
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const page = (await fv<T[]>(path, { ...extra, event_id: eventId, limit: String(pageSize), offset: String(offset) })) ?? [];
    // Si la API ignorase el desplazamiento, devolvería la misma página: se para
    if (!page.length || page[0]._id === previousFirst) break;
    previousFirst = page[0]._id;
    for (const t of page) byId.set(t._id, t);
    if (page.length < pageSize) break;
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------
//  Sincronización
// ---------------------------------------------------------------------

interface LocalEvent {
  id: string;
  date: string;
  fourvenues_id: string | null;
}

interface Employee {
  id: string;
  email: string | null;
  fourvenues_user_id: string | null;
}

export interface SyncResult {
  from: string;
  to: string;
  /** Eventos de Fourvenues en la ventana */
  events: number;
  /** Noches creadas, asociadas a una que ya existía, o con la fecha cambiada */
  created: number;
  linked: number;
  moved: number;
  /** Entradas vendidas, QR gratis (personas en las listas) y reservados de la ventana */
  paid: number;
  free: number;
  bookings: number;
  /** Venta online (para las comisiones de los RRPP) */
  tickets: number;
  revenue: number;
  /** Filas de entradas de RRPP escritas y RRPP asociados por email en esta sincronización */
  rrpp: number;
  rrppLinked: number;
  /** RRPP de Fourvenues con ventas que no están asociados a ninguna ficha */
  unmatched: { id: string; name: string | null; email: string | null; tickets: number; revenue: number }[];
  /** RRPP con ventas de los que Fourvenues no ha dado el nombre */
  unnamed: number;
  warnings: string[];
}

const check = <T,>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

const fullName = (u: FvUser) => personName(u.profile) ?? personName(u);

export async function runSync(db: SupabaseClient, from: string, to: string): Promise<SyncResult> {
  const now = new Date().toISOString();
  const result: SyncResult = { from, to, events: 0, created: 0, linked: 0, moved: 0, paid: 0, free: 0, bookings: 0, tickets: 0, revenue: 0, rrpp: 0, rrppLinked: 0, unmatched: [], unnamed: 0, warnings: [] };

  // ---------- Noches ----------
  // Se pide un día más por cada lado por si Fourvenues filtra por la fecha "de calendario"
  const fvEvents = ((await fv<FvEvent[]>('/events/', { start: addDays(from, -1), end: addDays(to, 1) })) ?? [])
    .map((e) => ({ e, night: eventNight(e) }))
    .filter((x): x is { e: FvEvent; night: string } => !!x.e?._id && !!x.night && x.night >= from && x.night <= to)
    .sort((a, b) => toMs(a.e.start ?? a.e.date ?? 0) - toMs(b.e.start ?? b.e.date ?? 0));
  result.events = fvEvents.length;
  if (!fvEvents.length) return result;

  const linkedRows = check(
    await db.from('events').select('id, date, fourvenues_id').in('fourvenues_id', fvEvents.map((x) => x.e._id)),
    'Noches',
  ) as LocalEvent[];
  const freeRows = check(
    await db.from('events').select('id, date, fourvenues_id').in('date', [...new Set(fvEvents.map((x) => x.night))]).is('fourvenues_id', null),
    'Noches',
  ) as LocalEvent[];
  const linked = new Map(linkedRows.map((r) => [r.fourvenues_id!, r]));
  const claimed = new Set<string>();

  const synced: { fvId: string; local: LocalEvent }[] = [];
  /** Venta de cada RRPP por noche (dos eventos la misma noche se suman) */
  const rrppByNight = new Map<string, Map<string, Sales>>();
  for (const { e, night } of fvEvents) {
    let local = linked.get(e._id);
    if (local && local.date !== night) {
      const previous = local.date;
      check(await db.from('events').update({ date: night }).eq('id', local.id), 'Noches');
      // Las entradas de RRPP de la fecha anterior se revisan también (se quedan a 0)
      if (!rrppByNight.has(previous)) rrppByNight.set(previous, new Map());
      local = { ...local, date: night };
      result.moved++;
    }
    // Los eventos desactivados en Fourvenues no crean noche (si ya la tenían, se sigue actualizando)
    if (!local && e.active !== false) {
      // Si ese día ya hay una noche creada a mano (y sólo una), se asocia a ella
      const same = freeRows.filter((r) => r.date === night && !claimed.has(r.id));
      if (same.length === 1) {
        check(await db.from('events').update({ fourvenues_id: e._id }).eq('id', same[0].id), 'Noches');
        local = { ...same[0], fourvenues_id: e._id };
        claimed.add(local.id);
        result.linked++;
      } else {
        local = check(
          await db
            .from('events')
            .insert({ name: (e.name ?? '').trim() || 'Noche', date: night, kind: 'sesion', fourvenues_id: e._id })
            .select('id, date, fourvenues_id')
            .single(),
          'Noches',
        ) as LocalEvent;
        result.created++;
      }
    }
    if (local) synced.push({ fvId: e._id, local });
  }

  // ---------- Entradas de cada noche (sin ingresos: la venta se apunta a mano en Finanzas) ----------
  let listsUnavailable = false;
  let bookingsUnavailable = false;
  /** Desglose por RRPP de cada noche: entradas de pago, personas en listas y reservados */
  const breakdowns: { eventId: string; tickets: Map<string, number>; lists: Map<string, number> | null; bookings: Map<string, number> | null }[] = [];
  /** Nombre de cada RRPP que venga dentro de las propias ventas */
  const embeddedNames = new Map<string, string>();
  for (const { fvId, local } of synced) {
    const tickets = await eventTickets(fvId);
    collectReferralNames(tickets, embeddedNames);
    const s = summarize(tickets);
    result.paid += s.paid;
    result.tickets += s.sold;
    result.revenue = round2(result.revenue + s.revenue);

    // QR gratis (listas) y reservados (reservas de mesa). Si Fourvenues no los da, se sigue sin ellos
    let lists: ReturnType<typeof summarizeLists> | null = null;
    if (!listsUnavailable) {
      try {
        const entries = await eventLists(fvId);
        collectReferralNames(entries, embeddedNames);
        lists = summarizeLists(entries);
        result.free += lists.people;
      } catch (e) {
        if (!(e instanceof FvError)) throw e;
        listsUnavailable = true;
        result.warnings.push(`${e.message} Sin eso no se pueden contar los QR gratis de las listas.`);
      }
    }
    let bookings: ReturnType<typeof summarizeBookings> | null = null;
    if (!bookingsUnavailable) {
      try {
        const items = await eventBookings(fvId, local.date);
        collectReferralNames(items, embeddedNames);
        bookings = summarizeBookings(items);
        result.bookings += bookings.count;
      } catch (e) {
        if (!(e instanceof FvError)) throw e;
        bookingsUnavailable = true;
        result.warnings.push(`${e.message} Sin eso no se pueden contar los reservados.`);
      }
    }

    check(
      await db
        .from('events')
        .update({
          tickets_sold: s.people,
          tickets_paid: s.paid,
          tickets_free: lists?.people ?? null,
          tickets_entered: s.entered + (lists?.entered ?? 0),
          bookings: bookings?.count ?? null,
          fourvenues_synced_at: now,
        })
        .eq('id', local.id),
      'Noches',
    );

    breakdowns.push({ eventId: local.id, tickets: s.paidByReferral, lists: lists?.byReferral ?? null, bookings: bookings?.byReferral ?? null });

    const night = rrppByNight.get(local.date) ?? new Map<string, Sales>();
    for (const [ref, v] of s.byReferral) {
      const acc = night.get(ref) ?? { people: 0, revenue: 0 };
      acc.people += v.people;
      acc.revenue = round2(acc.revenue + v.revenue);
      night.set(ref, acc);
    }
    rrppByNight.set(local.date, night);
  }

  // ---------- RRPP ----------
  const employees = check(await db.from('employees').select('id, email, fourvenues_user_id'), 'Personal') as Employee[];
  const byFvUser = new Map(employees.filter((e) => e.fourvenues_user_id).map((e) => [e.fourvenues_user_id!, e.id]));
  const referrals = new Map<string, Sales>();
  for (const night of rrppByNight.values())
    for (const [ref, v] of night) {
      const acc = referrals.get(ref) ?? { people: 0, revenue: 0 };
      acc.people += v.people;
      acc.revenue = round2(acc.revenue + v.revenue);
      referrals.set(ref, acc);
    }

  // Usuarios de Fourvenues: para el nombre de cada RRPP en el desglose y para asociarlos a su ficha
  let users = new Map<string, FvUser>();
  const missing = [...referrals.keys()].filter((id) => !byFvUser.has(id));
  const allRefs = new Set(breakdowns.flatMap((b) => [...b.tickets.keys(), ...(b.lists?.keys() ?? []), ...(b.bookings?.keys() ?? [])]).filter(Boolean));
  if (missing.length || allRefs.size) {
    try {
      users = new Map((await allUsers()).map((u) => [u._id, u]));
    } catch (e) {
      if (!(e instanceof FvError)) throw e;
      result.warnings.push(`${e.message} Los RRPP saldrán con el nombre que venga en sus ventas, si viene.`);
    }
  }
  // Los que no están en la lista de usuarios ni traen el nombre en sus ventas se piden uno a uno
  for (const id of [...allRefs].filter((id) => !users.has(id) && !embeddedNames.has(id)).slice(0, 40)) {
    const u = await userById(id);
    if (u) users.set(id, { ...u, _id: id });
  }
  // Nombres guardados: los vistos en otras sincronizaciones y los puestos a mano
  const stored = new Map<string, { name: string; manual: boolean }>();
  const storedRows = await db.from('fourvenues_rrpp_names').select('fourvenues_user_id, name, manual');
  if (!storedRows.error) for (const r of storedRows.data ?? []) stored.set(r.fourvenues_user_id, { name: r.name, manual: r.manual });
  /** Nombre que da Fourvenues ahora mismo */
  const fvName = (id: string) => (users.has(id) ? fullName(users.get(id)!) : null) ?? embeddedNames.get(id) ?? null;
  /** Nombre del RRPP: el de Fourvenues; si no lo da, el guardado */
  const rrppName = (id: string) => (id ? fvName(id) ?? stored.get(id)?.name ?? null : null);
  // Se guardan los nombres nuevos o cambiados de Fourvenues (también los de usuarios sin ventas ahora)
  if (!storedRows.error) {
    const fresh = [...new Set([...allRefs, ...missing])]
      .map((id) => ({ id, name: fvName(id) }))
      .filter((x): x is { id: string; name: string } => !!x.name && (stored.get(x.id)?.name !== x.name || !!stored.get(x.id)?.manual))
      .map((x) => ({ fourvenues_user_id: x.id, name: x.name, manual: false, updated_at: now }));
    if (fresh.length) check(await db.from('fourvenues_rrpp_names').upsert(fresh, { onConflict: 'fourvenues_user_id' }), 'Nombres de RRPP');
  }
  const unnamed = [...allRefs].filter((id) => !rrppName(id));
  result.unnamed = unnamed.length;
  if (unnamed.length)
    result.warnings.push(
      `Fourvenues no da el nombre de ${unnamed.length} RRPP (no están entre sus usuarios). Salen con su código: ponles el nombre desde la noche (botón «Poner nombre»).`,
    );

  if (missing.length) {
    // Se asocian solos los RRPP cuyo email de Fourvenues coincide con el de su ficha
    for (const id of missing) {
      const email = users.get(id)?.email?.trim().toLowerCase();
      const emp = email && employees.find((x) => !x.fourvenues_user_id && x.email?.trim().toLowerCase() === email);
      if (!emp) continue;
      check(await db.from('employees').update({ fourvenues_user_id: id }).eq('id', emp.id), 'Personal');
      emp.fourvenues_user_id = id;
      byFvUser.set(id, emp.id);
      result.rrppLinked++;
    }
  }
  result.unmatched = [...referrals]
    .filter(([id]) => !byFvUser.has(id))
    .map(([id, v]) => ({ id, name: rrppName(id), email: users.get(id)?.email ?? null, tickets: v.people, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  // Desglose por RRPP de cada noche: se rehace entero
  for (const b of breakdowns) {
    const refs = new Set([...b.tickets.keys(), ...(b.lists?.keys() ?? []), ...(b.bookings?.keys() ?? [])]);
    check(await db.from('fourvenues_rrpp_nights').delete().eq('event_id', b.eventId), 'Desglose por RRPP');
    if (!refs.size) continue;
    check(
      await db.from('fourvenues_rrpp_nights').insert(
        [...refs].map((ref) => ({
          event_id: b.eventId,
          fourvenues_user_id: ref,
          name: rrppName(ref),
          tickets: b.tickets.get(ref) ?? 0,
          lists: b.lists ? b.lists.get(ref) ?? 0 : null,
          bookings: b.bookings ? b.bookings.get(ref) ?? 0 : null,
          synced_at: now,
        })),
      ),
      'Desglose por RRPP',
    );
  }

  for (const [date, night] of rrppByNight) {
    const rows = new Map<string, Sales>();
    for (const [ref, v] of night) {
      const employeeId = byFvUser.get(ref);
      if (employeeId) rows.set(employeeId, v);
    }
    if (rows.size) {
      check(
        await db.from('rrpp_ticket_sales').upsert(
          [...rows].map(([employee_id, v]) => ({
            employee_id,
            date,
            quantity: v.people,
            // Precio medio: la comisión es cantidad × precio × %
            unit_price: round2(v.revenue / v.people),
            fourvenues_synced_at: now,
          })),
          { onConflict: 'employee_id,date' },
        ),
        'Entradas de RRPP',
      );
      result.rrpp += rows.size;
    }
    // Quien ya no tiene ventas esa noche (devoluciones, cambio de RRPP...) se queda a 0;
    // si la fila no tenía nada más (lista o notas), se borra
    const stale = (check(
      await db.from('rrpp_ticket_sales').select('id, employee_id, list_quantity, notes').eq('date', date).not('fourvenues_synced_at', 'is', null),
      'Entradas de RRPP',
    ) as { id: string; employee_id: string; list_quantity: number; notes: string | null }[]).filter((r) => !rows.has(r.employee_id));
    for (const r of stale) {
      if (!r.list_quantity && !r.notes) check(await db.from('rrpp_ticket_sales').delete().eq('id', r.id), 'Entradas de RRPP');
      else check(await db.from('rrpp_ticket_sales').update({ quantity: 0, fourvenues_synced_at: now }).eq('id', r.id), 'Entradas de RRPP');
    }
  }

  return result;
}

// ---------------------------------------------------------------------
//  Diagnóstico: forma de los datos de Fourvenues, sin datos personales
// ---------------------------------------------------------------------

/** Estructura de un objeto: sólo los nombres de los campos y su tipo (nunca los valores) */
export function shape(v: unknown, depth = 0): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : [];
  if (typeof v === 'object') {
    if (depth >= 3) return 'object';
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v;
}

/** Junta la forma de varios objetos (campos que aparecen en unos sí y en otros no) */
const shapes = (items: unknown[]) => {
  const out: Record<string, Set<string>> = {};
  for (const it of items.slice(0, 200)) {
    if (!it || typeof it !== 'object') continue;
    for (const [k, v] of Object.entries(it as Record<string, unknown>)) (out[k] ??= new Set()).add(JSON.stringify(shape(v, 1)));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].map((x) => JSON.parse(x))]));
};

async function inspect() {
  const today = madridDate(Date.now() - NIGHT_OFFSET_MS);
  const events = ((await fv<FvEvent[]>('/events/', { start: addDays(today, -21), end: addDays(today, 1) })) ?? []).filter((e) => e?._id);
  const out: Record<string, unknown> = { events: events.length };
  const grab = async <T,>(f: () => Promise<T[]>) => {
    try {
      return { items: await f() };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };
  // Las últimas noches: entradas y listas de cada una
  const recent = events.slice(-8);
  const allTickets: FvTicket[] = [];
  const allLists: FvListEntry[] = [];
  let best: { e: FvEvent; tickets: FvTicket[] } | null = null;
  for (const e of recent) {
    const tickets = await eventTickets(e._id);
    allTickets.push(...tickets);
    const lists = await grab(() => eventLists(e._id));
    allLists.push(...(lists.items ?? []));
    if (!best || tickets.length > best.tickets.length) best = { e, tickets };
  }
  if (!best) return out;
  const bookings = await grab(() => eventBookings(best!.e._id, eventNight(best!.e) ?? today));
  const users = await grab(() => allUsers());
  const userMap = new Map((users.items ?? []).map((u) => [u._id, u]));
  const names = new Map<string, string>();
  collectReferralNames([...allTickets, ...allLists, ...(bookings.items ?? [])], names);
  const refs = (items: unknown[] | undefined) => {
    const ids = [...new Set((items ?? []).map((x) => refId((x as { referral_id?: unknown })?.referral_id)).filter(Boolean))];
    return {
      referrals: ids.length,
      inUsers: ids.filter((id) => userMap.has(id)).length,
      withUserName: ids.filter((id) => userMap.has(id) && fullName(userMap.get(id)!)).length,
      withSaleName: ids.filter((id) => names.has(id)).length,
      named: ids.filter((id) => (userMap.has(id) && fullName(userMap.get(id)!)) || names.has(id)).length,
    };
  };
  // Un RRPP de las entradas sin nombre: ¿alguna ruta de la API lo conoce?
  const unknown = [...new Set(allTickets.map((t) => refId(t.referral_id)).filter((id) => id && !userMap.has(id) && !names.has(id)))];
  return {
    ...out,
    nights: recent.length,
    tickets: { count: allTickets.length, ...refs(allTickets) },
    lists: { count: allLists.length, ...refs(allLists) },
    bookings: bookings.items ? { count: bookings.items.length, fields: shapes(bookings.items), ...refs(bookings.items) } : bookings,
    users: users.items ? { count: users.items.length, withName: users.items.filter((u) => fullName(u)).length } : users,
    ticketReferralsWithoutName: unknown.length,
  };
}

// ---------------------------------------------------------------------
//  Servidor
// ---------------------------------------------------------------------

/** Claves de servicio de este proyecto (para llamadas desde GitHub Actions) */
function serviceKeys(): string[] {
  const keys: string[] = [];
  try {
    keys.push(...Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>));
  } catch {
    /* sin claves nuevas */
  }
  for (const k of [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('VIZZIO_SERVICE_KEY')]) if (k) keys.push(k);
  return keys.filter(Boolean);
}

/** Clave de servicio: la secreta nueva de Supabase (SUPABASE_SECRET_KEYS) o la antigua */
function serviceKey(): string | undefined {
  const custom = Deno.env.get('VIZZIO_SERVICE_KEY');
  if (custom) return custom;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    const key = keys.default ?? Object.values(keys)[0];
    if (key) return key;
  } catch {
    /* sin claves nuevas */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined;
}

const syncRow = async (db: SupabaseClient) =>
  check(await db.from('fourvenues_sync').select('running_since, last_run_at, last_ok_at, last_error, last_result').eq('id', 1).maybeSingle(), 'Estado');

async function sync(db: SupabaseClient, force: boolean, fromParam?: string) {
  if (!authHeaders()) return json({ error: 'Falta la clave de Fourvenues: guárdala en Supabase → Edge Functions → Secrets como FOURVENUES_API_KEY.' }, 400);

  const today = madridDate(Date.now() - NIGHT_OFFSET_MS);
  let from = addDays(today, -PAST_DAYS);
  if (fromParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) return json({ error: 'Fecha no válida (AAAA-MM-DD)' }, 400);
    if (fromParam < addDays(today, -MAX_BACKFILL_DAYS)) return json({ error: `Como mucho se pueden traer los últimos ${MAX_BACKFILL_DAYS} días.` }, 400);
    from = fromParam < from ? fromParam : from;
  }
  const to = addDays(today, FUTURE_DAYS);

  const state = (await syncRow(db)) as { last_run_at: string | null } | null;
  if (!state) return json({ error: 'Falta aplicar en Supabase la migración de Fourvenues (20261008160000_fourvenues.sql).' }, 500);
  if (!force && state.last_run_at && Date.now() - Date.parse(state.last_run_at) < AUTO_INTERVAL_MS) return json({ skipped: true, sync: state });

  // Se "reserva" la sincronización; si ya hay otra en curso, no se lanza
  const started = new Date();
  const lock = check(
    await db
      .from('fourvenues_sync')
      .update({ running_since: started.toISOString() })
      .eq('id', 1)
      .or(`running_since.is.null,running_since.lt."${new Date(started.getTime() - LOCK_MS).toISOString()}"`)
      .select('id'),
    'Estado',
  ) as unknown[];
  if (!lock.length) return json({ skipped: true, running: true, sync: await syncRow(db) });

  try {
    const result = await runSync(db, from, to);
    const done = new Date().toISOString();
    await db.from('fourvenues_sync').update({ running_since: null, last_run_at: done, last_ok_at: done, last_error: null, last_result: result }).eq('id', 1);
    return json({ result, sync: await syncRow(db) });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    await db.from('fourvenues_sync').update({ running_since: null, last_run_at: new Date().toISOString(), last_error: message }).eq('id', 1);
    return json({ error: message }, 502);
  }
}

async function handler(req: Request, db: SupabaseClient | null) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!db) return json({ error: 'Falta la configuración de Supabase en la función' }, 500);

  // Sólo administradores con sesión en la app (o la clave de servicio, desde GitHub Actions)
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || !serviceKeys().includes(token)) {
    const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!auth?.user) return json({ error: 'Inicia sesión en la app' }, 401);
    const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
    if (profile?.role !== 'admin') return json({ error: 'Sólo los administradores pueden usar la integración con Fourvenues' }, 403);
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; force?: boolean; from?: string };
  try {
    if (body.action === 'status') return json({ configured: !!authHeaders(), env: envName(), sync: await syncRow(db).catch(() => null) });
    if (body.action === 'users') {
      const users = await allUsers();
      return json({ users: users.map((u) => ({ id: u._id, name: fullName(u), email: u.email ?? null })) });
    }
    if (body.action === 'sync') return await sync(db, body.force === true, body.from);
    if (body.action === 'inspect') return json(await inspect());
    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof FvError ? 502 : 500);
  }
}

if (!Deno.env.get('VIZZIO_FOURVENUES_TEST')) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  Deno.serve((req) => handler(req, db));
}

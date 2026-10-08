// =====================================================================
//  Sincronización con Fourvenues (Integrations API) de Vizzio
//
//  Trae de Fourvenues, para las noches de los últimos días y las próximas:
//  · Noches: cada evento crea su noche en public.events (o se asocia a la
//    que ya hubiera ese día sin evento de Fourvenues).
//  · Entradas de cada noche: vendidas (de pago, cualquier canal), QR gratis
//    (invitaciones o 0 €) y cuántas personas han entrado. No se apunta ningún
//    ingreso en Finanzas: la venta la mete el administrador a mano.
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
  /** RRPP que la ha vendido (usuario de Fourvenues) */
  referral_id?: string | null;
}

export interface FvUser {
  _id: string;
  name?: string;
  last_name?: string;
  email?: string;
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

const statuses = (t: FvTicket) => (Array.isArray(t.status) ? t.status : t.status ? [t.status] : []);
/** Canceladas o sin terminar de rellenar (SMS) no cuentan */
const isValid = (t: FvTicket) => !statuses(t).some((s) => s === 'cancelled' || s === 'filling_client');
const people = (t: FvTicket) => Math.max(1, Math.round(num(t.for ?? 1)));
/** Lo que se queda el local: lo pagado sin gastos de gestión ni devoluciones */
export const netAmount = (t: FvTicket) => round2(Math.max(0, num(t.total_paid ?? t.price) - num(t.total_fees) - num(t.refunded)));

export interface Sales {
  people: number;
  revenue: number;
}

export interface TicketSummary {
  /** Personas con entrada (cualquier tipo, sin canceladas ni devueltas del todo) */
  people: number;
  /** De ellas: con entrada de pago (cualquier canal) y con QR gratis / invitación */
  paid: number;
  free: number;
  /** Personas que ya han entrado */
  entered: number;
  /** Venta online: personas e importe */
  sold: number;
  revenue: number;
  /** Venta online de cada RRPP (por su usuario de Fourvenues) */
  byReferral: Map<string, Sales>;
}

export function summarize(tickets: FvTicket[]): TicketSummary {
  const out: TicketSummary = { people: 0, paid: 0, free: 0, entered: 0, sold: 0, revenue: 0, byReferral: new Map() };
  for (const t of tickets) {
    if (!isValid(t)) continue;
    const net = netAmount(t);
    if (num(t.refunded) > 0 && net === 0) continue; // devuelta del todo
    const p = people(t);
    out.people += p;
    out.entered += Math.min(p, Math.max(0, Math.round(num(t.enter))));
    // QR gratis: invitaciones o entradas de 0 €
    if (t.sale_type === 'invitation' || num(t.total_paid ?? t.price) <= 0) out.free += p;
    else out.paid += p;
    if (NOT_ONLINE_SALES.has(t.sale_type ?? '') || net <= 0) continue;
    out.sold += p;
    out.revenue += net;
    if (t.referral_id) {
      const r = out.byReferral.get(t.referral_id) ?? { people: 0, revenue: 0 };
      r.people += p;
      r.revenue += net;
      out.byReferral.set(t.referral_id, r);
    }
  }
  out.revenue = round2(out.revenue);
  for (const r of out.byReferral.values()) r.revenue = round2(r.revenue);
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

/** Todas las entradas de un evento (de 500 en 500) */
async function eventTickets(eventId: string): Promise<FvTicket[]> {
  const byId = new Map<string, FvTicket>();
  let previousFirst: string | undefined;
  for (let offset = 0; offset < 100_000; offset += TICKETS_PAGE) {
    const page = (await fv<FvTicket[]>('/tickets/', { event_id: eventId, limit: String(TICKETS_PAGE), offset: String(offset) })) ?? [];
    // Si la API ignorase el desplazamiento, devolvería la misma página: se para
    if (!page.length || page[0]._id === previousFirst) break;
    previousFirst = page[0]._id;
    for (const t of page) byId.set(t._id, t);
    if (page.length < TICKETS_PAGE) break;
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
  /** Entradas vendidas y QR gratis de la ventana */
  paid: number;
  free: number;
  /** Venta online (para las comisiones de los RRPP) */
  tickets: number;
  revenue: number;
  /** Filas de entradas de RRPP escritas y RRPP asociados por email en esta sincronización */
  rrpp: number;
  rrppLinked: number;
  /** RRPP de Fourvenues con ventas que no están asociados a ninguna ficha */
  unmatched: { id: string; name: string | null; email: string | null; tickets: number; revenue: number }[];
  warnings: string[];
}

const check = <T,>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

const fullName = (u: FvUser) => [u.name, u.last_name].filter(Boolean).join(' ').trim() || null;

export async function runSync(db: SupabaseClient, from: string, to: string): Promise<SyncResult> {
  const now = new Date().toISOString();
  const result: SyncResult = { from, to, events: 0, created: 0, linked: 0, moved: 0, paid: 0, free: 0, tickets: 0, revenue: 0, rrpp: 0, rrppLinked: 0, unmatched: [], warnings: [] };

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
  for (const { fvId, local } of synced) {
    const s = summarize(await eventTickets(fvId));
    result.paid += s.paid;
    result.free += s.free;
    result.tickets += s.sold;
    result.revenue = round2(result.revenue + s.revenue);

    check(
      await db
        .from('events')
        .update({ tickets_sold: s.people, tickets_paid: s.paid, tickets_free: s.free, tickets_entered: s.entered, fourvenues_synced_at: now })
        .eq('id', local.id),
      'Noches',
    );

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

  let users = new Map<string, FvUser>();
  const missing = [...referrals.keys()].filter((id) => !byFvUser.has(id));
  if (missing.length) {
    try {
      users = new Map(((await fv<FvUser[]>('/users/')) ?? []).map((u) => [u._id, u]));
    } catch (e) {
      if (!(e instanceof FvError)) throw e;
      result.warnings.push(`${e.message} Asocia los RRPP a mano en Ajustes.`);
    }
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
    .map(([id, v]) => ({ id, name: users.has(id) ? fullName(users.get(id)!) : null, email: users.get(id)?.email ?? null, tickets: v.people, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

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
//  Servidor
// ---------------------------------------------------------------------

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

  // Sólo administradores con sesión en la app
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!auth?.user) return json({ error: 'Inicia sesión en la app' }, 401);
  const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
  if (profile?.role !== 'admin') return json({ error: 'Sólo los administradores pueden usar la integración con Fourvenues' }, 403);

  const body = (await req.json().catch(() => ({}))) as { action?: string; force?: boolean; from?: string };
  try {
    if (body.action === 'status') return json({ configured: !!authHeaders(), env: envName(), sync: await syncRow(db).catch(() => null) });
    if (body.action === 'users') {
      const users = (await fv<FvUser[]>('/users/')) ?? [];
      return json({ users: users.map((u) => ({ id: u._id, name: fullName(u), email: u.email ?? null })) });
    }
    if (body.action === 'sync') return await sync(db, body.force === true, body.from);
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

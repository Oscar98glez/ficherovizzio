// =====================================================================
//  Notificaciones al móvil (Web Push) de Vizzio
//
//  · La base de datos apunta en public.notifications cada aviso para un
//    trabajador (turno asignado, cambiado o cancelado; mensaje o tarea nueva;
//    respuesta del administrador) o para un administrador (respuesta de un trabajador).
//  · La app llama a esta función justo después de hacer esos cambios y ella
//    envía los avisos pendientes a los dispositivos de cada trabajador
//    (public.push_subscriptions). Si alguien tiene varios avisos a la vez, le
//    llega uno solo con el resumen.
//  · Claves VAPID: se generan la primera vez y se guardan en public.push_keys
//    (sólo esta función, con la clave de servicio, puede leerlas).
//
//  Peticiones (POST, con la sesión del usuario de la app):
//    { "action": "public_key" } → { publicKey } para suscribir el dispositivo
//    { "action": "send" }       → envía los avisos pendientes
//    { "action": "test" }       → aviso de prueba a los dispositivos de quien llama
//
//  Despliegue: .github/workflows/deploy-functions.yml (al cambiar en main);
//  a mano: `supabase functions deploy notify --no-verify-jwt`.
//  La sesión se comprueba aquí dentro (funciona con las claves nuevas y las antiguas).
// =====================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

/** Avisos que se envían; los más antiguos se descartan sin enviar */
const MAX_AGE_MS = 48 * 3600_000;
/** Las noches van de 06:00 a 06:00 (hora de Madrid) */
const NIGHT_OFFSET_MS = 6 * 3600_000;
const TZ = 'Europe/Madrid';

interface Notification {
  id: string;
  /** Para un trabajador... */
  employee_id: string | null;
  /** ...o directamente para un usuario (administradores) */
  user_id: string | null;
  kind: 'shift_new' | 'shift_changed' | 'shift_cancelled' | 'message' | 'task' | 'reply' | 'reservation_new';
  ref_id: string | null;
  data: Record<string, string | null>;
  created_at: string;
}

interface Keys {
  public_key: string;
  private_key: string;
}

interface Payload {
  title: string;
  body: string;
  url: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------------------------------------------------------------------
//  Textos
// ---------------------------------------------------------------------

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Vie 9 oct": la noche a la que pertenece el turno */
export function nightLabel(iso: string) {
  const d = new Date(Date.parse(iso) - NIGHT_OFFSET_MS);
  const s = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return capitalize(s.replace(/\./g, '').replace(',', ''));
}

/** "23:30" en hora de Madrid */
export function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** "vie 9 oct" para una fecha AAAA-MM-DD (va en mitad de la frase) */
function dateLabel(date: string) {
  const s = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`));
  return s.replace(/\./g, '').replace(',', '');
}

/** Respuesta escrita por la administración (el dato llega como booleano del JSON) */
const fromAdmin = (n: Pick<Notification, 'data'>) => (n.data as Record<string, unknown> | null)?.from_admin === true;

/** Título y texto de un aviso suelto */
export function describe(n: Pick<Notification, 'kind' | 'data'>): { title: string; body: string } {
  const d = n.data ?? {};
  switch (n.kind) {
    case 'shift_new':
      return { title: 'Nuevo turno', body: `${nightLabel(d.start_at!)} · desde las ${timeLabel(d.start_at!)}` };
    case 'shift_changed':
      return { title: 'Turno cambiado', body: `${nightLabel(d.start_at!)} · ahora desde las ${timeLabel(d.start_at!)}` };
    case 'shift_cancelled':
      return { title: 'Turno cancelado', body: `${nightLabel(d.start_at!)} · ${timeLabel(d.start_at!)}` };
    case 'task':
      return { title: 'Nueva tarea', body: `${d.title ?? ''}${d.due_date ? ` · hasta el ${dateLabel(d.due_date)}` : ''}` };
    case 'reservation_new': {
      // A los camareros de bandeja: noche, reservado, personas, hora y cliente
      const guests = Number(d.guests ?? 0);
      const parts = [
        d.date ? dateLabel(d.date) : null,
        d.table || 'sin reservado asignado',
        guests ? `${guests} pers.` : null,
        d.arrival ? `llegada ${d.arrival}` : null,
        d.customer,
      ];
      return { title: 'Nuevo reservado', body: parts.filter(Boolean).join(' · ').slice(0, 180) };
    }
    case 'reply':
      return fromAdmin(n)
        ? { title: `Respuesta a «${d.title ?? ''}»`, body: (d.body ?? '').slice(0, 180) }
        : { title: `${d.from ?? 'Un trabajador'} ha respondido`, body: `«${d.title ?? ''}»: ${d.body ?? ''}`.slice(0, 180) };
    default:
      return { title: 'Nuevo mensaje', body: `${d.title ?? ''}${d.body ? ` · ${d.body}` : ''}`.slice(0, 180) };
  }
}

/** Un solo aviso por persona: el suyo o un resumen si tiene varios */
export function payloadFor(list: Pick<Notification, 'kind' | 'data'>[]): Payload {
  const isMessage = (n: Pick<Notification, 'kind'>) => n.kind === 'message' || n.kind === 'task' || n.kind === 'reply';
  // Las respuestas de los trabajadores van a los administradores: se abren en Mensajes del panel
  const toAdmin = list.every((n) => n.kind === 'reply' && !fromAdmin(n));
  const url = toAdmin
    ? list.length === 1 && list[0].data?.message_id ? `/mensajes?m=${list[0].data.message_id}` : '/mensajes'
    : list.every((n) => n.kind === 'reservation_new')
      ? list.length === 1 && list[0].data?.date ? `/reservados?d=${list[0].data.date}` : '/reservados'
      : list.some(isMessage) ? '/mis-mensajes' : '/mis-turnos';
  if (list.length === 1) return { ...describe(list[0]), url };
  const lines = list.map((n) => {
    const { title, body } = describe(n);
    return `${title}: ${body}`;
  });
  const extra = lines.length > 4 ? `\n…y ${lines.length - 4} más` : '';
  return { title: `Tienes ${list.length} novedades`, body: lines.slice(0, 4).join('\n') + extra, url };
}

// ---------------------------------------------------------------------
//  Claves VAPID
// ---------------------------------------------------------------------

async function ensureKeys(db: SupabaseClient): Promise<Keys> {
  const read = async () => {
    const { data, error } = await db.from('push_keys').select('public_key, private_key').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    return data as Keys | null;
  };
  const existing = await read();
  if (existing) return existing;
  const k = webpush.generateVAPIDKeys();
  // Si dos peticiones las generan a la vez, se queda la primera
  const { error } = await db
    .from('push_keys')
    .upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return (await read())!;
}

// ---------------------------------------------------------------------
//  Envío
// ---------------------------------------------------------------------

async function sendPending(db: SupabaseClient, keys: Keys, subject: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_AGE_MS).toISOString();

  // Los muy antiguos ya no tienen sentido: se marcan sin enviar
  await db.from('notifications').update({ sent_at: now.toISOString() }).is('sent_at', null).lt('created_at', cutoff);

  // Se "reservan" los pendientes; si otra llamada los ha cogido ya, no se repiten
  const { data, error } = await db
    .from('notifications')
    .update({ sent_at: now.toISOString() })
    .is('sent_at', null)
    .gte('created_at', cutoff)
    .select('id, employee_id, user_id, kind, ref_id, data, created_at');
  if (error) throw new Error(error.message);
  const pending = ((data ?? []) as Notification[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!pending.length) return { notifications: 0, sent: 0, failed: 0, removed: 0 };

  // Cada aviso va al usuario de la app: el del trabajador o el indicado directamente
  const employeeIds = [...new Set(pending.map((n) => n.employee_id).filter((x): x is string => !!x))];
  const { data: emps } = employeeIds.length ? await db.from('employees').select('id, user_id').in('id', employeeIds) : { data: [] };
  const userOf = new Map((emps ?? []).filter((e) => e.user_id).map((e) => [e.id as string, e.user_id as string]));
  const byUser = new Map<string, Notification[]>();
  for (const n of pending) {
    const userId = n.user_id ?? (n.employee_id ? userOf.get(n.employee_id) : undefined);
    if (userId) byUser.set(userId, [...(byUser.get(userId) ?? []), n]);
  }
  if (!byUser.size) return { notifications: pending.length, sent: 0, failed: 0, removed: 0 };
  const { data: subs } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', [...byUser.keys()]);

  const options = { vapidDetails: { subject, publicKey: keys.public_key, privateKey: keys.private_key }, TTL: 24 * 3600, urgency: 'high' as const };
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];

  const jobs: Promise<void>[] = [];
  for (const [userId, list] of byUser) {
    const devices = (subs ?? []).filter((s) => s.user_id === userId);
    if (!devices.length) continue;
    const body = JSON.stringify(payloadFor(list));
    for (const s of devices) {
      jobs.push(
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options)
          .then(() => void sent++)
          .catch((e: { statusCode?: number; body?: string; message?: string }) => {
            failed++;
            // 404 / 410: el dispositivo ya no existe (se desinstaló o se quitaron los permisos)
            if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.id);
            else console.error('push', e.statusCode, e.body ?? e.message);
          }),
      );
    }
  }
  await Promise.all(jobs);
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
  return { notifications: pending.length, sent, failed, removed: gone.length };
}

/** Aviso de prueba a los dispositivos del usuario que lo pide */
async function sendTest(db: SupabaseClient, keys: Keys, subject: string, userId: string) {
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  const body = JSON.stringify({ title: 'Notificaciones activadas', body: 'Así te avisaremos de las novedades en la app.', url: '/' });
  const options = { vapidDetails: { subject, publicKey: keys.public_key, privateKey: keys.private_key }, TTL: 600, urgency: 'high' as const };
  let sent = 0;
  const gone: string[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.id);
      else console.error('push test', status, (e as { body?: string }).body);
    }
  }
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
  return { devices: subs?.length ?? 0, sent };
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

/** Contacto que exige el estándar Web Push: la web de la app o un email */
function subjectFor(req: Request) {
  const custom = Deno.env.get('PUSH_SUBJECT');
  if (custom) return custom;
  const origin = req.headers.get('origin');
  return origin?.startsWith('https://') ? origin : 'mailto:notificaciones@vizzio.app';
}

async function handler(req: Request, db: SupabaseClient | null) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!db) return json({ error: 'Falta la configuración de Supabase en la función' }, 500);

  // Sólo usuarios con sesión en la app
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!auth?.user) return json({ error: 'Inicia sesión en la app' }, 401);

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    const keys = await ensureKeys(db);
    if (action === 'public_key') return json({ publicKey: keys.public_key });
    if (action === 'test') return json(await sendTest(db, keys, subjectFor(req), auth.user.id));
    return json(await sendPending(db, keys, subjectFor(req)));
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

if (!Deno.env.get('VIZZIO_NOTIFY_TEST')) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  Deno.serve((req) => handler(req, db));
}

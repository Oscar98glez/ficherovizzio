// Notificaciones al móvil (Web Push): activar/desactivar en este dispositivo y avisar al
// servidor para que envíe los avisos pendientes (supabase/functions/notify).
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { supabase } from './supabase';

export const NOTIFY_FUNCTION = 'notify';

export type PushState =
  /** El navegador no las admite (o modo demo) */
  | 'unsupported'
  /** iPhone/iPad: sólo funcionan con la app añadida a la pantalla de inicio */
  | 'needs-install'
  /** Bloqueadas en los ajustes del navegador */
  | 'denied'
  | 'off'
  | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Registra el service worker que recibe las notificaciones (no guarda nada en caché) */
export function registerServiceWorker() {
  if (IS_DEMO || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* sin service worker la app funciona igual, sólo sin notificaciones */
  });
}

async function registration() {
  registerServiceWorker();
  return navigator.serviceWorker.ready;
}

export async function pushState(): Promise<PushState> {
  if (IS_DEMO) return 'unsupported';
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('No disponible en el modo demo');
  const { data, error } = await supabase.functions.invoke(NOTIFY_FUNCTION, { body });
  if (error) {
    // El mensaje de la función viene en el cuerpo de la respuesta
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

const toBytes = (base64url: string) => {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) => {
  const x = a ? new Uint8Array(a) : null;
  return !!x && x.length === b.length && x.every((v, i) => v === b[i]);
};

/** Pide permiso y suscribe este dispositivo. Debe llamarse al pulsar un botón. */
export async function enablePush(): Promise<PushState> {
  if (IS_DEMO) return 'unsupported';
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  // Safari (iPhone) sólo muestra la petición de permiso si es lo primero que se hace al pulsar el botón
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await registration();
  const { publicKey } = await invoke<{ publicKey: string }>({ action: 'public_key' });
  const key = toBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Si el dispositivo estaba suscrito con otras claves, se vuelve a suscribir
  if (sub && !sameBytes(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  const json = sub.toJSON();
  const { error } = await supabase!.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase?.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return 'off';
}

/** Aviso de prueba a los dispositivos de este usuario */
export const testPush = () => invoke<{ devices: number; sent: number }>({ action: 'test' });

// ---------- Envío de los avisos pendientes ----------
//  Los avisos los apunta la base de datos; esta función le pide al servidor que los mande.
//  · Se llama justo después de cada cambio (reservado, pedido, turno, mensaje...).
//  · Va con "keepalive": aunque se cierre la app o se bloquee el móvil justo después de
//    guardar, la petición sale igual.
//  · Si falla (sin cobertura, servidor ocupado), se reintenta unas cuantas veces.
//  · Además, cada vez que alguien abre la app o vuelve a ella se mandan los que se
//    hubieran quedado pendientes.

/** Sesión actual (se guarda aquí para poder enviar al instante al cerrar la app) */
let accessToken: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
const RETRY_MS = [3000, 10000, 30000, 90000];

function sendNow(keepalive: boolean): Promise<void> {
  pending = false;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return Promise.resolve();
  const request = (k: boolean) =>
    fetch(`${SUPABASE_URL}/functions/v1/${NOTIFY_FUNCTION}`, {
      method: 'POST',
      keepalive: k,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY! },
      body: JSON.stringify({ action: 'send' }),
    });
  // Algún navegador no admite "keepalive" en esta petición: entonces va normal
  return (keepalive ? request(true).catch(() => request(false)) : request(false)).then((res) => {
    if (!res.ok) throw new Error(`notify ${res.status}`);
  });
}

/** Envía ya; si falla, lo vuelve a intentar al rato */
function flush(attempt = 0, keepalive = false) {
  clearTimeout(timer);
  sendNow(keepalive).catch(() => {
    if (attempt >= RETRY_MS.length) return;
    pending = true;
    timer = setTimeout(() => flush(attempt + 1), RETRY_MS[attempt]);
  });
}

/** Pide al servidor que envíe los avisos pendientes. Los cambios seguidos van en un solo envío. */
export function kickNotifications() {
  if (IS_DEMO || !supabase) return;
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(() => flush(), 400);
}

if (!IS_DEMO && supabase && typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((_event, session) => {
    const had = !!accessToken;
    accessToken = session?.access_token ?? null;
    // Al abrir la app con sesión: lo que hubiera quedado pendiente
    if (accessToken && !had) kickNotifications();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Se va a segundo plano con un envío a punto de salir: sale ya
      if (pending) flush(0, true);
    } else if (accessToken) kickNotifications();
  });
  window.addEventListener('pagehide', () => pending && flush(0, true));
}

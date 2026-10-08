// Integración con Fourvenues: la app sólo habla con la función de Supabase
// (supabase/functions/fourvenues-sync), que es la que tiene la clave de la API.
import { IS_DEMO } from './config';
import { supabase } from './supabase';
import type { FourvenuesResult, FourvenuesSync, FourvenuesUser } from './types';

export const FOURVENUES_FUNCTION = 'fourvenues-sync';

/** Prefijo de los movimientos que crea la sincronización */
export const isFourvenuesTx = (t: { external_id?: string | null }) => !!t.external_id?.startsWith('fourvenues:');

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('No disponible en el modo demo');
  const { data, error } = await supabase.functions.invoke(FOURVENUES_FUNCTION, { body });
  if (error) {
    // El mensaje de la función viene en el cuerpo de la respuesta
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    if (detail?.error) throw new Error(detail.error);
    if (/Failed to send a request|404|not found/i.test(error.message))
      throw new Error('La función fourvenues-sync no está publicada en Supabase todavía.');
    throw new Error(error.message);
  }
  return data as T;
}

export interface FourvenuesStatus {
  /** Hay clave guardada en los secretos de la función */
  configured: boolean;
  env: 'production' | 'alpha';
  sync: FourvenuesSync | null;
}

export const fourvenuesStatus = () => invoke<FourvenuesStatus>({ action: 'status' });

export const fourvenuesUsers = async () => (await invoke<{ users: FourvenuesUser[] }>({ action: 'users' })).users;

export interface SyncResponse {
  /** No se ha hecho porque se hizo hace poco (o hay otra en curso) */
  skipped?: boolean;
  running?: boolean;
  result?: FourvenuesResult;
  sync: FourvenuesSync | null;
}

/** Sincroniza ya (botón). `from` (AAAA-MM-DD) trae también noches más antiguas. */
export const syncFourvenues = (from?: string) => invoke<SyncResponse>({ action: 'sync', force: true, from });

/**
 * Sincronización automática al abrir Noches: el servidor no la repite si se hizo hace
 * menos de 10 minutos. Devuelve true si se ha sincronizado (para recargar la página).
 * Si falla o no hay clave, no molesta: el error se ve en Ajustes.
 */
let autoRunning: Promise<boolean> | null = null;
export function autoSyncFourvenues(): Promise<boolean> {
  if (IS_DEMO || !supabase) return Promise.resolve(false);
  autoRunning ??= invoke<SyncResponse>({ action: 'sync' })
    .then((r) => !!r.result?.events)
    .catch(() => false)
    .finally(() => setTimeout(() => (autoRunning = null), 60_000));
  return autoRunning;
}

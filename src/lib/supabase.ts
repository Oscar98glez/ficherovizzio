import { createClient } from '@supabase/supabase-js';
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

// Se mira antes de crear el cliente, porque al leer el enlace lo borra de la barra de direcciones
const authParams = typeof window === 'undefined' ? '' : `${window.location.hash}&${window.location.search}`;
/** Se ha abierto la app desde el email de "He olvidado la contraseña" */
export const OPENED_FROM_RECOVERY_LINK = /type=recovery/.test(authParams);
/** El enlace del email ha caducado o ya se usó (Supabase lo indica en la dirección) */
export const AUTH_LINK_ERROR = /error_code=otp_expired|error=access_denied/.test(authParams);

export const supabase = IS_DEMO
  ? null
  : createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

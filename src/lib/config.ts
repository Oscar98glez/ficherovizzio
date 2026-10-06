export const APP_NAME: string = import.meta.env.VITE_APP_NAME || 'Vizzio';
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Sin credenciales de Supabase la app funciona en modo demo con datos locales. */
/** Nombre de la función de Supabase del conector de Claude (supabase/functions/rapid-responder) */
export const CLAUDE_FUNCTION = 'rapid-responder';

export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Una "noche" de trabajo va de 06:00 a 06:00: una entrada a las 02:00 cuenta para la noche anterior. */
export const BUSINESS_DAY_OFFSET_HOURS = 6;

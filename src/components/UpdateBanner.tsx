import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const BUNDLE = /\/assets\/index-[^"']+\.js/;

/**
 * Avisa cuando se ha publicado una versión nueva de la app mientras estaba abierta
 * (compara el archivo principal publicado con el que se está ejecutando).
 */
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const current = [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) => s.src).find((src) => BUNDLE.test(src));
    if (!current) return; // en desarrollo no hay archivo empaquetado
    let stopped = false;
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const published = html.match(BUNDLE)?.[0];
        if (!stopped && published && !current.endsWith(published)) setAvailable(true);
      } catch {
        /* sin conexión: se vuelve a intentar más tarde */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && check();
    const id = setInterval(check, 5 * 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!available) return null;
  return (
    <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+10px)] z-[60] flex justify-center px-4">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="glass flex items-center gap-2.5 rounded-full border border-line py-2 pl-4 pr-2 text-[14px] font-medium shadow-pop"
      >
        Hay una versión nueva de la app
        <span className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[13px] font-semibold text-on-accent">
          <RefreshCw className="h-3.5 w-3.5" /> Actualizar
        </span>
      </button>
    </div>
  );
}

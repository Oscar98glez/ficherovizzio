import { useEffect, useState } from 'react';
import { Bell, BellOff, Share, X } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push';
import { useFeedback } from './overlay';
import { Button, Card, CardHeader } from './ui';

const HELP: Partial<Record<PushState, string>> = {
  'needs-install':
    'En iPhone, las notificaciones sólo funcionan con Vizzio en la pantalla de inicio: en Safari pulsa Compartir y luego "Añadir a pantalla de inicio", abre la app desde ese icono y actívalas aquí.',
  denied: 'Las has bloqueado para esta app. Para activarlas, permite las notificaciones de Vizzio en los ajustes del móvil o del navegador.',
  unsupported: 'Este navegador no admite notificaciones. Prueba desde el móvil con Chrome (Android) o con la app en la pantalla de inicio (iPhone).',
};

function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return [state, setState] as const;
}

/** Tarjeta del Perfil para activar o desactivar las notificaciones en este dispositivo */
export function NotificationsCard({ admin = false }: { admin?: boolean }) {
  const what = admin
    ? 'cuando un trabajador responda a un mensaje o una tarea'
    : 'cuando te asignen o cambien un turno y cuando te llegue un mensaje, una tarea o una respuesta';
  const { toast } = useFeedback();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<PushState>, ok?: string) {
    setBusy(true);
    try {
      const s = await fn();
      setState(s);
      if (s === 'on' && ok) toast.success(ok);
      if (s === 'denied') toast.error('Has bloqueado las notificaciones');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await testPush();
      if (r.sent) toast.success('Aviso de prueba enviado');
      else toast.error('No se ha podido enviar a este dispositivo. Desactívalas y vuelve a activarlas.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  return (
    <Card>
      <CardHeader title="Notificaciones" />
      <div className="px-5 pb-5">
        <p className="text-[14px] text-ink-2">
          {state === 'on' ? `Activadas en este dispositivo: te avisaremos ${what}.` : HELP[state] ?? `Recibe un aviso en el móvil ${what}.`}
        </p>
        {(state === 'on' || state === 'off') && (
          <div className="mt-3 flex flex-wrap gap-2">
            {state === 'on' ? (
              <>
                <Button variant="secondary" size="sm" icon={<Bell />} loading={busy} onClick={test}>
                  Enviar aviso de prueba
                </Button>
                <Button variant="ghost" size="sm" icon={<BellOff />} disabled={busy} onClick={() => run(disablePush)}>
                  Desactivar
                </Button>
              </>
            ) : (
              <Button size="sm" icon={<Bell />} loading={busy} onClick={() => run(enablePush, 'Notificaciones activadas')}>
                Activar notificaciones
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

const DISMISS_KEY = 'vizzio.push.prompt-dismissed';

/** Aviso en la parte de arriba para que el trabajador active las notificaciones (se puede cerrar) */
export function PushPrompt() {
  const { toast } = useFeedback();
  const [state, setState] = usePushState();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);

  if (hidden || (state !== 'off' && state !== 'needs-install')) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sin almacenamiento */
    }
  };

  async function enable() {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === 'on') toast.success('Notificaciones activadas');
      else if (s === 'denied') toast.error('Has bloqueado las notificaciones. Puedes activarlas en los ajustes del móvil.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl bg-accent/10 px-4 py-3 text-[14px]">
      {state === 'needs-install' ? <Share className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
      <div className="min-w-0 flex-1">
        {state === 'needs-install' ? (
          <span>
            Para recibir avisos de tus turnos y mensajes, añade Vizzio a la pantalla de inicio (Safari → Compartir → «Añadir a pantalla de inicio») y ábrela desde ahí.
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Activa las notificaciones para enterarte de tus turnos, mensajes y tareas.</span>
            <Button size="sm" loading={busy} onClick={enable}>
              Activar
            </Button>
          </div>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Cerrar" className="text-ink-2 hover:text-ink">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

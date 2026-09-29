import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { cx } from '../lib/utils';
import { Spinner } from './ui';

// ---------- Modal / hoja inferior ----------

function useBodyLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Si se indica, el contenido es un formulario con "Cancelar" y botón de guardar en la cabecera. */
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  saving?: boolean;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, onSubmit, submitLabel = 'Guardar', saving, footer, wide }: ModalProps) {
  useBodyLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const header = (
    <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur-xl dark:bg-elevated/85">
      <div>
        {onSubmit && (
          <button type="button" onClick={onClose} className="text-[17px] text-accent hover:opacity-70">
            Cancelar
          </button>
        )}
      </div>
      <h2 className="truncate text-center text-[17px] font-semibold">{title}</h2>
      <div className="flex justify-end">
        {onSubmit ? (
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 text-[17px] font-semibold text-accent hover:opacity-70 disabled:opacity-40"
          >
            {saving && <Spinner className="h-4 w-4" />}
            {submitLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-7 w-7 place-items-center rounded-full bg-fill text-ink-2 hover:bg-fill-2"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );

  const body = (
    <>
      {header}
      <div className="px-5 py-5">{children}</div>
      {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
      <div className="h-[env(safe-area-inset-bottom)] sm:hidden" />
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative max-h-[94dvh] w-full overflow-y-auto overscroll-contain rounded-t-[22px] bg-surface shadow-pop dark:bg-elevated',
          'animate-sheet-in sm:max-h-[88vh] sm:animate-pop-in sm:rounded-[22px]',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        {onSubmit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!saving) onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Alertas de confirmación y avisos ----------

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface FeedbackCtx {
  confirm(opts: ConfirmOptions): Promise<boolean>;
  toast: { success(m: string): void; error(m: string): void; info(m: string): void };
}

const Ctx = createContext<FeedbackCtx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })),
    [],
  );

  const push = useCallback((message: string, tone: Toast['tone']) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const toast = useRef({
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error'),
    info: (m: string) => push(m, 'info'),
  }).current;

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ confirm, toast }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-[70] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="glass pointer-events-auto flex max-w-md animate-toast-in items-center gap-2.5 rounded-full px-4 py-2.5 text-[14px] font-medium shadow-pop dark:bg-elevated/85"
            >
              {t.tone === 'success' && <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-green" />}
              {t.tone === 'error' && <AlertCircle className="h-[18px] w-[18px] shrink-0 text-red" />}
              <span>{t.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
      {dialog &&
        createPortal(
          <div className="fixed inset-0 z-[60] grid place-items-center p-6">
            <div className="absolute inset-0 animate-fade-in bg-black/35" onClick={() => close(false)} />
            <div className="glass relative w-full max-w-[300px] animate-pop-in overflow-hidden rounded-[16px] text-center shadow-pop dark:bg-elevated/90">
              <div className="px-5 pb-4 pt-5">
                <h3 className="text-[17px] font-semibold">{dialog.title}</h3>
                {dialog.message && <p className="mt-1 text-[13px] text-ink-2">{dialog.message}</p>}
              </div>
              <div className="grid grid-cols-2 border-t border-line text-[17px]">
                <button className="h-11 border-r border-line text-accent hover:bg-fill" onClick={() => close(false)}>
                  Cancelar
                </button>
                <button
                  autoFocus
                  className={cx('h-11 font-semibold hover:bg-fill', dialog.destructive ? 'text-red' : 'text-accent')}
                  onClick={() => close(true)}
                >
                  {dialog.confirmLabel ?? 'Aceptar'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFeedback fuera de FeedbackProvider');
  return ctx;
}

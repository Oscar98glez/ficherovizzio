import { useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { fmtDate, fmtTime } from '../lib/format';
import type { MessageReply } from '../lib/types';
import { cx } from '../lib/utils';
import { useFeedback } from './overlay';
import { Button, Textarea } from './ui';

const when = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;

/**
 * Conversación de un destinatario con la administración. Las respuestas propias van a la
 * derecha. `asAdmin` indica desde qué lado se mira.
 */
export function ReplyThread({
  replies,
  asAdmin,
  otherName,
  onSend,
  placeholder = 'Escribe una respuesta…',
}: {
  replies: MessageReply[];
  asAdmin: boolean;
  /** Nombre del otro lado ("Lucía Martín" o "Administración") */
  otherName: string;
  onSend: (body: string) => Promise<void>;
  placeholder?: string;
}) {
  const { toast } = useFeedback();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = [...replies].sort((a, b) => a.created_at.localeCompare(b.created_at));

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  // Ctrl/Cmd + Enter envía (Enter solo hace salto de línea, cómodo en el móvil)
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <div className="space-y-1.5">
          {list.map((r) => {
            const mine = r.from_admin === asAdmin;
            return (
              <div key={r.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cx(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-[14px]',
                    mine ? 'rounded-br-md bg-accent/20' : 'rounded-bl-md bg-fill',
                  )}
                >
                  {!mine && <div className="mb-0.5 text-[11px] font-semibold text-ink-2">{otherName}</div>}
                  <div className="whitespace-pre-wrap break-words">{r.body}</div>
                  <div className="mt-0.5 text-right text-[11px] text-ink-3">
                    {when(r.created_at)}
                    {mine && r.read_at && ' · leído'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          maxLength={2000}
          placeholder={placeholder}
          className="min-h-[44px] flex-1"
        />
        <Button icon={<Send />} loading={sending} disabled={!text.trim()} onClick={send} className="shrink-0">
          Enviar
        </Button>
      </div>
    </div>
  );
}

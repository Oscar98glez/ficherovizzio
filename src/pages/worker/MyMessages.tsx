import { useState } from 'react';
import { Check, ClipboardList, MessageCircle, MessageSquare, X } from 'lucide-react';
import { useAuth } from '../../auth';
import { MESSAGES_CHANGED } from '../../components/AppShell';
import { Modal, useFeedback } from '../../components/overlay';
import { ReplyThread } from '../../components/ReplyThread';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, Segmented, Textarea } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { fmtDate, fmtTime } from '../../lib/format';
import type { Message, MessageRecipient, MessageReply, ShiftResponse } from '../../lib/types';
import { byId, cx, groupBy } from '../../lib/utils';
import { NotLinked } from './Clock';

type Item = MessageRecipient & { message: Message; replies: MessageReply[] };

/** Respuestas de la administración que aún no ha leído */
const unreadReplies = (i: Item) => i.replies.filter((r) => r.from_admin && !r.read_at).length;

const when = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
const dueLabel = (date: string) => fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' });

/** Pendiente: sin leer, tarea sin responder o con una respuesta nueva de la administración */
const isPending = (i: Item) => !i.read_at || (i.message.kind === 'task' && !i.response) || unreadReplies(i) > 0;

export default function MyMessages() {
  const { employee } = useAuth();
  const { toast } = useFeedback();
  const [tab, setTab] = useState<'all' | 'task'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<Item | null>(null);
  const [reason, setReason] = useState('');
  const [thread, setThread] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    if (!employee) return [];
    const rows = await api.messageRecipients.list({ eq: { employee_id: employee.id }, order: ['created_at', 'desc'], limit: 200 });
    const ids = rows.map((r) => r.id);
    const [messages, replies] = rows.length
      ? await Promise.all([
          api.messages.list({ in: ['id', rows.map((r) => r.message_id)] }).then(byId),
          // Si aún no está la migración de respuestas, los mensajes se ven igual
          api.messageReplies.list({ in: ['recipient_id', ids] }).catch(() => [] as MessageReply[]),
        ])
      : [new Map<string, Message>(), [] as MessageReply[]];
    const repliesOf = groupBy(replies, (r) => r.recipient_id);
    return rows
      .filter((r) => messages.has(r.message_id))
      .map((r) => ({ ...r, message: messages.get(r.message_id)!, replies: repliesOf[r.id] ?? [] }))
      .sort((a, b) => b.message.created_at.localeCompare(a.message.created_at));
  }, [employee?.id]);

  if (!employee) return <NotLinked />;

  const changed = () => window.dispatchEvent(new Event(MESSAGES_CHANGED));

  async function markRead(i: Item) {
    if (i.read_at) return;
    try {
      await api.markMessageRead(i.id);
      reload();
      changed();
    } catch {
      /* se volverá a marcar la próxima vez */
    }
  }

  /** Abre o cierra la conversación; al abrirla, lo nuevo queda leído */
  async function toggleThread(i: Item) {
    if (thread === i.id) return setThread(null);
    setThread(i.id);
    if (!i.read_at || unreadReplies(i)) {
      await Promise.all([i.read_at ? null : api.markMessageRead(i.id), unreadReplies(i) ? api.markRepliesRead(i.id) : null]).catch(() => {});
      reload();
      changed();
    }
  }

  async function sendReply(i: Item, body: string) {
    await api.replyMessage(i.id, body);
    reload();
    changed();
  }

  async function respond(i: Item, response: ShiftResponse, note?: string) {
    setBusy(i.id);
    try {
      await api.respondTask(i.id, response, note);
      toast.success(response === 'accepted' ? 'Tarea aceptada' : 'Tarea rechazada');
      setDeclining(null);
      reload();
      changed();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const items = (data ?? []).filter((i) => tab === 'all' || i.message.kind === 'task');
  const pendingTasks = (data ?? []).filter((i) => i.message.kind === 'task' && !i.response).length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Mensajes" subtitle="Avisos y tareas de tu responsable" />
      {pendingTasks > 0 && (
        <div className="mb-4 rounded-2xl bg-accent/10 px-4 py-3 text-[14px] text-accent">
          Tienes {pendingTasks === 1 ? '1 tarea' : `${pendingTasks} tareas`} sin responder. Dinos si te encargas.
        </div>
      )}
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'Todo' },
            { value: 'task', label: 'Tareas' },
          ]}
        />
      </div>

      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : items.length ? (
        <div className="space-y-3">
          {items.map((i) => {
            const m = i.message;
            const unread = !i.read_at;
            return (
              <Card key={i.id} className={cx('p-4', isPending(i) && 'ring-1 ring-accent/40')}>
                <div onClick={() => markRead(i)} className={cx(unread && 'cursor-pointer')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Sin leer" />}
                      <Badge tone={m.kind === 'task' ? 'orange' : 'blue'}>{m.kind === 'task' ? 'Tarea' : 'Mensaje'}</Badge>
                    </div>
                    <span className="shrink-0 text-[12px] text-ink-3">{when(m.created_at)}</span>
                  </div>
                  <h3 className={cx('mt-2 text-[16px]', unread ? 'font-bold' : 'font-semibold')}>{m.title}</h3>
                  {m.body && <p className="mt-1 whitespace-pre-wrap text-[14px] text-ink-2">{m.body}</p>}
                  {m.due_date && <p className="mt-1.5 text-[13px] font-medium text-orange">Hasta el {dueLabel(m.due_date)}</p>}
                  {unread && m.kind === 'message' && (
                    <Button size="sm" variant="tinted" icon={<Check />} className="mt-3" onClick={() => markRead(i)}>
                      Marcar como leído
                    </Button>
                  )}
                </div>

                {m.kind === 'task' && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                    {i.response ? (
                      <div className="min-w-0 text-[14px]">
                        <span className={cx('inline-flex items-center gap-1.5 font-semibold', i.response === 'accepted' ? 'text-green' : 'text-red')}>
                          {i.response === 'accepted' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                          {i.response === 'accepted' ? 'La has aceptado' : 'La has rechazado'}
                        </span>
                        {i.response_note && <div className="mt-0.5 text-[13px] text-ink-2">«{i.response_note}»</div>}
                      </div>
                    ) : (
                      <span className="text-[14px] font-medium">¿Te encargas?</span>
                    )}
                    <div className="flex gap-2">
                      {i.response !== 'declined' && (
                        <Button
                          size="sm"
                          variant="danger-tinted"
                          icon={<X />}
                          disabled={busy === i.id}
                          onClick={() => {
                            setReason('');
                            setDeclining(i);
                          }}
                        >
                          Rechazar
                        </Button>
                      )}
                      {i.response !== 'accepted' && (
                        <Button size="sm" variant="success" icon={<Check />} loading={busy === i.id} onClick={() => respond(i, 'accepted')}>
                          Aceptar
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-3 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => toggleThread(i)}
                    className="flex items-center gap-1.5 text-[14px] font-medium text-accent"
                  >
                    <MessageCircle className="h-4 w-4" />
                    {thread === i.id ? 'Ocultar conversación' : i.replies.length ? `Conversación (${i.replies.length})` : 'Responder'}
                    {unreadReplies(i) > 0 && thread !== i.id && <Badge tone="red">Nueva respuesta</Badge>}
                  </button>
                  {thread === i.id && (
                    <div className="mt-3">
                      <ReplyThread replies={i.replies} asAdmin={false} otherName="Administración" onSend={(body) => sendReply(i, body)} />
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={tab === 'task' ? <ClipboardList /> : <MessageSquare />}
            title={tab === 'task' ? 'Sin tareas' : 'Sin mensajes'}
            message="Cuando tu responsable te envíe algo, aparecerá aquí y te llegará un aviso al móvil."
          />
        </Card>
      )}

      <Modal
        open={!!declining}
        onClose={() => setDeclining(null)}
        title="Rechazar tarea"
        submitLabel="Enviar"
        saving={!!declining && busy === declining.id}
        onSubmit={async () => {
          if (declining) await respond(declining, 'declined', reason);
        }}
      >
        <div className="space-y-3">
          <p className="text-[14px] text-ink-2">Tu responsable verá que no puedes encargarte de «{declining?.message.title}».</p>
          <Field label="Motivo">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Opcional" maxLength={300} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

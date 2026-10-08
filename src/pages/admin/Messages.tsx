import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCheck, ClipboardList, HelpCircle, MessageSquare, Plus, Send, Trash2, X } from 'lucide-react';
import { Modal, useFeedback } from '../../components/overlay';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Segmented, Textarea } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { fmtDate, fmtTime } from '../../lib/format';
import type { Employee, Message, MessageKind, MessageRecipient, Role } from '../../lib/types';
import { byId, cx, fullName, groupBy, staffKind } from '../../lib/utils';

const KIND_LABEL: Record<MessageKind, string> = { message: 'Mensaje', task: 'Tarea' };
const GROUPS: { value: Role; label: string }[] = [
  { value: 'worker', label: 'Camareros' },
  { value: 'tech', label: 'DJ / Técnicos' },
  { value: 'rrpp', label: 'RRPP' },
];

const when = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;

type Staff = Employee & { kind: Role };

export default function Messages() {
  const [filter, setFilter] = useState<'all' | MessageKind>('all');
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [employees, profiles, messages] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.profiles.list(),
      api.messages.list({ order: ['created_at', 'desc'], limit: 200 }),
    ]);
    const recipients = messages.length ? await api.messageRecipients.list({ in: ['message_id', messages.map((m) => m.id)] }) : [];
    const roles = new Map(profiles.map((p) => [p.id, p.role]));
    const staff: Staff[] = employees.map((e) => ({ ...e, kind: staffKind(e, roles) })).filter((e) => e.kind !== 'admin');
    return { staff, messages, recipients };
  }, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const emps = byId(data.staff);
  const byMessage = groupBy(data.recipients, (r) => r.message_id);
  const list = data.messages.filter((m) => filter === 'all' || m.kind === filter);
  const open = openId ? data.messages.find((m) => m.id === openId) : null;

  return (
    <>
      <PageHeader
        title="Mensajes"
        subtitle="Avisos y tareas para el equipo"
        actions={
          <Button icon={<Plus />} onClick={() => setComposing(true)}>
            Nuevo mensaje
          </Button>
        }
      />

      <div className="mb-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'message', label: 'Mensajes' },
            { value: 'task', label: 'Tareas' },
          ]}
        />
      </div>

      {list.length ? (
        <div className="space-y-3">
          {list.map((m) => (
            <MessageCard key={m.id} message={m} recipients={byMessage[m.id] ?? []} onOpen={() => setOpenId(m.id)} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<MessageSquare />}
            title={data.messages.length ? 'Nada en este filtro' : 'Aún no has enviado mensajes'}
            message="Envía avisos o tareas a una persona, a un grupo o a todo el equipo. Les llegará una notificación al móvil."
            action={
              !data.messages.length && (
                <Button icon={<Plus />} onClick={() => setComposing(true)}>
                  Nuevo mensaje
                </Button>
              )
            }
          />
        </Card>
      )}

      <ComposeModal open={composing} onClose={() => setComposing(false)} staff={data.staff} onSent={reload} />
      <DetailModal
        message={open ?? null}
        recipients={open ? byMessage[open.id] ?? [] : []}
        emps={emps}
        onClose={() => setOpenId(null)}
        onDeleted={() => {
          setOpenId(null);
          reload();
        }}
      />
    </>
  );
}

/** Resumen de las respuestas: leídos, aceptadas, rechazadas y sin responder */
function stats(message: Message, recipients: MessageRecipient[]) {
  const read = recipients.filter((r) => r.read_at).length;
  const accepted = recipients.filter((r) => r.response === 'accepted').length;
  const declined = recipients.filter((r) => r.response === 'declined').length;
  return { total: recipients.length, read, accepted, declined, pending: message.kind === 'task' ? recipients.length - accepted - declined : 0 };
}

function MessageCard({ message: m, recipients, onOpen }: { message: Message; recipients: MessageRecipient[]; onOpen: () => void }) {
  const s = stats(m, recipients);
  return (
    <Card>
      <button onClick={onOpen} className="w-full p-4 text-left transition hover:bg-fill/40 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={m.kind === 'task' ? 'orange' : 'blue'}>{KIND_LABEL[m.kind]}</Badge>
              <span className="truncate text-[16px] font-semibold">{m.title}</span>
            </div>
            {m.body && <p className="mt-1 line-clamp-2 text-[14px] text-ink-2">{m.body}</p>}
          </div>
          <span className="shrink-0 text-[12px] text-ink-3">{when(m.created_at)}</span>
        </div>
        <div className="tabular mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
          <span>
            {s.total} {s.total === 1 ? 'persona' : 'personas'}
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCheck className="h-3.5 w-3.5" /> Leído {s.read}/{s.total}
          </span>
          {m.kind === 'task' && (
            <>
              <span className="inline-flex items-center gap-1 text-green">
                <Check className="h-3.5 w-3.5" /> {s.accepted}
              </span>
              <span className="inline-flex items-center gap-1 text-red">
                <X className="h-3.5 w-3.5" /> {s.declined}
              </span>
              {s.pending > 0 && (
                <span className="inline-flex items-center gap-1">
                  <HelpCircle className="h-3.5 w-3.5" /> {s.pending} sin responder
                </span>
              )}
              {m.due_date && <span>Hasta el {fmtDate(m.due_date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
            </>
          )}
        </div>
      </button>
    </Card>
  );
}

function DetailModal({
  message: m,
  recipients,
  emps,
  onClose,
  onDeleted,
}: {
  message: Message | null;
  recipients: MessageRecipient[];
  emps: Map<string, Staff>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { confirm, toast } = useFeedback();
  if (!m) return null;
  const s = stats(m, recipients);
  // Primero los que han rechazado, luego sin responder / sin leer, y al final los que han aceptado o leído
  const rank = (r: MessageRecipient) => (r.response === 'declined' ? 0 : m.kind === 'task' ? (r.response ? 2 : 1) : r.read_at ? 2 : 1);
  const rows = [...recipients].sort((a, b) => rank(a) - rank(b) || fullName(emps.get(a.employee_id)).localeCompare(fullName(emps.get(b.employee_id))));

  async function remove() {
    if (!m) return;
    const ok = await confirm({
      title: `¿Eliminar ${m.kind === 'task' ? 'esta tarea' : 'este mensaje'}?`,
      message: 'Desaparecerá también de la app de los trabajadores.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.messages.remove(m.id);
      toast.success('Eliminado');
      onDeleted();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={KIND_LABEL[m.kind]}
      wide
      footer={
        <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={remove}>
          Eliminar
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <h3 className="text-[18px] font-semibold">{m.title}</h3>
          <p className="mt-0.5 text-[13px] text-ink-3">
            Enviado el {when(m.created_at)}
            {m.due_date && ` · hasta el ${fmtDate(m.due_date, { weekday: 'long', day: 'numeric', month: 'long' })}`}
          </p>
          {m.body && <p className="mt-2 whitespace-pre-wrap text-[15px]">{m.body}</p>}
        </div>

        <div className="tabular grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-fill/60 py-2">
            <div className="text-[18px] font-semibold">
              {s.read}/{s.total}
            </div>
            <div className="text-[12px] text-ink-2">Leído</div>
          </div>
          {m.kind === 'task' ? (
            <>
              <div className="rounded-xl bg-green/10 py-2">
                <div className="text-[18px] font-semibold text-green">{s.accepted}</div>
                <div className="text-[12px] text-ink-2">Aceptada</div>
              </div>
              <div className="rounded-xl bg-red/10 py-2">
                <div className="text-[18px] font-semibold text-red">{s.declined}</div>
                <div className="text-[12px] text-ink-2">Rechazada</div>
              </div>
            </>
          ) : (
            <div className="col-span-2 rounded-xl bg-fill/60 py-2">
              <div className="text-[18px] font-semibold">{s.total - s.read}</div>
              <div className="text-[12px] text-ink-2">Sin leer</div>
            </div>
          )}
        </div>

        <div className="divide-y divide-line overflow-hidden rounded-xl bg-fill/40">
          {rows.map((r) => {
            const e = emps.get(r.employee_id);
            return (
              <div key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                <Avatar name={fullName(e)} color={e?.color} src={e?.photo_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{fullName(e) || 'Empleado eliminado'}</div>
                  {r.response_note && <div className="text-[13px] text-ink-2">«{r.response_note}»</div>}
                  {e && !e.user_id && <div className="text-[12px] text-orange">Sin cuenta en la app: no puede verlo</div>}
                </div>
                <div className="shrink-0 text-right text-[12px]">
                  {m.kind === 'task' && r.response ? (
                    <span className={cx('inline-flex items-center gap-1 font-semibold', r.response === 'accepted' ? 'text-green' : 'text-red')}>
                      {r.response === 'accepted' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      {r.response === 'accepted' ? 'Aceptada' : 'Rechazada'}
                    </span>
                  ) : (
                    <span className={cx('font-medium', r.read_at ? 'text-ink-2' : 'text-ink-3')}>
                      {r.read_at ? (m.kind === 'task' ? 'Leída, sin responder' : 'Leído') : 'Sin leer'}
                    </span>
                  )}
                  {(r.responded_at || r.read_at) && <div className="text-ink-3">{when((r.responded_at ?? r.read_at)!)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function ComposeModal({ open, onClose, staff, onSent }: { open: boolean; onClose: () => void; staff: Staff[]; onSent: () => void }) {
  const { toast } = useFeedback();
  const active = useMemo(() => staff.filter((e) => e.active), [staff]);
  const empty = { kind: 'message' as MessageKind, title: '', body: '', due: '', selected: new Set<string>() };
  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setF({ ...empty, selected: new Set() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) =>
    setF((s) => {
      const selected = new Set(s.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...s, selected };
    });
  const group = (kind: Role | 'all') => active.filter((e) => kind === 'all' || e.kind === kind).map((e) => e.id);
  const groupOn = (ids: string[]) => ids.length > 0 && ids.every((id) => f.selected.has(id));
  const toggleGroup = (ids: string[]) =>
    setF((s) => {
      const selected = new Set(s.selected);
      const on = ids.every((id) => selected.has(id));
      ids.forEach((id) => (on ? selected.delete(id) : selected.add(id)));
      return { ...s, selected };
    });

  async function submit() {
    if (!f.title.trim()) return toast.error('Escribe un título');
    if (!f.selected.size) return toast.error('Elige a quién se lo envías');
    setSaving(true);
    let created: Message | null = null;
    try {
      created = await api.messages.create({
        kind: f.kind,
        title: f.title.trim().slice(0, 120),
        body: f.body.trim() || null,
        due_date: f.kind === 'task' && f.due ? f.due : null,
      } as Partial<Message>);
      await api.messageRecipients.createMany([...f.selected].map((employee_id) => ({ message_id: created!.id, employee_id }) as Partial<MessageRecipient>));
      toast.success(`${f.kind === 'task' ? 'Tarea enviada' : 'Mensaje enviado'} a ${f.selected.size} ${f.selected.size === 1 ? 'persona' : 'personas'}`);
      onSent();
      onClose();
    } catch (e) {
      // Si no se han podido guardar los destinatarios, no se deja el mensaje a medias
      if (created) await api.messages.remove(created.id).catch(() => {});
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={f.kind === 'task' ? 'Nueva tarea' : 'Nuevo mensaje'} onSubmit={submit} submitLabel="Enviar" saving={saving} wide>
      <div className="space-y-4">
        <Segmented
          full
          value={f.kind}
          onChange={(kind) => setF({ ...f, kind })}
          options={[
            { value: 'message', label: 'Mensaje' },
            { value: 'task', label: 'Tarea (aceptar o rechazar)' },
          ]}
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">Para ({f.selected.size})</span>
            {f.selected.size > 0 && (
              <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setF({ ...f, selected: new Set() })}>
                Quitar todos
              </button>
            )}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[{ value: 'all' as const, label: 'Todo el equipo' }, ...GROUPS].map((g) => {
              const ids = group(g.value);
              if (!ids.length) return null;
              const on = groupOn(ids);
              return (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => toggleGroup(ids)}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-[13px] font-medium transition',
                    on ? 'bg-accent text-on-accent' : 'bg-fill text-ink hover:bg-fill-2',
                  )}
                >
                  {g.label} · {ids.length}
                </button>
              );
            })}
          </div>
          <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl bg-fill/50 p-1.5 sm:grid-cols-2">
            {active.map((e) => {
              const on = f.selected.has(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.id)}
                  className={cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition', on ? 'bg-surface shadow-card dark:bg-elevated' : 'hover:bg-fill')}
                >
                  <Avatar name={fullName(e)} color={e.color} src={e.photo_url} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{fullName(e)}</span>
                    <span className={cx('block truncate text-[12px]', e.user_id ? 'text-ink-2' : 'text-orange')}>
                      {e.user_id ? e.position : 'Sin cuenta: no podrá verlo'}
                    </span>
                  </span>
                  <span className={cx('grid h-5 w-5 place-items-center rounded-full border-2', on ? 'border-accent bg-accent text-on-accent' : 'border-ink-3/50')}>
                    {on && <Check className="h-3 w-3" strokeWidth={3.5} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Título">
          <Input
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            maxLength={120}
            placeholder={f.kind === 'task' ? 'Ej.: Reponer la cámara de la barra 2' : 'Ej.: Reunión de equipo el jueves'}
            required
          />
        </Field>
        <Field label={f.kind === 'task' ? 'Qué hay que hacer' : 'Mensaje'}>
          <Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={4} maxLength={4000} placeholder="Opcional" />
        </Field>
        {f.kind === 'task' && (
          <Field label="Fecha límite">
            <Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
          </Field>
        )}
        <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
          {f.kind === 'task' ? <ClipboardList className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {f.kind === 'task'
            ? 'Cada persona podrá aceptarla o rechazarla. Les llegará una notificación al móvil.'
            : 'Les llegará una notificación al móvil y verás quién lo ha leído.'}
        </p>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { CalendarDays, Check, X } from 'lucide-react';
import { useAuth } from '../../auth';
import { SHIFTS_CHANGED } from '../../components/AppShell';
import { Modal, useFeedback } from '../../components/overlay';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, Segmented, Textarea } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { SHIFT_RESPONSE, SHIFT_STATUS } from '../../lib/constants';
import { addDays, businessDate, businessStart, businessToday, isoDate } from '../../lib/dates';
import { fmtDate, fmtHours, fmtWeekday, fmtShiftTimes } from '../../lib/format';
import type { Shift, ShiftResponse } from '../../lib/types';
import { byId, cx, shiftHours } from '../../lib/utils';
import { NotLinked } from './Clock';

/** Se puede responder (o cambiar la respuesta) hasta que empieza el turno */
const canRespond = (s: Shift) => s.status !== 'cancelled' && Date.parse(s.start_at) > Date.now();

export default function MyShifts() {
  const { employee } = useAuth();
  const { toast } = useFeedback();
  const [tab, setTab] = useState<'next' | 'past'>('next');
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<Shift | null>(null);
  const [reason, setReason] = useState('');

  const { data, loading, error, reload } = useLoad(async () => {
    if (!employee) return null;
    const today = isoDate(businessToday());
    const q =
      tab === 'next'
        ? { gte: ['start_at', businessStart(today)] as [string, string], order: ['start_at', 'asc'] as ['start_at', 'asc'] }
        : { gte: ['start_at', businessStart(isoDate(addDays(businessToday(), -60)))] as [string, string], lt: ['start_at', businessStart(today)] as [string, string], order: ['start_at', 'desc'] as ['start_at', 'desc'] };
    const [shifts, events] = await Promise.all([
      api.shifts.list({ eq: { employee_id: employee.id }, ...q }),
      api.events.list({ gte: ['date', isoDate(addDays(businessToday(), -60))] }),
    ]);
    return { shifts, events };
  }, [employee?.id, tab]);

  if (!employee) return <NotLinked />;

  const events = byId(data?.events ?? []);
  const pending = (data?.shifts ?? []).filter((s) => canRespond(s) && !s.response).length;

  async function respond(s: Shift, response: ShiftResponse, note?: string) {
    setBusy(s.id);
    try {
      await api.respondShift(s.id, response, note);
      toast.success(response === 'accepted' ? 'Turno aceptado' : 'Turno rechazado');
      setDeclining(null);
      reload();
      window.dispatchEvent(new Event(SHIFTS_CHANGED));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Mis turnos" subtitle="Tu calendario de trabajo" />
      {tab === 'next' && pending > 0 && (
        <div className="mb-4 rounded-2xl bg-accent/10 px-4 py-3 text-[14px] text-accent">
          Tienes {pending === 1 ? '1 turno' : `${pending} turnos`} sin responder. Confirma si vas a venir.
        </div>
      )}
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'next', label: 'Próximos' },
            { value: 'past', label: 'Anteriores' },
          ]}
        />
      </div>

      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : data?.shifts.length ? (
        <div className="space-y-3">
          {data.shifts.map((s) => {
            const date = businessDate(s.start_at);
            const ev = s.event_id ? events.get(s.event_id) : null;
            const open = canRespond(s);
            return (
              <Card key={s.id} className={cx('p-4', s.status === 'cancelled' && 'opacity-50')}>
              <div className="flex items-center gap-4">
                <div className="w-14 shrink-0 rounded-xl bg-fill/70 py-2 text-center leading-none">
                  <div className="text-[11px] font-semibold uppercase text-red">{fmtWeekday(date)}</div>
                  <div className="mt-1 text-[24px] font-semibold">{Number(date.slice(8))}</div>
                  <div className="mt-0.5 text-[11px] text-ink-2">{fmtDate(date, { month: 'short' }).replace('.', '')}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold">{ev?.name ?? s.position ?? 'Turno'}</div>
                  <div className="tabular text-[14px] text-ink-2">
                    {fmtShiftTimes(s)}
                    {s.end_at && ` · ${fmtHours(shiftHours(s))}`}
                  </div>
                  {s.notes && <div className="mt-1 text-[13px] text-ink-2">{s.notes}</div>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={SHIFT_STATUS[s.status].tone}>{SHIFT_STATUS[s.status].label}</Badge>
                </div>
              </div>

              {s.status !== 'cancelled' && (open || s.response) && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  {s.response ? (
                    <div className="min-w-0 text-[14px]">
                      <span className={cx('inline-flex items-center gap-1.5 font-semibold', s.response === 'accepted' ? 'text-green' : 'text-red')}>
                        {s.response === 'accepted' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                        {!open ? SHIFT_RESPONSE[s.response].label : s.response === 'accepted' ? 'Has confirmado que vienes' : 'Has dicho que no puedes'}
                      </span>
                      {s.response_note && <div className="mt-0.5 truncate text-[13px] text-ink-2">«{s.response_note}»</div>}
                    </div>
                  ) : (
                    <span className="text-[14px] font-medium">¿Vas a venir?</span>
                  )}
                  {open && (
                    <div className="flex gap-2">
                      {s.response !== 'declined' && (
                        <Button
                          size="sm"
                          variant="danger-tinted"
                          icon={<X />}
                          disabled={busy === s.id}
                          onClick={() => {
                            setReason('');
                            setDeclining(s);
                          }}
                        >
                          No puedo
                        </Button>
                      )}
                      {s.response !== 'accepted' && (
                        <Button size="sm" variant="success" icon={<Check />} loading={busy === s.id} onClick={() => respond(s, 'accepted')}>
                          Asistiré
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<CalendarDays />} title={tab === 'next' ? 'Sin turnos asignados' : 'Sin turnos anteriores'} message={tab === 'next' ? 'Cuando tu responsable te asigne turnos aparecerán aquí.' : undefined} />
        </Card>
      )}

      <Modal
        open={!!declining}
        onClose={() => setDeclining(null)}
        title="No puedo ir"
        submitLabel="Enviar"
        saving={!!declining && busy === declining.id}
        onSubmit={async () => {
          if (declining) await respond(declining, 'declined', reason);
        }}
      >
        <div className="space-y-3">
          <p className="text-[14px] text-ink-2">
            Avisaremos a tu responsable de que no puedes ir
            {declining && ` el ${fmtWeekday(businessDate(declining.start_at))} ${Number(businessDate(declining.start_at).slice(8))}`}.
          </p>
          <Field label="Motivo">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Opcional" maxLength={300} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

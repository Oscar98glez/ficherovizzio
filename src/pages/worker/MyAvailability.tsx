import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarCheck, Check, Copy, X } from 'lucide-react';
import { useAuth } from '../../auth';
import { useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Button, Card, ErrorBox, Input, Loading, PageHeader } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { EMPTY_DAY, saveAvailability, toDraft, type DayDraft } from '../../lib/availability';
import { addDays, businessToday, daysBetween, isoDate, makePeriod, parseDate, shiftPeriod } from '../../lib/dates';
import { fmtDate, fmtWeekday } from '../../lib/format';
import { cx } from '../../lib/utils';
import { NotLinked } from './Clock';

function Choice({ active, tone, onClick, children }: { active: boolean; tone: 'green' | 'red'; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition active:scale-95',
        active ? (tone === 'green' ? 'bg-green text-white' : 'bg-red text-white') : 'bg-fill text-ink-2 hover:bg-fill-2',
      )}
    >
      {tone === 'green' ? <Check className="h-4 w-4" strokeWidth={2.6} /> : <X className="h-4 w-4" strokeWidth={2.6} />}
      {children}
    </button>
  );
}

export default function MyAvailability() {
  const { employee } = useAuth();
  const { toast } = useFeedback();
  // Por defecto, la semana que viene: es la que se suele planificar
  const [period, setPeriod] = useState(() => makePeriod('week', addDays(businessToday(), 7)));
  const [drafts, setDrafts] = useState<Record<string, DayDraft>>({});
  const [saving, setSaving] = useState(false);
  const days = useMemo(() => daysBetween(period.from, period.to), [period]);

  const { data, loading, error, reload } = useLoad(async () => {
    if (!employee) return [];
    return api.availability.list({ eq: { employee_id: employee.id }, gte: ['date', period.from], lt: ['date', period.to] });
  }, [employee?.id, period]);

  const initial = useMemo(() => Object.fromEntries(days.map((d) => [d, toDraft(data?.find((a) => a.date === d))])), [data, days]);
  useEffect(() => setDrafts(initial), [initial]);

  if (!employee) return <NotLinked />;

  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const answered = days.filter((d) => drafts[d]?.status !== 'unset').length;
  const availableDays = days.filter((d) => drafts[d]?.status === 'yes').length;
  const set = (d: string, patch: Partial<DayDraft>) => setDrafts((s) => ({ ...s, [d]: { ...(s[d] ?? EMPTY_DAY), ...patch } }));
  const toggle = (d: string, status: 'yes' | 'no') => set(d, { status: drafts[d]?.status === status ? 'unset' : status });
  const today = isoDate(businessToday());

  async function copyPrevious() {
    const prev = shiftPeriod(period, -1);
    try {
      const rows = await api.availability.list({ eq: { employee_id: employee!.id }, gte: ['date', prev.from], lt: ['date', prev.to] });
      if (!rows.length) return toast.info('La semana anterior no tiene disponibilidad');
      setDrafts(Object.fromEntries(days.map((d) => [d, toDraft(rows.find((a) => a.date === isoDate(addDays(parseDate(d), -7))))])));
      toast.info('Copiada. Revisa y pulsa Guardar');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function save() {
    setSaving(true);
    try {
      await saveAvailability(employee!.id, drafts, data ?? []);
      toast.success('Disponibilidad guardada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Disponibilidad" subtitle="Indica qué días puedes trabajar para que tu responsable prepare los turnos" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker period={period} onChange={setPeriod} units={['week']} />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Copy />} onClick={copyPrevious}>
            Copiar semana anterior
          </Button>
          <Button variant="secondary" size="sm" icon={<CalendarCheck />} onClick={() => setDrafts(Object.fromEntries(days.map((d) => [d, { ...EMPTY_DAY, status: 'yes' as const }])))}>
            Todo disponible
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : (
        <>
          <Card className="divide-y divide-line overflow-hidden">
            {days.map((d) => {
              const draft = drafts[d] ?? EMPTY_DAY;
              const past = d < today;
              return (
                <div key={d} className={cx('px-4 py-3.5', past && 'opacity-50')}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[16px] font-semibold">{fmtWeekday(d, 'long')}</div>
                      <div className="text-[13px] text-ink-2">{fmtDate(d, { day: 'numeric', month: 'long' })}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <Choice active={draft.status === 'yes'} tone="green" onClick={() => toggle(d, 'yes')}>
                        Disponible
                      </Choice>
                      <Choice active={draft.status === 'no'} tone="red" onClick={() => toggle(d, 'no')}>
                        No
                      </Choice>
                    </div>
                  </div>
                  {draft.status === 'yes' && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[12px] text-ink-2">Desde (opcional)</span>
                        <Input type="time" value={draft.start} onChange={(e) => set(d, { start: e.target.value })} className="h-10" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] text-ink-2">Hasta (opcional)</span>
                        <Input type="time" value={draft.end} onChange={(e) => set(d, { end: e.target.value })} className="h-10" />
                      </label>
                    </div>
                  )}
                  {draft.status !== 'unset' && (
                    <Input
                      value={draft.note}
                      onChange={(e) => set(d, { note: e.target.value })}
                      placeholder={draft.status === 'yes' ? 'Nota (opcional): p. ej. prefiero barra' : 'Motivo (opcional)'}
                      className="mt-2 h-10"
                    />
                  )}
                </div>
              );
            })}
          </Card>

          <p className="mt-3 px-1 text-[13px] text-ink-2">
            Has indicado {answered} de 7 días · {availableDays} disponible{availableDays === 1 ? '' : 's'}. Si no pones horario, se entiende que puedes toda
            la noche.
          </p>

          {dirty ? (
            <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+84px)] mt-5 lg:bottom-6">
              <Button size="lg" className="w-full shadow-pop" loading={saving} onClick={save}>
                Guardar disponibilidad
              </Button>
            </div>
          ) : (
            data &&
            data.length > 0 && (
              <p className="mt-5 flex items-center justify-center gap-1.5 text-[14px] font-medium text-green">
                <Check className="h-4 w-4" strokeWidth={2.6} /> Disponibilidad guardada
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

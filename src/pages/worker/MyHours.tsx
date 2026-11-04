import { useState } from 'react';
import { Clock, Pencil, Plus } from 'lucide-react';
import { useAuth } from '../../auth';
import { Modal, useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Select, StatCard } from '../../components/ui';
import { useLoad, useNow } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { addDays, businessDate, businessToday, isoDate, makePeriod, periodRange, type PeriodUnit } from '../../lib/dates';
import { fmtDateLong, fmtHours, fmtMoney, fmtTime } from '../../lib/format';
import type { MyTimeEntry } from '../../lib/types';
import { cx, entryHours, sumBy } from '../../lib/utils';
import { nightInstant } from '../../lib/wages';
import { NotLinked } from './Clock';

/** Los camareros pueden corregir sus fichajes de los últimos 3 días */
const CORRECTION_DAYS = 3;
const canCorrect = (e: MyTimeEntry, now: number) => Date.parse(e.original_clock_in ?? e.clock_in) >= now - CORRECTION_DAYS * 86400e3;

/** "HH:MM" en la hora del móvil (la de España) */
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Noches que se pueden añadir: la de hoy y las de los 3 días anteriores */
const recentNights = () => {
  const today = businessToday();
  return [0, 1, 2, 3].map((i) => isoDate(addDays(today, -i)));
};

/**
 * Corregir la entrada y la salida de un fichaje (si se fichó tarde o se olvidó la salida),
 * o añadir una noche en la que se olvidó fichar (sin entry)
 */
function CorrectModal({ entry, onClose, onSaved }: { entry: MyTimeEntry | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const nights = recentNights();
  const [night, setNight] = useState(entry ? businessDate(entry.clock_in) : nights[1]);
  const [clockIn, setClockIn] = useState(entry ? hhmm(entry.clock_in) : '');
  const [clockOut, setClockOut] = useState(entry?.clock_out ? hhmm(entry.clock_out) : '');
  const [saving, setSaving] = useState(false);
  const adding = !entry;

  async function submit() {
    if (!clockIn) return toast.error('Pon la hora de entrada');
    if ((adding || entry?.clock_out) && !clockOut) return toast.error('Pon la hora de salida');
    const inIso = nightInstant(night, clockIn);
    // La salida es siempre después de la entrada: si la hora es menor, es del día siguiente
    let outIso = clockOut ? nightInstant(night, clockOut) : null;
    if (outIso && Date.parse(outIso) <= Date.parse(inIso)) outIso = new Date(Date.parse(outIso) + 86400e3).toISOString();
    setSaving(true);
    try {
      if (entry) await api.correctMyTimeEntry(entry.id, inIso, outIso);
      else await api.addMyTimeEntry(inIso, outIso!);
      toast.success(entry ? 'Fichaje corregido' : 'Fichaje añadido');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={adding ? 'Añadir un día sin fichar' : 'Corregir fichaje'} onSubmit={submit} submitLabel="Guardar" saving={saving}>
      <div className="flex flex-col gap-4">
        {adding ? (
          <>
            <p className="text-[14px] text-ink-2">Si se te olvidó fichar una noche, apúntala aquí con la hora a la que entraste y saliste. El encargado verá que la has añadido tú.</p>
            <Field label="Noche">
              <Select value={night} onChange={(e) => setNight(e.target.value)}>
                {nights.map((d, i) => (
                  <option key={d} value={d}>
                    {i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : fmtDateLong(d)}
                    {i < 2 ? ` · ${fmtDateLong(d)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <p className="text-[14px] text-ink-2">
            Noche del {fmtDateLong(night)}. Si se te olvidó fichar y lo hiciste más tarde, pon la hora a la que entraste o saliste de verdad. El encargado verá que lo has corregido.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entrada">
            <Input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
          </Field>
          <Field label="Salida">
            <Input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} placeholder="Sin fichar" />
          </Field>
        </div>
        {entry && !entry.clock_out && <p className="text-[13px] text-ink-3">Todavía no has fichado la salida: déjala vacía si sigues trabajando.</p>}
        {entry?.corrected_at && entry.original_clock_in && (
          <p className="text-[13px] text-ink-3">
            Lo que fichaste al principio: {fmtTime(entry.original_clock_in)} – {entry.original_clock_out ? fmtTime(entry.original_clock_out) : 'sin salida'}
          </p>
        )}
      </div>
    </Modal>
  );
}

const UNITS: PeriodUnit[] = ['week', 'month', 'year'];
const UNIT_KEY = 'vizzio.mis-horas.unit';

/** Cada trabajador elige si ve sus horas por semana, mes o año; se recuerda en este dispositivo */
const savedUnit = (): PeriodUnit => {
  try {
    const v = localStorage.getItem(UNIT_KEY) as PeriodUnit | null;
    return v && UNITS.includes(v) ? v : 'month';
  } catch {
    return 'month';
  }
};

export default function MyHours() {
  const { employee, isRrpp, profile } = useAuth();
  const isWaiter = profile?.role === 'worker' || profile?.role === 'tray';
  // Fichaje que se corrige, o 'new' para añadir una noche sin fichar
  const [correcting, setCorrecting] = useState<MyTimeEntry | 'new' | null>(null);
  const now = useNow(30_000);
  const [period, setPeriodState] = useState(() => makePeriod(savedUnit()));
  const setPeriod = (p: typeof period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(UNIT_KEY, p.unit);
    } catch {
      /* sin almacenamiento */
    }
  };

  const { data, loading, error, reload } = useLoad(async () => {
    if (!employee) return [];
    const { start, end } = periodRange(period);
    return api.myTimeEntries({ eq: { employee_id: employee.id }, gte: ['clock_in', start], lt: ['clock_in', end], order: ['clock_in', 'desc'] });
  }, [period, employee?.id]);

  if (!employee) return <NotLinked />;
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const entries = data ?? [];
  const hours = sumBy(entries, (e) => entryHours(e, now));
  const nights = new Set(entries.map((e) => businessDate(e.clock_in))).size;
  // Lo ganado viene calculado del servidor (la tarifa no llega al móvil). Los RRPP cobran por comisiones, no por horas.
  const showMoney = !isRrpp && entries.some((e) => e.earned !== undefined);
  const earned = sumBy(entries, (e) => e.earned ?? 0);
  const open = entries.some((e) => !e.clock_out);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Mis horas"
        subtitle={isWaiter ? 'Tus fichajes y las horas que has trabajado. Si fichaste tarde, pulsa el lápiz para corregir la hora.' : 'Tus fichajes y las horas que has trabajado'}
        actions={
          isWaiter && (
            <Button variant="secondary" icon={<Plus />} onClick={() => setCorrecting('new')}>
              Se me olvidó fichar
            </Button>
          )
        }
      />
      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} units={UNITS} />
      </div>
      <div className={cx('mb-5 grid gap-3', showMoney ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
        {showMoney && <StatCard label="Ganado" value={fmtMoney(earned)} sub={open ? 'Sin contar el turno en curso' : undefined} />}
        <StatCard label="Horas" value={fmtHours(hours)} />
        <StatCard label="Noches" value={nights} />
        <StatCard label="Media por noche" value={nights ? fmtHours(hours / nights) : '—'} />
      </div>

      <Card className="divide-y divide-line overflow-hidden">
        {entries.length ? (
          entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[15px] font-medium">
                  {fmtDateLong(businessDate(e.clock_in))}
                  {!e.clock_out && <Badge tone="green">En curso</Badge>}
                  {e.added_by_worker ? <Badge tone="orange">Añadido por ti</Badge> : e.corrected_at && <Badge tone="orange">Corregido</Badge>}
                </div>
                <div className="tabular text-[13px] text-ink-2">
                  {fmtTime(e.clock_in)} – {e.clock_out ? fmtTime(e.clock_out) : '…'}
                  {e.break_minutes > 0 && ` · pausa ${e.break_minutes} min`}
                </div>
              </div>
              <div className="tabular text-right">
                {showMoney && e.earned != null ? (
                  <>
                    <div className="text-[15px] font-semibold">{fmtMoney(e.earned)}</div>
                    <div className="text-[13px] text-ink-2">{fmtHours(entryHours(e, now))}</div>
                  </>
                ) : (
                  <div className="text-[15px] font-semibold">{fmtHours(entryHours(e, now))}</div>
                )}
              </div>
              {isWaiter && canCorrect(e, now) && (
                <Button variant="ghost" size="sm" icon={<Pencil />} onClick={() => setCorrecting(e)} aria-label="Corregir fichaje" className="!px-2" />
              )}
            </div>
          ))
        ) : (
          <EmptyState icon={<Clock />} title="Sin fichajes en este periodo" />
        )}
      </Card>
      {correcting && <CorrectModal entry={correcting === 'new' ? null : correcting} onClose={() => setCorrecting(null)} onSaved={reload} />}
    </div>
  );
}

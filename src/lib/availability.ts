import { api } from './api';
import type { Availability } from './types';

export type DayStatus = 'yes' | 'no' | 'unset';

export interface DayDraft {
  status: DayStatus;
  start: string;
  end: string;
  note: string;
}

export const EMPTY_DAY: DayDraft = { status: 'unset', start: '', end: '', note: '' };

/** "23:00:00" → "23:00" */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** Texto corto del horario disponible: "Toda la noche", "desde 01:00", "hasta 04:00" o "01:00–05:00". */
export function availabilityHours(a: Pick<Availability, 'start_time' | 'end_time'>) {
  const s = hhmm(a.start_time);
  const e = hhmm(a.end_time);
  if (s && e) return `${s}–${e}`;
  if (s) return `desde ${s}`;
  if (e) return `hasta ${e}`;
  return 'Toda la noche';
}

export function availabilityLabel(a: Availability | undefined) {
  if (!a) return 'Sin indicar';
  return a.available ? `Disponible · ${availabilityHours(a)}` : 'No disponible';
}

export const toDraft = (a: Availability | undefined): DayDraft =>
  a ? { status: a.available ? 'yes' : 'no', start: hhmm(a.start_time), end: hhmm(a.end_time), note: a.note ?? '' } : { ...EMPTY_DAY };

/**
 * Guarda la disponibilidad de varios días de un trabajador:
 * crea lo nuevo, actualiza lo que ha cambiado y borra los días que se dejan "sin indicar".
 */
export async function saveAvailability(employeeId: string, drafts: Record<string, DayDraft>, existing: Availability[]) {
  const byDate = new Map(existing.map((a) => [a.date, a]));
  const ops: Promise<unknown>[] = [];
  for (const [date, d] of Object.entries(drafts)) {
    const current = byDate.get(date);
    if (d.status === 'unset') {
      if (current) ops.push(api.availability.remove(current.id));
      continue;
    }
    const values: Partial<Availability> = {
      employee_id: employeeId,
      date,
      available: d.status === 'yes',
      start_time: d.status === 'yes' && d.start ? d.start : null,
      end_time: d.status === 'yes' && d.end ? d.end : null,
      note: d.note.trim() || null,
    };
    if (!current) ops.push(api.availability.create(values));
    else if (JSON.stringify(toDraft(current)) !== JSON.stringify({ ...d, note: d.note.trim() }))
      ops.push(api.availability.update(current.id, values));
  }
  await Promise.all(ops);
}

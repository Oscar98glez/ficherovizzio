import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Clock, FileSpreadsheet, FileText, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Modal, useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Avatar, Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Loading, PageHeader, Select, StatCard } from '../../components/ui';
import { useLoad, useNow } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { addDays, isoDate, makePeriod, parseDate, periodRange, type Period } from '../../lib/dates';
import { fmtDate, fmtHours, fmtMoney, fmtTime } from '../../lib/format';
import type { WageExtraEntry, WageSectionKey } from '../../lib/types';
import { cx, parseAmount, sumBy } from '../../lib/utils';
import { buildWageSheet, downloadWages, hoursBetween, SECTION_TITLE, type WageRow } from '../../lib/wages';

const SECTIONS = Object.keys(SECTION_TITLE) as WageSectionKey[];
const amountText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

export default function Wages() {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const now = useNow(60_000);
  const [period, setPeriod] = useState(() => makePeriod('week'));
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  // Extra que se está editando (null: ninguno · 'new': uno nuevo)
  const [editing, setEditing] = useState<WageRow | 'new' | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [employees, entries, profiles, extras] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] }),
      api.profiles.list(),
      api.wageExtras.list({ gte: ['date', period.from], lt: ['date', period.to] }),
    ]);
    return { employees, entries, roles: new Map(profiles.map((p) => [p.id, p.role])), extras };
  }, [period]);

  const sheet = useMemo(() => (data ? buildWageSheet({ period, ...data, now }) : null), [data, period, now]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!sheet) return null;

  const people = [...sheet.sections.flatMap((s) => s.rows), ...sheet.doormen].filter((r) => r.hours > 0 || r.amount > 0).length;
  const open = data!.entries.filter((e) => !e.clock_out).length;

  async function download(kind: 'xlsx' | 'pdf') {
    if (!sheet) return;
    setBusy(kind);
    try {
      await downloadWages(sheet, kind);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** Precio por hora de un extra: se aplica a todas sus noches de la semana */
  async function setRate(r: WageRow, text: string) {
    const rate = parseAmount(text);
    if (r.extras.every((x) => Number(x.rate) === rate)) return;
    try {
      await Promise.all(r.extras.map((x) => api.wageExtras.update(x.id, { rate })));
      toast.success(`${r.name}: ${fmtMoney(rate)}/h`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const nightChip = (date: string, text: string) => (
    <span key={date} className="tabular rounded-md bg-fill px-1.5 py-0.5 text-[12px] text-ink-2">
      <span className="font-medium capitalize text-ink">{fmtDate(date, { weekday: 'short' })}</span> {text}
    </span>
  );

  const row = (r: WageRow) => {
    const worked = sheet.days.filter((d) => r.cells[d.date]);
    const chips = worked.map((d) => {
      const c = r.cells[d.date]!;
      const times = c.clockIn ? `${fmtTime(c.clockIn)}–${c.clockOut ? fmtTime(c.clockOut) : '…'} · ` : '';
      return nightChip(d.date, c.fixed ? `${fmtMoney(c.amount)} fijos` : `${times}${fmtHours(c.hours)}${c.guest ? ' · invitado' : ''}`);
    });

    // Extra sin ficha: se edita aquí (precio por hora en la propia fila)
    if (!r.employee) {
      const fixed = r.extras.every((x) => x.amount != null);
      const unpriced = !fixed && !r.rate;
      return (
        <div key={r.key} className="flex w-full items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => setEditing(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <Avatar name={r.name} color="#8e8e93" size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[15px] font-medium">{r.name}</span>
                <Badge tone={unpriced ? 'orange' : 'gray'}>{unpriced ? 'Sin usuario · falta precio' : 'Sin usuario'}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">{chips}</div>
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-3">
            {!fixed && (
              <label className="flex items-center gap-1 text-[13px] text-ink-2">
                <Input
                  key={`${r.key}-${r.rate}`}
                  inputMode="decimal"
                  defaultValue={r.rate ? amountText(r.rate) : ''}
                  placeholder="0"
                  aria-label={`Precio por hora de ${r.name}`}
                  onBlur={(e) => setRate(r, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="h-8 w-16 rounded-lg px-2 text-right text-[14px]"
                />
                €/h
              </label>
            )}
            <div className="w-20 text-right">
              <div className="tabular text-[15px] font-semibold">{fmtMoney(r.amount)}</div>
              <div className="tabular text-[12px] text-ink-2">{fmtHours(r.hours)}</div>
            </div>
          </div>
        </div>
      );
    }

    const e = r.employee;
    return (
      <button
        key={r.key}
        type="button"
        onClick={() => navigate(`/personal/${e.id}`)}
        className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60 active:bg-fill', !worked.length && 'opacity-55')}
      >
        <Avatar name={r.name} color={e.color} src={e.photo_url} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{r.name}</div>
          {worked.length ? (
            <div className="mt-1 flex flex-wrap gap-1.5">{chips}</div>
          ) : (
            <div className="text-[13px] text-ink-3">No ha venido · {fmtMoney(r.rate)}/h</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular text-[15px] font-semibold">{fmtMoney(r.amount)}</div>
          <div className="tabular text-[12px] text-ink-2">{fmtHours(r.hours)}</div>
        </div>
      </button>
    );
  };

  const sectionCard = (key: WageSectionKey, rows: WageRow[]) => (
    <Card key={key}>
      <CardHeader
        title={SECTION_TITLE[key]}
        subtitle={`${rows.filter((r) => r.hours > 0 || r.amount > 0).length} con horas · ${fmtHours(sumBy(rows, (r) => r.hours))}`}
        action={<span className="tabular text-[17px] font-semibold">{fmtMoney(sumBy(rows, (r) => r.amount))}</span>}
      />
      {rows.length ? <div className="divide-y divide-line pb-2">{rows.map(row)}</div> : <p className="px-5 pb-5 text-[14px] text-ink-2">Nadie esta semana.</p>}
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Sueldos"
        subtitle={`Sobres de la semana ${sheet.period.label}`}
        actions={
          <>
            <Button variant="secondary" icon={<UserPlus />} onClick={() => setEditing('new')}>
              Añadir extra
            </Button>
            <Button variant="secondary" icon={<FileSpreadsheet />} loading={busy === 'xlsx'} onClick={() => download('xlsx')}>
              Excel
            </Button>
            <Button variant="secondary" icon={<FileText />} loading={busy === 'pdf'} onClick={() => download('pdf')}>
              PDF
            </Button>
          </>
        }
      />

      <div className="mb-5">
        <PeriodPicker period={period} onChange={setPeriod} units={['week']} />
      </div>

      <div className={cx('transition-opacity', loading && 'opacity-50')}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Sueldos de la semana" value={fmtMoney(sheet.amount)} icon={<Banknote />} tone="purple" />
          <StatCard label="Horas" value={fmtHours(sheet.hours)} icon={<Clock />} tone="blue" />
          <StatCard label="Personas" value={people} icon={<Users />} tone="green" />
          <StatCard
            label="Extras sin usuario"
            value={sheet.extrasCount}
            sub={sheet.unpriced ? `${sheet.unpriced} sin precio por hora` : sheet.extrasCount ? 'Todos con precio' : 'Ninguno'}
            icon={<UserPlus />}
            tone="orange"
          />
        </div>

        {open > 0 && (
          <p className="mt-3 text-[13px] text-orange">
            {open === 1 ? 'Hay 1 fichaje sin salida' : `Hay ${open} fichajes sin salida`}: cuentan las horas hasta ahora.
          </p>
        )}
        {sheet.unpriced > 0 && (
          <p className="mt-3 text-[13px] text-orange">
            Pon el precio por hora de los extras sin usuario (en su fila, «€/h»): hasta entonces cuentan 0 €.
          </p>
        )}

        <div className="mt-5 space-y-4">
          {sheet.sections.map((sec) => sectionCard(sec.key, sec.rows))}
          {sheet.doormen.length > 0 && sectionCard('porteros', sheet.doormen)}
        </div>
      </div>

      {editing && (
        <ExtraForm
          period={period}
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

// =====================================================================
//  Extra sin usuario: nombre, sección, precio por hora y sus noches
// =====================================================================

interface NightLine {
  id?: string;
  date: string;
  clock_in: string;
  clock_out: string;
  hours: string;
  amount: string;
}

const lineOf = (x: WageExtraEntry): NightLine => ({
  id: x.id,
  date: x.date,
  clock_in: x.clock_in ?? '',
  clock_out: x.clock_out ?? '',
  hours: amountText(Number(x.hours)),
  amount: amountText(x.amount),
});

function ExtraForm({ period, row, onClose, onSaved }: { period: Period; row: WageRow | null; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useFeedback();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(parseDate(period.from), i))), [period.from]);
  const [name, setName] = useState(row?.name ?? '');
  const [section, setSection] = useState<WageSectionKey>(row?.extras[0]?.section ?? 'camareras');
  const [rate, setRate] = useState(row?.rate ? amountText(row.rate) : '');
  const [lines, setLines] = useState<NightLine[]>(() =>
    row ? row.extras.map(lineOf) : [{ date: days[4], clock_in: '', clock_out: '', hours: '', amount: '' }],
  );
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!row) setLines((ls) => ls.map((l) => (days.includes(l.date) ? l : { ...l, date: days[4] })));
  }, [days, row]);

  const set = (i: number, patch: Partial<NightLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const hoursOf = (l: NightLine) => (l.clock_in && l.clock_out ? hoursBetween(l.clock_in, l.clock_out) : parseAmount(l.hours));

  async function submit() {
    if (!name.trim()) return toast.error('Escribe el nombre');
    if (!lines.length) return toast.error('Añade al menos una noche');
    const bad = lines.find((l) => !l.amount.trim() && !(hoursOf(l) > 0));
    if (bad) return toast.error(`${fmtDate(bad.date, { weekday: 'long', day: 'numeric' })}: pon la entrada y la salida, las horas o un importe fijo`);
    setSaving(true);
    try {
      const values = (l: NightLine): Partial<WageExtraEntry> => ({
        date: l.date,
        section,
        name: name.trim(),
        clock_in: l.clock_in || null,
        clock_out: l.clock_out || null,
        hours: Math.round(hoursOf(l) * 100) / 100,
        rate: parseAmount(rate),
        amount: l.amount.trim() ? parseAmount(l.amount) : null,
      });
      const kept = new Set(lines.map((l) => l.id).filter(Boolean));
      await Promise.all([
        ...(row?.extras ?? []).filter((x) => !kept.has(x.id)).map((x) => api.wageExtras.remove(x.id)),
        ...lines.map((l) => (l.id ? api.wageExtras.update(l.id, values(l)) : api.wageExtras.create(values(l)))),
      ]);
      toast.success(row ? 'Extra guardado' : `${name.trim()} añadido a ${SECTION_TITLE[section].toLowerCase()}`);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeAll() {
    if (!row) return;
    if (!(await confirm({ title: `¿Quitar a ${row.name} de los sobres?`, message: 'Se borran sus noches de esta semana.', confirmLabel: 'Quitar', destructive: true }))) return;
    try {
      await Promise.all(row.extras.map((x) => api.wageExtras.remove(x.id)));
      toast.success(`${row.name} quitado`);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Modal open onClose={onClose} title={row ? 'Extra sin usuario' : 'Añadir extra'} onSubmit={submit} saving={saving} submitLabel={row ? 'Guardar' : 'Añadir'}>
      <div className="space-y-4">
        <p className="text-[14px] text-ink-2">Para quien trabaja sin ficha ni cuenta en la app: sale en su sección de los sobres con sus horas.</p>
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" autoFocus={!row} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sección">
            <Select value={section} onChange={(e) => setSection(e.target.value as WageSectionKey)}>
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_TITLE[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Precio por hora (€)">
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
          </Field>
        </div>

        <div className="space-y-3">
          <div className="px-1 text-[13px] font-medium text-ink-2">Noches</div>
          {lines.map((l, i) => {
            const h = hoursOf(l);
            return (
              <div key={l.id ?? i} className="space-y-2 rounded-2xl bg-fill/50 p-3">
                <div className="flex items-center gap-2">
                  <Select value={l.date} onChange={(e) => set(i, { date: e.target.value })} className="flex-1">
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' })}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-fill hover:text-red"
                    aria-label="Quitar esta noche"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Entrada">
                    <Input type="time" value={l.clock_in} onChange={(e) => set(i, { clock_in: e.target.value })} />
                  </Field>
                  <Field label="Salida">
                    <Input type="time" value={l.clock_out} onChange={(e) => set(i, { clock_out: e.target.value })} />
                  </Field>
                  <Field label="Horas">
                    {l.clock_in && l.clock_out ? (
                      <div className="flex h-10 items-center px-1 text-[15px] tabular">{fmtHours(h)}</div>
                    ) : (
                      <Input inputMode="decimal" value={l.hours} onChange={(e) => set(i, { hours: e.target.value })} placeholder="0" />
                    )}
                  </Field>
                  <Field label="Importe fijo (€)">
                    <Input inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="Opcional" />
                  </Field>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { date: ls[ls.length - 1]?.date ?? days[4], clock_in: '', clock_out: '', hours: '', amount: '' }])}
            className="flex items-center gap-1.5 text-[14px] font-medium text-accent hover:opacity-70"
          >
            <Plus className="h-4 w-4" /> Añadir noche
          </button>
        </div>

        {row && (
          <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={removeAll}>
            Quitar de los sobres
          </Button>
        )}
      </div>
    </Modal>
  );
}

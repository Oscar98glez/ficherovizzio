import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Modal, useFeedback } from '../../components/overlay';
import { Button, Field, Input, Select } from '../../components/ui';
import { parseDate } from '../../lib/dates';
import { fmtWeekday } from '../../lib/format';
import {
  conceptInfo,
  dayHasData,
  dayIncome,
  EXPENSE_GROUPS,
  fmtEuros,
  fmtEuros2,
  parseLedgerAmount,
  rangeLabel,
  type LedgerGroup,
  type LedgerMethod,
} from '../../lib/ledger';
import type { AdminLedgerDay, AdminLedgerExpense } from '../../lib/types';
import { cx } from '../../lib/utils';
import type { DayValues, ExpenseValues, WeekInfo } from './Administration';
import { amountText, Chip, INCOME_ICONS, MethodToggle, MoneyInput, Panel, PanelTitle } from './ledger-ui';

/** "jueves 29" */
const nightName = (d: string) => `${fmtWeekday(d, 'long').toLowerCase()} ${Number(d.slice(8))}`;
/** "Jue 29" */
const nightShort = (d: string) => `${fmtWeekday(d)} ${Number(d.slice(8))}`;
/** "Miércoles 28 de octubre" */
const nightLong = (d: string) => `${fmtWeekday(d, 'long')} ${parseDate(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`;

/** Noche marcada como cerrada ("No se abrió") */
const isClosed = (d: AdminLedgerDay | undefined) => !!d?.data?.cerrado;

const INCOME_FIELDS = [
  { key: 'efectivo', label: 'Efectivo', hint: 'Lo que hay en la caja', iconClass: 'text-green' },
  { key: 'banco', label: 'Banco', hint: 'Tarjetas y transferencias', iconClass: 'text-accent' },
  { key: 'plataforma', label: 'Plataforma', hint: 'Entradas vendidas por internet', iconClass: 'text-ink-2' },
] as const;

type IncomeForm = Record<'efectivo' | 'banco' | 'plataforma' | 'rappel' | 'rappel_def', string>;

const formOf = (d: AdminLedgerDay | undefined): IncomeForm => {
  const n = (k: string) => (typeof d?.data?.[k] === 'number' ? (d.data[k] as number) : null);
  return {
    efectivo: amountText(n('efectivo')),
    banco: amountText(n('banco')),
    plataforma: amountText(n('plataforma')),
    rappel: amountText(n('rappel')),
    rappel_def: typeof d?.data?.rappel_def === 'string' ? d.data.rappel_def : '',
  };
};

/** Una semana: lo que entró cada noche y lo que se pagó */
export function LedgerWeek({
  week,
  weeks,
  today,
  byDate,
  expenses,
  initialNight,
  onSaveDay,
  onSaveExpense,
  onRemoveExpense,
  onOpenWeek,
}: {
  week: WeekInfo;
  weeks: WeekInfo[];
  today: string;
  byDate: Map<string, AdminLedgerDay>;
  expenses: AdminLedgerExpense[];
  initialNight: string | null;
  onSaveDay: (date: string, values: DayValues | null) => Promise<void>;
  onSaveExpense: (values: ExpenseValues) => Promise<void>;
  onRemoveExpense: (id: string) => Promise<void>;
  onOpenWeek: (week: string) => void;
}) {
  const { toast } = useFeedback();
  const [extra, setExtra] = useState<string[]>(initialNight && week.dates.includes(initialNight) ? [initialNight] : []);
  const [moreDays, setMoreDays] = useState(false);
  const shown = useMemo(() => [...new Set([...week.shown, ...extra])].sort(), [week.shown, extra]);
  const hidden = week.dates.filter((d) => !shown.includes(d));

  const firstNight = () => {
    if (initialNight && week.dates.includes(initialNight)) return initialNight;
    return week.missing[0] ?? (shown.includes(today) ? today : shown.find((d) => !dayHasData(byDate.get(d))) ?? shown[0]);
  };
  const [night, setNight] = useState<string>(firstNight);
  const day = byDate.get(night);
  const [form, setForm] = useState<IncomeForm>(() => formOf(day));
  const [showRappel, setShowRappel] = useState(() => !!form.rappel);
  const [saving, setSaving] = useState(false);
  const [reopened, setReopened] = useState(false);

  // Al cambiar de noche se cargan sus importes
  useEffect(() => {
    const f = formOf(byDate.get(night));
    setForm(f);
    setShowRappel(!!f.rappel);
    setReopened(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night]);

  const weekExpenses = expenses.filter((e) => week.dates.includes(e.date)).sort((a, b) => a.date.localeCompare(b.date) || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const t = week.totals;
  const idx = weeks.findIndex((w) => w.start === week.start);
  const next = shown.slice(shown.indexOf(night) + 1).find((d) => !dayHasData(byDate.get(d)));
  const closed = isClosed(day) && !reopened;

  async function saveNight(values: DayValues | null, message: string) {
    setSaving(true);
    try {
      await onSaveDay(night, values);
      toast.success(message);
      if (next) setNight(next);
    } catch {
      /* el aviso ya se ha mostrado */
    } finally {
      setSaving(false);
    }
  }

  function submitNight() {
    const values: DayValues = {};
    for (const k of ['efectivo', 'banco', 'plataforma', 'rappel'] as const) {
      const text = form[k].trim();
      if (!text) continue;
      const n = parseLedgerAmount(text);
      if (n === null) return toast.error(`Revisa el importe de ${k === 'rappel' ? 'rappel' : k}: escribe sólo números, por ejemplo 1234,50`);
      if (n) values[k] = n;
    }
    if (values.rappel && form.rappel_def.trim()) values.rappel_def = form.rappel_def.trim();
    const any = Object.keys(values).length > 0;
    void saveNight(any ? values : null, any ? `Guardada la noche del ${nightName(night)}` : `La noche del ${nightName(night)} se ha quedado sin nada`);
  }

  // ---------- Pagos ----------

  const [editing, setEditing] = useState<{ group: LedgerGroup; expense?: AdminLedgerExpense } | null>(null);

  const chipSub = (d: string) => {
    const row = byDate.get(d);
    if (isClosed(row)) return { text: 'No abrió', cls: 'text-ink-3' };
    if (dayHasData(row)) return { text: fmtEuros(dayIncome(row)), cls: 'text-green' };
    if (d === today) return { text: 'Hoy', cls: 'text-accent' };
    if (d < today) return { text: 'Falta', cls: 'text-orange' };
    return { text: 'Pendiente', cls: 'text-ink-3' };
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[15px] text-ink-2">{rangeLabel(shown[0], shown[shown.length - 1])}</p>
          <h2 className="text-[30px] font-bold leading-tight tracking-[-0.03em] sm:text-[34px]">{week.state === 'current' ? 'Esta semana' : `Semana ${week.n}`}</h2>
        </div>
        <div className="flex gap-1.5">
          <button type="button" aria-label="Semana anterior" disabled={idx <= 0} onClick={() => onOpenWeek(weeks[idx - 1].start)} className="grid h-10 w-10 place-items-center rounded-full bg-fill transition hover:bg-fill-2 disabled:opacity-30">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Semana siguiente" disabled={idx >= weeks.length - 1} onClick={() => onOpenWeek(weeks[idx + 1].start)} className="grid h-10 w-10 place-items-center rounded-full bg-fill transition hover:bg-fill-2 disabled:opacity-30">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Cuentas de la semana */}
      <Panel className="tabular grid gap-3 py-5 sm:grid-cols-3 sm:gap-4 sm:py-6">
        {(
          [
            ['Ha entrado', t.income, ''],
            ['Ha salido', t.expenses, ''],
            ['Resultado', t.result, t.result < 0 ? 'text-red' : 'text-green'],
          ] as const
        ).map(([label, value, cls], i) => (
          <div key={label} className={cx('flex min-w-0 items-baseline justify-between gap-3 sm:block', i > 0 && 'sm:border-l sm:border-line sm:pl-4')}>
            <p className="text-[15px] text-ink-2 sm:text-[14px]">{label}</p>
            <p className={cx('whitespace-nowrap text-[22px] font-semibold tracking-[-0.02em] sm:text-[26px]', cls)}>{fmtEuros(value, i === 2)}</p>
          </div>
        ))}
        <p className="border-t border-line pt-4 text-[14px] text-ink-2 sm:col-span-3">
          En efectivo: entra <strong className="font-medium text-ink">{fmtEuros(t.cashIn)}</strong> y sale <strong className="font-medium text-ink">{fmtEuros(t.cashOut)}</strong>
          <span className="mx-2 text-ink-3">·</span>
          Por el banco: entra <strong className="font-medium text-ink">{fmtEuros(t.bankIn)}</strong> y sale <strong className="font-medium text-ink">{fmtEuros(t.bankOut)}</strong>
        </p>
      </Panel>

      {/* Lo que entró cada noche */}
      <Panel>
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Lo que entró cada noche</p>
        <div className="flex flex-wrap gap-2">
          {shown.map((d) => {
            const sub = chipSub(d);
            const selected = d === night;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setNight(d)}
                aria-pressed={selected}
                className={cx(
                  'flex h-16 min-w-[96px] flex-col items-start justify-center gap-0.5 rounded-2xl px-3.5 text-left transition',
                  selected ? 'bg-surface ring-2 ring-accent' : dayHasData(byDate.get(d)) ? 'bg-green/10 hover:bg-green/15' : 'bg-fill hover:bg-fill-2',
                )}
              >
                <span className="text-[14px] font-semibold">{nightShort(d)}</span>
                <span className={cx('tabular text-[12.5px] font-medium', sub.cls)}>{sub.text}</span>
              </button>
            );
          })}
          {hidden.length > 0 &&
            (moreDays ? (
              hidden.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setExtra((x) => [...x, d]);
                    setNight(d);
                    setMoreDays(false);
                  }}
                  className="h-16 rounded-2xl border border-dashed border-ink-3/50 px-4 text-[14px] font-medium text-ink-2 transition hover:bg-fill"
                >
                  {nightShort(d)}
                </button>
              ))
            ) : (
              <button type="button" onClick={() => setMoreDays(true)} className="flex h-16 items-center gap-1.5 rounded-2xl border border-dashed border-ink-3/50 px-4 text-[14px] font-medium text-ink-2 transition hover:bg-fill">
                <Plus className="h-4 w-4" /> Otro día
              </button>
            ))}
        </div>

        <div className="mt-7">
          <h3 className="text-[24px] font-semibold tracking-[-0.02em] sm:text-[26px]">¿Cuánto entró el {nightName(night)}?</h3>
          {!!day?.finance && Object.keys(day.finance).length > 0 && (
            <p className="mt-1.5 text-[14px] text-ink-2">Ya viene con lo apuntado en Finanzas (el cierre de caja de esa noche).</p>
          )}
          {closed ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-fill px-5 py-4">
              <p className="text-[16px] text-ink-2">Esta noche está apuntada como cerrada: no se abrió.</p>
              <Button variant="secondary" onClick={() => setReopened(true)}>
                Sí se abrió
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-[16px] text-ink-2">Escribe lo que dice el cierre de caja y el datáfono. Si algo no hubo, déjalo en blanco.</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {INCOME_FIELDS.map((f) => (
                  <MoneyInput key={f.key} label={f.label} hint={f.hint} icon={INCOME_ICONS[f.key]} iconClass={f.iconClass} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} />
                ))}
              </div>
              {showRappel ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <MoneyInput label="Rappel" hint="Lo que paga una marca por vender sus bebidas" value={form.rappel} onChange={(v) => setForm({ ...form, rappel: v })} />
                  <Field label="¿De quién es el rappel?" className="sm:col-span-2 [&>span:first-child]:text-[15px] [&>span:first-child]:text-ink">
                    <Input value={form.rappel_def} onChange={(e) => setForm({ ...form, rappel_def: e.target.value })} placeholder="Por ejemplo: Legendario" className="h-[60px] rounded-2xl text-[17px]" />
                  </Field>
                </div>
              ) : (
                <button type="button" onClick={() => setShowRappel(true)} className="mt-4 text-[16px] font-medium text-accent hover:opacity-80">
                  + Añadir un rappel
                </button>
              )}
            </>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
            {!closed && (
              <Button variant="secondary" size="lg" disabled={saving} onClick={() => void saveNight({ cerrado: 1 }, `Apuntado: el ${nightName(night)} no se abrió`)}>
                No se abrió
              </Button>
            )}
            {(!closed || next) && (
              <Button variant="solid" size="lg" loading={saving} onClick={closed ? () => next && setNight(next) : submitNight}>
                {closed ? `Ir al ${nightName(next!)}` : next ? `Guardar y seguir con el ${nightName(next)}` : 'Guardar'}
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {/* Lo que se pagó */}
      <Panel>
        <PanelTitle title="¿Qué se ha pagado esta semana?" aside={t.expenses ? <>Llevas <strong className="tabular font-semibold text-ink">{fmtEuros2(t.expenses)}</strong></> : undefined} />
        <p className="-mt-2 mb-5 text-[15px] text-ink-2">Pulsa lo que quieras apuntar: sueldos, RRPP, proveedores…</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {EXPENSE_GROUPS.map((g) => (
            <button key={g.key} type="button" onClick={() => setEditing({ group: g })} className="flex min-h-[84px] flex-col items-start justify-center gap-1 rounded-2xl bg-fill px-4 py-3 text-left transition hover:bg-fill-2 active:scale-[0.98]">
              <span className="flex w-full flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-[16px] font-semibold">{g.title}</span>
                {!!t.groups[g.key] && <span className="tabular whitespace-nowrap text-[13px] font-medium text-ink-2">{fmtEuros(t.groups[g.key])}</span>}
              </span>
              <span className="text-[12.5px] leading-snug text-ink-2">{g.hint}</span>
            </button>
          ))}
        </div>

        {weekExpenses.length > 0 && (
          <div className="mt-6">
            <p className="pb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Ya apuntado</p>
            {weekExpenses.map((e) => {
              const { group, column } = conceptInfo(e.concept);
              return (
                <button key={e.id} type="button" onClick={() => setEditing({ group, expense: e })} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-line py-3 text-left transition hover:bg-fill/40">
                  <span className="min-w-0">
                    <span className="block truncate text-[16px]">
                      {column.label}
                      {e.note && <span className="text-ink-2"> · {e.note}</span>}
                    </span>
                    <span className="block text-[13px] text-ink-2">
                      {group.title} · {e.method === 'cash' ? 'en efectivo' : 'por el banco'} · {nightShort(e.date)}
                      {e.transaction_id && <span className="text-accent"> · de Finanzas</span>}
                    </span>
                  </span>
                  <span className="tabular text-[16px] font-medium">{fmtEuros2(Number(e.amount))}</span>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {editing && (
        <ExpenseModal
          group={editing.group}
          expense={editing.expense}
          dates={week.dates}
          defaultDate={week.nights[0]}
          expenses={expenses}
          onClose={() => setEditing(null)}
          onSave={onSaveExpense}
          onRemove={onRemoveExpense}
        />
      )}
    </div>
  );
}

const QUESTION: Record<string, string> = { personal: '¿A quién?', mercaderias: '¿A qué proveedor?', servicios: '¿Qué servicio?' };

function ExpenseModal({
  group,
  expense,
  dates,
  defaultDate,
  expenses,
  onClose,
  onSave,
  onRemove,
}: {
  group: LedgerGroup;
  expense?: AdminLedgerExpense;
  dates: string[];
  defaultDate: string;
  expenses: AdminLedgerExpense[];
  onClose: () => void;
  onSave: (values: ExpenseValues) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { toast, confirm } = useFeedback();
  /** Cómo se pagó la última vez ese concepto (o cómo se paga normalmente) */
  const usualMethod = (concept: string): LedgerMethod =>
    [...expenses].reverse().find((e) => e.concept === concept)?.method ?? conceptInfo(concept).column.method ?? 'bank';
  const single = group.columns.length === 1 ? group.columns[0].key : '';
  const [concept, setConcept] = useState(expense?.concept ?? single);
  const [amount, setAmount] = useState(amountText(expense ? Number(expense.amount) : null));
  const [method, setMethod] = useState<LedgerMethod>(expense?.method ?? usualMethod(single || group.columns[0].key));
  const [date, setDate] = useState(expense?.date ?? defaultDate);
  const [note, setNote] = useState(expense?.note ?? '');
  const [saving, setSaving] = useState(false);
  const isOther = group.key === 'otros';

  async function submit() {
    if (!concept) return toast.error(QUESTION[group.key] ? `Elige ${QUESTION[group.key].slice(1, -1).toLowerCase()}` : 'Elige qué es');
    const n = parseLedgerAmount(amount);
    if (!n) return toast.error('Escribe cuánto se pagó, por ejemplo 1234,50');
    if (isOther && !note.trim()) return toast.error('Escribe qué ha sido, para saberlo luego');
    setSaving(true);
    try {
      await onSave({ id: expense?.id, date, concept, amount: n, method, note: note.trim() || null });
      toast.success(expense ? 'Pago cambiado' : 'Pago apuntado');
      onClose();
    } catch {
      setSaving(false);
    }
  }

  async function remove() {
    if (!expense) return;
    const ok = await confirm({ title: '¿Borrar este pago?', message: `${conceptInfo(expense.concept).column.label} · ${fmtEuros2(Number(expense.amount))}`, confirmLabel: 'Borrar', destructive: true });
    if (!ok) return;
    try {
      await onRemove(expense.id);
      toast.success('Pago borrado');
      onClose();
    } catch {
      /* el aviso ya se ha mostrado */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={expense ? 'Cambiar el pago' : group.title}
      onSubmit={submit}
      submitLabel="Guardar"
      saving={saving}
      footer={
        expense && (
          <Button variant="danger-tinted" className="w-full" onClick={remove}>
            Borrar este pago
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        {!single && (
          <div>
            <p className="mb-2.5 text-[15px] font-medium">{QUESTION[group.key] ?? '¿Qué es?'}</p>
            <div className="flex flex-wrap gap-2">
              {group.columns.map((c) => (
                <Chip
                  key={c.key}
                  selected={concept === c.key}
                  onClick={() => {
                    setConcept(c.key);
                    if (!expense) setMethod(usualMethod(c.key));
                  }}
                >
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {isOther && (
          <Field label="¿Qué ha sido?" className="[&>span:first-child]:text-[15px] [&>span:first-child]:text-ink">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: parking, cena del equipo, Amazon" className="h-12 text-[16px]" autoFocus={!expense} />
          </Field>
        )}
        <MoneyInput label="¿Cuánto?" value={amount} onChange={setAmount} size="md" autoFocus={!!single && !isOther && !expense} />
        <div>
          <p className="mb-2.5 text-[15px] font-medium">¿Cómo se pagó?</p>
          <MethodToggle value={method} onChange={setMethod} />
        </div>
        <Field label="¿Qué día?" className="[&>span:first-child]:text-[15px] [&>span:first-child]:text-ink">
          <Select value={date} onChange={(e) => setDate(e.target.value)} className="h-12 text-[16px]">
            {dates.map((d) => (
              <option key={d} value={d}>
                {nightLong(d)}
              </option>
            ))}
          </Select>
        </Field>
        {!isOther && (
          <Field label="Nota (si quieres)" className="[&>span:first-child]:text-[15px] [&>span:first-child]:text-ink">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: factura 1234" className="h-12 text-[16px]" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

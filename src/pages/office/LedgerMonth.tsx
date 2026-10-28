import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronsLeftRight, Plus } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { Button, Card, CardHeader, ErrorBox, Input, Loading, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { parseDate, type Period } from '../../lib/dates';
import { fmtMoney } from '../../lib/format';
import {
  cellAmount,
  computeLedger,
  dayExpenses,
  dayGroup,
  dayIncome,
  EXPENSE_GROUPS,
  fmtAmount,
  fmtShare,
  INCOME_COLUMNS,
  ledgerDates,
  parseLedgerAmount,
  type LedgerColumn,
  type LedgerGroup,
} from '../../lib/ledger';
import type { AdminLedgerDay, AdminLedgerMonth } from '../../lib/types';
import { cx } from '../../lib/utils';

const OPEN_KEY = 'vizzio.administracion.grupos';
const savedOpen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
  } catch {
    return [];
  }
};

/** "jue 1" */
const dayLabel = (d: string) => {
  const date = parseDate(d);
  return { weekday: date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''), day: date.getDate() };
};
const rangeLabel = (dates: string[]) => {
  const a = parseDate(dates[0]);
  const b = parseDate(dates[dates.length - 1]);
  const month = b.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
  return dates.length === 1 ? `${a.getDate()} ${month}` : `${a.getDate()} – ${b.getDate()} ${month}`;
};

// ---------- Casillas ----------

const cellInput =
  'tabular h-8 w-full min-w-0 rounded-md bg-transparent px-1.5 text-right text-[13px] text-ink outline-none transition placeholder:text-ink-3 hover:bg-fill focus:bg-fill focus:ring-2 focus:ring-accent/60';

function AmountInput({ value, onSave, placeholder, className }: { value: number | null | undefined; onSave: (n: number | null) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      inputMode="decimal"
      value={text ?? fmtAmount(value)}
      placeholder={placeholder}
      onFocus={() => setText(value ? String(value).replace('.', ',') : '')}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parseLedgerAmount(text ?? '');
        setText(null);
        if ((n ?? 0) !== (value ?? 0)) onSave(n);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cx(cellInput, className)}
    />
  );
}

function TextInput({ value, onSave, placeholder }: { value: string; onSave: (t: string) => void; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      value={text ?? value}
      placeholder={placeholder}
      onFocus={() => setText(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = (text ?? '').trim();
        setText(null);
        if (t !== value) onSave(t);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cx(cellInput, 'text-left')}
    />
  );
}

/** Importe de las filas de totales ("—" si no hay) */
const total = (n: number) => (n ? fmtAmount(n) : '—');

// ---------- Mes ----------

export function LedgerMonth({ period }: { period: Period }) {
  const { toast } = useFeedback();
  const [days, setDays] = useState<Map<string, AdminLedgerDay>>(new Map());
  const [month, setMonth] = useState<AdminLedgerMonth | null>(null);
  const [extraDate, setExtraDate] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [open, setOpenState] = useState<string[]>(savedOpen);
  const setOpen = (keys: string[]) => {
    setOpenState(keys);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(keys));
    } catch {
      /* sin almacenamiento */
    }
  };
  const toggle = (g: LedgerGroup) => setOpen(open.includes(g.key) ? open.filter((k) => k !== g.key) : [...open, g.key]);
  const allOpen = EXPENSE_GROUPS.every((g) => open.includes(g.key));

  // Lo último que hay en pantalla, para los guardados en cola (sin esperar a que se pinte)
  const daysRef = useRef(days);
  const monthRef = useRef(month);
  const commitDays = (next: Map<string, AdminLedgerDay>) => {
    daysRef.current = next;
    setDays(next);
  };
  const commitMonth = (next: AdminLedgerMonth | null) => {
    monthRef.current = next;
    setMonth(next);
  };
  // Guardados en cola por día (y para el mes), para no crear dos veces la misma fila
  const queue = useRef(new Map<string, Promise<unknown>>());

  const { data, loading, error, reload } = useLoad(async () => {
    const [rows, months, events] = await Promise.all([
      api.ledgerDays.list({ gte: ['date', period.from], lt: ['date', period.to] }),
      api.ledgerMonths.list({ eq: { month: period.from } }),
      api.events.list({ gte: ['date', period.from], lt: ['date', period.to] }),
    ]);
    return { rows, month: months[0] ?? null, events };
  }, [period]);

  useEffect(() => {
    if (!data) return;
    commitDays(new Map(data.rows.map((r) => [r.date, r])));
    commitMonth(data.month);
    setAdded([]);
  }, [data]);

  const dates = useMemo(
    () => ledgerDates(period.from, period.to, [...(data?.events ?? []).map((e) => e.date), ...days.keys(), ...added]),
    [period, data, days, added],
  );
  const sheet = useMemo(() => computeLedger(dates, days, month), [dates, days, month]);

  function enqueue(key: string, job: () => Promise<void>) {
    const next = (queue.current.get(key) ?? Promise.resolve()).then(job).catch((e) => toast.error(errorMessage(e)));
    queue.current.set(key, next);
  }

  function saveCell(date: string, key: string, value: number | string | null) {
    const current = daysRef.current.get(date);
    const nextData = { ...(current?.data ?? {}) };
    if (value === null || value === '') delete nextData[key];
    else nextData[key] = value;
    commitDays(new Map(daysRef.current).set(date, { ...(current ?? { id: '', date }), data: nextData }));
    enqueue(date, async () => {
      const row = daysRef.current.get(date);
      if (!row) return;
      const payload = row.data;
      if (!Object.keys(payload).length) {
        // Sin nada apuntado, la fila sobra
        if (row.id) await api.ledgerDays.remove(row.id);
        const latest = daysRef.current.get(date);
        if (latest && !Object.keys(latest.data).length) {
          const next = new Map(daysRef.current);
          next.delete(date);
          commitDays(next);
        }
        return;
      }
      const res = row.id ? await api.ledgerDays.update(row.id, { data: payload }) : await api.ledgerDays.create({ date, data: payload });
      // Con el id guardado, pero sin pisar lo que se haya escrito mientras tanto
      commitDays(new Map(daysRef.current).set(date, { ...res, data: daysRef.current.get(date)?.data ?? res.data }));
    });
  }

  function saveMonth(patch: Partial<AdminLedgerMonth>) {
    const m = monthRef.current;
    commitMonth({ ...(m ?? { id: '', month: period.from, cash_carry: null, bank_carry: null, cash_adjust: null, bank_adjust: null, note: null }), ...patch });
    enqueue(`month:${period.from}`, async () => {
      const cur = monthRef.current!;
      const values = { cash_carry: cur.cash_carry, bank_carry: cur.bank_carry, cash_adjust: cur.cash_adjust, bank_adjust: cur.bank_adjust };
      const res = cur.id ? await api.ledgerMonths.update(cur.id, values) : await api.ledgerMonths.create({ month: period.from, ...values });
      const latest = monthRef.current!;
      commitMonth({ ...res, cash_carry: latest.cash_carry, bank_carry: latest.bank_carry, cash_adjust: latest.cash_adjust, bank_adjust: latest.bank_adjust });
    });
  }

  function addDay() {
    if (!extraDate) return toast.info('Elige el día');
    if (extraDate < period.from || extraDate >= period.to) return toast.error(`Elige un día de ${period.label.toLowerCase()}`);
    if (dates.includes(extraDate)) return toast.info('Ese día ya está en la hoja');
    setAdded((a) => [...a, extraDate]);
    setExtraDate('');
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  // ---------- Tabla de las noches ----------

  /** Columnas de gastos que se ven: las de los grupos desplegados, o el total del grupo */
  type ExpenseCol = { kind: 'col'; group: LedgerGroup; col: LedgerColumn } | { kind: 'group'; group: LedgerGroup };
  const expenseCols = EXPENSE_GROUPS.flatMap((g): ExpenseCol[] =>
    open.includes(g.key) ? g.columns.map((col) => ({ kind: 'col', group: g, col })) : [{ kind: 'group', group: g }],
  );
  const th = 'whitespace-nowrap px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3';
  const td = 'px-1 py-0.5';
  const num = 'tabular whitespace-nowrap px-2 py-1.5 text-right text-[13px]';
  // Columna fija al deslizar la tabla a los lados
  const stickyCol = 'sticky left-0 z-[1] border-r border-r-line bg-[rgb(var(--surface)/0.97)]';
  const groupStart = (i: number) => i > 0 && expenseCols[i - 1].group !== expenseCols[i].group;

  const amountCell = (date: string, c: LedgerColumn) => {
    const d = days.get(date);
    return c.text ? (
      <TextInput value={String(d?.data?.[c.key] ?? '')} onSave={(t) => saveCell(date, c.key, t)} placeholder="Concepto" />
    ) : (
      <AmountInput value={cellAmount(d, c.key) || null} onSave={(n) => saveCell(date, c.key, n)} />
    );
  };

  /** Fila de totales (de una semana o del mes) */
  const totalsRow = (label: ReactNode, list: string[], className?: string) => {
    const ds = list.map((d) => days.get(d));
    const s = (f: (d: AdminLedgerDay | undefined) => number) => ds.reduce((n, d) => n + f(d), 0);
    return (
      <tr className={className}>
        <td className={cx(stickyCol, 'whitespace-nowrap px-3 py-1.5 text-[12px] font-semibold leading-tight text-ink-2')}>{label}</td>
        {INCOME_COLUMNS.map((c) => (
          <td key={c.key} className={num}>
            {c.text ? '' : total(s((d) => cellAmount(d, c.key)))}
          </td>
        ))}
        <td className={cx(num, 'font-semibold text-green')}>{total(s(dayIncome))}</td>
        {expenseCols.map((e, i) => (
          <td key={e.kind === 'col' ? e.col.key : e.group.key} className={cx(num, groupStart(i) && 'border-l border-line')}>
            {e.kind === 'col' ? (e.col.text ? '' : total(s((d) => cellAmount(d, e.col.key)))) : total(s((d) => dayGroup(d, e.group)))}
          </td>
        ))}
        <td className={cx(num, 'font-semibold text-orange')}>{total(s(dayExpenses))}</td>
      </tr>
    );
  };

  const cash = { carry: month?.cash_carry ?? 0, net: sheet.cashNet, adjust: month?.cash_adjust ?? 0, final: sheet.cashFinal };
  const bank = { carry: month?.bank_carry ?? 0, net: sheet.bankNet, adjust: month?.bank_adjust ?? 0, final: sheet.bankFinal };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
        <StatCard label="Ingresos" value={fmtMoney(sheet.income)} sub={`Efectivo ${fmtMoney(sheet.cashIn)} · Banco ${fmtMoney(sheet.bankIn)}`} />
        <StatCard label="Gastos" value={fmtMoney(sheet.expenses)} sub={sheet.income ? `${fmtShare(sheet.expenses, sheet.income)} de los ingresos` : undefined} />
        <StatCard
          label="Ingresos - gastos"
          value={<span className={sheet.result >= 0 ? 'text-green' : 'text-red'}>{fmtMoney(sheet.result)}</span>}
          sub={sheet.income ? `Margen ${fmtShare(sheet.result, sheet.income)}` : undefined}
        />
        <StatCard label="Efectivo al cierre" value={fmtMoney(cash.final)} sub={`Banco al cierre ${fmtMoney(bank.final)}`} />
      </div>

      <Card className="mt-4 overflow-hidden lg:mt-5">
        <CardHeader
          title="Noches"
          subtitle="Escribe los importes en cada casilla: se guardan solos. Pulsa un grupo de gastos para ver sus columnas."
          action={
            <Button variant="secondary" size="sm" icon={<ChevronsLeftRight />} onClick={() => setOpen(allOpen ? [] : EXPENSE_GROUPS.map((g) => g.key))}>
              {allOpen ? 'Recoger gastos' : 'Desplegar gastos'}
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={cx(stickyCol, th)} />
                <th colSpan={INCOME_COLUMNS.length + 1} className={cx(th, 'border-b border-line text-left')}>
                  <span className="inline-flex items-center gap-1.5 text-green">
                    <i className="h-2 w-2 rounded-full bg-green" /> Ingresos
                  </span>
                </th>
                {EXPENSE_GROUPS.map((g, i) => {
                  const isOpen = open.includes(g.key);
                  return (
                    <th key={g.key} colSpan={isOpen ? g.columns.length : 1} className={cx(th, 'border-b border-line p-0', i === 0 ? 'border-l-2 border-l-orange/50' : 'border-l border-l-line')}>
                      <button type="button" onClick={() => toggle(g)} className="flex w-full items-center justify-center gap-1 px-2 py-2 text-orange transition hover:bg-fill">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {g.label}
                      </button>
                    </th>
                  );
                })}
                <th className={cx(th, 'border-b border-l-2 border-line border-l-orange/50')} />
              </tr>
              <tr>
                <th className={cx(stickyCol, th, 'border-b border-line text-left')}>Fecha</th>
                {INCOME_COLUMNS.map((c) => (
                  <th key={c.key} className={cx(th, 'border-b border-line', c.text ? 'min-w-[130px] text-left' : 'min-w-[92px] text-right')}>
                    {c.text ? 'Concepto rappel' : c.label}
                  </th>
                ))}
                <th className={cx(th, 'min-w-[92px] border-b border-line text-right')}>Total</th>
                {expenseCols.map((e, i) => (
                  <th
                    key={e.kind === 'col' ? e.col.key : e.group.key}
                    className={cx(th, 'border-b border-line', groupStart(i) || i === 0 ? 'border-l border-l-line' : '', e.kind === 'col' && e.col.text ? 'min-w-[130px] text-left' : 'min-w-[92px] text-right')}
                    title={e.kind === 'col' && !e.col.text ? (e.col.method === 'cash' ? 'Se paga en efectivo' : 'Se paga por banco') : undefined}
                  >
                    {e.kind === 'col' ? (e.col.text ? 'Concepto' : e.col.label) : 'Total'}
                  </th>
                ))}
                <th className={cx(th, 'min-w-[100px] border-b border-l-2 border-line border-l-orange/50 text-right')}>Total gastos</th>
              </tr>
            </thead>
            <tbody>
              {sheet.weeks.map((w, wi) => (
                <Fragment key={w.start}>
                  {w.dates.map((date) => {
                    const { weekday, day } = dayLabel(date);
                    const d = days.get(date);
                    return (
                      <tr key={date} className="group">
                        <td className={cx(stickyCol, 'whitespace-nowrap border-b border-line px-3 py-0.5 group-hover:bg-fill')}>
                          <span className="tabular text-[14px] font-semibold">{day}</span>
                          <span className="ml-1.5 text-[12px] capitalize text-ink-2">{weekday}</span>
                        </td>
                        {INCOME_COLUMNS.map((c) => (
                          <td key={c.key} className={cx(td, 'border-b border-line')}>
                            {amountCell(date, c)}
                          </td>
                        ))}
                        <td className={cx(num, 'border-b border-line font-medium')}>{total(dayIncome(d))}</td>
                        {expenseCols.map((e, i) =>
                          e.kind === 'col' ? (
                            <td key={e.col.key} className={cx(td, 'border-b border-line', (groupStart(i) || i === 0) && 'border-l border-l-line')}>
                              {amountCell(date, e.col)}
                            </td>
                          ) : (
                            <td key={e.group.key} className={cx('border-b border-line p-0', (groupStart(i) || i === 0) && 'border-l border-l-line')}>
                              <button
                                type="button"
                                onClick={() => toggle(e.group)}
                                title={`Ver las columnas de ${e.group.label}`}
                                className="tabular h-8 w-full px-2 text-right text-[13px] text-ink-2 transition hover:bg-fill"
                              >
                                {total(dayGroup(d, e.group))}
                              </button>
                            </td>
                          ),
                        )}
                        <td className={cx(num, 'border-b border-l-2 border-line border-l-orange/50 font-medium')}>{total(dayExpenses(d))}</td>
                      </tr>
                    );
                  })}
                  {totalsRow(
                    <>
                      Semana {wi + 1}
                      <span className="block text-[11px] font-normal text-ink-3">{rangeLabel(w.dates)}</span>
                    </>,
                    w.dates,
                    'bg-fill/50',
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              {totalsRow('Total mes', dates, 'bg-fill [&>td]:border-t [&>td]:border-line [&>td]:font-semibold')}
              <tr>
                <td className={cx(stickyCol, 'whitespace-nowrap px-3 py-1.5 text-[12px] font-semibold text-ink-2')}>% ingresos</td>
                {INCOME_COLUMNS.map((c) => (
                  <td key={c.key} className={cx(num, 'text-ink-2')}>
                    {c.text ? '' : fmtShare(sheet.columnTotal(c.key), sheet.income)}
                  </td>
                ))}
                <td className={cx(num, 'text-ink-2')}>{sheet.income ? '100 %' : '—'}</td>
                {expenseCols.map((e, i) => (
                  <td key={e.kind === 'col' ? e.col.key : e.group.key} className={cx(num, 'text-ink-2', groupStart(i) && 'border-l border-line')}>
                    {e.kind === 'col' ? (e.col.text ? '' : fmtShare(sheet.columnTotal(e.col.key), sheet.income)) : fmtShare(sheet.groupTotal(e.group), sheet.income)}
                  </td>
                ))}
                <td className={cx(num, 'font-semibold text-ink-2')}>{fmtShare(sheet.expenses, sheet.income)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <Input type="date" value={extraDate} min={period.from} onChange={(e) => setExtraDate(e.target.value)} className="h-9 w-auto py-0 text-[14px]" aria-label="Día que añadir" />
          <Button variant="secondary" size="sm" icon={<Plus />} onClick={addDay}>
            Añadir noche
          </Button>
          <span className="text-[12px] text-ink-3">Salen de miércoles a sábado y las noches de Noches. Para quitar una noche añadida, vacía sus casillas.</span>
        </div>
      </Card>

      {/* Resumen mensual del Excel: por semanas, el efectivo y el banco con sus arrastres */}
      <Card className="mt-4 overflow-hidden lg:mt-5">
        <CardHeader title="Resumen del mes" subtitle="Por semanas: ingresos - gastos, y lo que entra y sale del efectivo y del banco, con lo que se arrastra." />
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={cx(stickyCol, th, 'text-left')} />
                <th colSpan={3} className={cx(th, 'border-b border-line text-left')} />
                <th colSpan={4} className={cx(th, 'border-b border-l border-line text-left')}>
                  Efectivo
                </th>
                <th colSpan={4} className={cx(th, 'border-b border-l border-line text-left')}>
                  Banco
                </th>
              </tr>
              <tr>
                {['Semana', 'Ingresos', 'Gastos', 'Ingresos - gastos', 'Entra', 'Sale', 'Total', 'Arrastre', 'Entra', 'Sale', 'Total', 'Arrastre'].map((t, i) => (
                  <th key={i} className={cx(th, 'border-b border-line', i === 0 ? cx(stickyCol, 'text-left') : 'min-w-[100px] text-right', (i === 4 || i === 8) && 'border-l border-l-line')}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.weeks.map((w, wi) => (
                <tr key={w.start} className="[&>td]:border-b [&>td]:border-line">
                  <td className={cx(stickyCol, 'whitespace-nowrap px-3 py-2 text-[14px] font-medium')}>
                    Semana {wi + 1} <span className="ml-1 text-[12px] font-normal text-ink-2">{rangeLabel(w.dates)}</span>
                  </td>
                  <td className={num}>{total(w.income)}</td>
                  <td className={num}>{total(w.expenses)}</td>
                  <td className={cx(num, 'font-semibold', w.result < 0 ? 'text-red' : w.result > 0 && 'text-green')}>{total(w.result)}</td>
                  <td className={cx(num, 'border-l border-l-line')}>{total(w.cashIn)}</td>
                  <td className={num}>{total(w.cashOut)}</td>
                  <td className={num}>{total(w.cashNet)}</td>
                  <td className={cx(num, 'font-semibold')}>{fmtAmount(w.cashCarry) || '0,00'}</td>
                  <td className={cx(num, 'border-l border-l-line')}>{total(w.bankIn)}</td>
                  <td className={num}>{total(w.bankOut)}</td>
                  <td className={num}>{total(w.bankNet)}</td>
                  <td className={cx(num, 'font-semibold')}>{fmtAmount(w.bankCarry) || '0,00'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-fill [&>td]:font-semibold">
                <td className={cx(stickyCol, 'bg-fill px-3 py-2 text-[13px]')}>Total del mes</td>
                <td className={num}>{total(sheet.income)}</td>
                <td className={num}>{total(sheet.expenses)}</td>
                <td className={cx(num, sheet.result < 0 ? 'text-red' : sheet.result > 0 && 'text-green')}>{total(sheet.result)}</td>
                <td className={cx(num, 'border-l border-l-line')}>{total(sheet.cashIn)}</td>
                <td className={num}>{total(sheet.cashOut)}</td>
                <td className={num}>{total(sheet.cashNet)}</td>
                <td className={num}>{fmtAmount(sheet.cashCarry) || '0,00'}</td>
                <td className={cx(num, 'border-l border-l-line')}>{total(sheet.bankIn)}</td>
                <td className={num}>{total(sheet.bankOut)}</td>
                <td className={num}>{total(sheet.bankNet)}</td>
                <td className={num}>{fmtAmount(sheet.bankCarry) || '0,00'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Arrastre del mes anterior, ajuste y lo que queda (las casillas de abajo del Excel) */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-2 lg:gap-5">
        {(
          [
            ['Efectivo', cash, 'cash_carry', 'cash_adjust'],
            ['Banco', bank, 'bank_carry', 'bank_adjust'],
          ] as const
        ).map(([title, v, carryKey, adjustKey]) => (
          <Card key={title} className="p-5">
            <h3 className="mb-3 text-[17px] font-semibold">{title}</h3>
            <div className="divide-y divide-line text-[14px]">
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink-2">Arrastre del mes anterior</span>
                <div className="w-36">
                  <AmountInput value={month?.[carryKey]} onSave={(n) => saveMonth({ [carryKey]: n })} placeholder="0,00" className="h-9 bg-fill" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-ink-2">Total del mes</span>
                <span className="tabular font-medium">{fmtMoney(v.net)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink-2">Ajuste</span>
                <div className="w-36">
                  <AmountInput value={month?.[adjustKey]} onSave={(n) => saveMonth({ [adjustKey]: n })} placeholder="0,00" className="h-9 bg-fill" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 pt-3">
                <span className="font-semibold">Queda al cierre</span>
                <span className={cx('tabular text-[20px] font-bold', v.final < 0 ? 'text-red' : 'text-accent')}>{fmtMoney(v.final)}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-3 px-1 text-[12px] text-ink-3">
        En efectivo cuentan los ingresos en efectivo y los gastos de personal, RRPP y gastos extra; lo demás, por banco. Los porcentajes son sobre los ingresos del mes.
      </p>
    </>
  );
}

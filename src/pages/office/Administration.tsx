import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Button, ErrorBox, IconButton, Input, Loading, PageHeader } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { makePeriod } from '../../lib/dates';
import {
  cellAmount,
  computeLedger,
  dayIncome,
  EXPENSE_GROUPS,
  fmtAmount,
  fmtShare,
  fmtTotal,
  INCOME_COLUMNS,
  ledgerDates,
  parseLedgerAmount,
  type LedgerColumn,
} from '../../lib/ledger';
import type { AdminLedgerDay, AdminLedgerMonth } from '../../lib/types';
import { cx } from '../../lib/utils';

// ---------- Aspecto del Excel ----------

/** Colores de cada semana (y de su resumen), en el mismo orden que el Excel */
const WEEK_COLORS = ['#c5e3f5', '#c6efce', '#f2cfee', '#fce4d6', '#fff2cc', '#dde4f0'];
const BAND = { income: '#92d050', expenses: '#ffc000', summary: '#8ecdf0' };

const W = { date: 72, amount: 64, text: 96, total: 64, summary: 74 };
/** Ancho de una columna: lo que pida su título (en mayúsculas, a 10 px), y como mínimo el de un importe */
const widthOf = (c: LedgerColumn) => (c.text ? W.text : Math.max(W.amount, Math.ceil(c.label.length * 7.4) + 10));

const INCOME_AMOUNT_COLS = INCOME_COLUMNS.filter((c) => !c.text);
const EXPENSE_COLS = EXPENSE_GROUPS.flatMap((g) => g.columns);
/** Columnas de la hoja, de izquierda a derecha (para el ancho y el zoom) */
const COL_WIDTHS = [
  W.date,
  ...INCOME_COLUMNS.map(widthOf),
  W.total, // total
  W.total, // total semana
  ...EXPENSE_COLS.map(widthOf),
  W.summary, // total gastos
  ...Array(9).fill(W.summary), // resumen: efectivo y banco
];
const SHEET_WIDTH = COL_WIDTHS.reduce((a, b) => a + b, 0);

const ZOOM_KEY = 'vizzio.administracion.zoom';
/** En el ordenador, por defecto toda la hoja a lo ancho; en el móvil, a tamaño real (se desliza) */
const savedZoom = (): number | 'fit' => {
  const fallback = window.innerWidth >= 1024 ? 'fit' : 1;
  try {
    const v = localStorage.getItem(ZOOM_KEY);
    return v === 'fit' ? 'fit' : v && Number(v) > 0 ? Number(v) : fallback;
  } catch {
    return fallback;
  }
};

const cell = 'border border-black px-1 py-[3px] text-[11px] leading-tight';
const head = cx(cell, 'text-center font-normal uppercase');
/** Totales y resumen: centrados y en negrita, como en el Excel */
const mid = cx(cell, 'tabular text-center font-bold');

/** "5/3/2025", como en el Excel */
const sheetDate = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}/${d.slice(0, 4)}`;

// ---------- Casillas ----------

function AmountInput({ value, onSave, className, placeholder }: { value: number | null | undefined; onSave: (n: number | null) => void; className?: string; placeholder?: string }) {
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
      className={cx('tabular w-full min-w-0 bg-transparent text-[11px] text-black outline-none placeholder:text-black/35 focus:bg-white focus:ring-2 focus:ring-[#1f6feb]', className?.includes('text-center') ? '' : 'text-right', className)}
    />
  );
}

function TextInput({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      value={text ?? value}
      onFocus={() => setText(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = (text ?? '').trim();
        setText(null);
        if (t !== value) onSave(t);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="w-full min-w-0 truncate bg-transparent text-[11px] text-black outline-none focus:bg-white focus:ring-2 focus:ring-[#1f6feb]"
    />
  );
}

/** Arrastre de la primera semana: "ANTERIOR" (lo que viene del mes pasado) y "ACTUAL" */
function FirstCarry({ previous, current, onSave }: { previous: number | null | undefined; current: number; onSave: (n: number | null) => void }) {
  return (
    <div className="flex h-full flex-col text-center">
      <div className="border-b border-black py-[2px] text-[9px] uppercase">Anterior</div>
      <div className="border-b border-black px-1 py-[2px]">
        <AmountInput value={previous} onSave={onSave} className="text-center" placeholder="0" />
      </div>
      <div className="border-b border-black py-[2px] text-[9px] uppercase">Actual</div>
      <div className="flex flex-1 items-center justify-center py-[2px] font-bold">{fmtTotal(current)}</div>
    </div>
  );
}

// ---------- Página ----------

export default function Administration() {
  const { toast } = useFeedback();
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const [days, setDays] = useState<Map<string, AdminLedgerDay>>(new Map());
  const [month, setMonth] = useState<AdminLedgerMonth | null>(null);
  const [extraDate, setExtraDate] = useState('');
  const [added, setAdded] = useState<string[]>([]);
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

  // ---------- Zoom: por defecto, toda la hoja a lo ancho de la pantalla ----------
  const [zoom, setZoomState] = useState<number | 'fit'>(savedZoom);
  const setZoom = (z: number | 'fit') => {
    setZoomState(z);
    try {
      localStorage.setItem(ZOOM_KEY, String(z));
    } catch {
      /* sin almacenamiento */
    }
  };
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    setBoxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [data]);
  const fit = boxWidth ? Math.min(1, boxWidth / SHEET_WIDTH) : 1;
  const scale = zoom === 'fit' ? fit : zoom;
  const stepZoom = (dir: 1 | -1) => setZoom(Math.min(1.5, Math.max(0.1, Math.round((scale + dir * 0.1) * 10) / 10)));

  // ---------- Guardar ----------
  function enqueue(key: string, job: () => Promise<void>) {
    const next = (queue.current.get(key) ?? Promise.resolve()).then(job).catch((e) => toast.error(errorMessage(e)));
    queue.current.set(key, next);
  }

  function saveCell(date: string, key: string, value: number | string | null) {
    // Al momento en pantalla; después en la base de datos
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

  const amountCell = (date: string, c: LedgerColumn, bg: string) => {
    const d = days.get(date);
    return (
      <td key={c.key} className={cx(cell, '!px-0.5')} style={{ background: bg }}>
        {c.text ? (
          <TextInput value={String(d?.data?.[c.key] ?? '')} onSave={(t) => saveCell(date, c.key, t)} />
        ) : (
          <AmountInput value={cellAmount(d, c.key) || null} onSave={(n) => saveCell(date, c.key, n)} />
        )}
      </td>
    );
  };

  const merged = (children: ReactNode, bg: string, rows: number, extra?: string) => (
    <td rowSpan={rows} className={cx(mid, extra)} style={{ background: bg }}>
      {children}
    </td>
  );

  const sticky: CSSProperties = { position: 'sticky', left: 0, zIndex: 2, boxShadow: '1px 0 0 #000' };

  return (
    <>
      <PageHeader
        title="Administración"
        subtitle="Hoja de caja del mes, como el Excel. Escribe en las casillas: se guardan solas y los totales se calculan al momento."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker period={period} onChange={setPeriod} units={['month']} />
        <div className="flex items-center gap-1.5">
          <Input type="date" value={extraDate} min={period.from} onChange={(e) => setExtraDate(e.target.value)} className="h-9 w-auto py-0 text-[13px]" aria-label="Día que añadir" />
          <Button variant="secondary" size="sm" icon={<Plus />} onClick={addDay}>
            Añadir noche
          </Button>
        </div>
        <div className="ml-auto flex h-9 items-center gap-0.5 rounded-full bg-surface px-1 shadow-card">
          <IconButton label="Alejar" onClick={() => stepZoom(-1)}>
            <Minus />
          </IconButton>
          <span className="tabular w-12 text-center text-[13px] font-medium">{Math.round(scale * 100)} %</span>
          <IconButton label="Acercar" onClick={() => stepZoom(1)}>
            <Plus />
          </IconButton>
          <Button variant={zoom === 'fit' ? 'tinted' : 'ghost'} size="sm" icon={<Maximize2 />} onClick={() => setZoom('fit')}>
            Ver todo
          </Button>
        </div>
      </div>

      <div ref={boxRef} className="overflow-auto rounded-xl bg-white shadow-card" style={{ maxHeight: 'calc(100dvh - 210px)' }}>
        <div style={{ zoom: scale, width: SHEET_WIDTH }}>
          <table className="border-collapse bg-white text-black" style={{ tableLayout: 'fixed', width: SHEET_WIDTH, fontFamily: '"Times New Roman", Times, serif' }}>
            <colgroup>
              {COL_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="bg-white" style={sticky} />
                <th colSpan={INCOME_COLUMNS.length + 2} className={cx(head, 'font-bold')} style={{ background: BAND.income }}>
                  Ingresos
                </th>
                <th colSpan={EXPENSE_COLS.length + 1} className={cx(head, 'font-bold')} style={{ background: BAND.expenses }}>
                  Gastos
                </th>
                <th colSpan={9} className={head} style={{ background: BAND.summary }}>
                  &nbsp;
                </th>
              </tr>
              <tr>
                <th rowSpan={2} className={cx(head, 'bg-white')} style={sticky}>
                  Fecha
                </th>
                {INCOME_AMOUNT_COLS.slice(0, 3).map((c) => (
                  <th key={c.key} rowSpan={2} className={head}>
                    {c.label}
                  </th>
                ))}
                <th rowSpan={2} colSpan={2} className={head}>
                  Rappel / Definición
                </th>
                <th rowSpan={2} className={head}>
                  Total
                </th>
                <th rowSpan={2} className={head}>
                  Total semana
                </th>
                {EXPENSE_GROUPS.map((g) => (
                  <th key={g.key} colSpan={g.columns.length} className={cx(head, 'truncate')} title={g.label}>
                    {g.label}
                  </th>
                ))}
                <th rowSpan={2} className={head}>
                  Total gastos
                </th>
                <th colSpan={9} className={cx(head, 'text-right')}>
                  Resumen mensual
                </th>
              </tr>
              <tr>
                {EXPENSE_COLS.map((c) => (
                  <th key={c.key} className={cx(head, 'text-[10px]')} title={c.text ? undefined : c.method === 'cash' ? 'Se paga en efectivo' : 'Se paga por banco'}>
                    {c.label}
                  </th>
                ))}
                {['Ingresos - gastos', 'Ingreso efectivo', 'Gasto efectivo', 'Total efect', 'Arrastre', 'Ingreso banco', 'Gasto banco', 'Total banco', 'Arrastre'].map((t, i) => (
                  <th key={i} className={cx(head, 'text-[10px]')}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {sheet.weeks.map((w, wi) => {
                const bg = WEEK_COLORS[wi % WEEK_COLORS.length];
                const n = w.dates.length;
                return w.dates.map((date, di) => (
                  <tr key={date} style={{ height: 24 }}>
                    <td className={cx(cell, 'text-center')} style={{ ...sticky, background: bg }}>
                      {sheetDate(date)}
                    </td>
                    {INCOME_COLUMNS.map((c) => amountCell(date, c, bg))}
                    <td className={cx(cell, 'tabular text-center')} style={{ background: bg }}>
                      {fmtTotal(dayIncome(days.get(date)))}
                    </td>
                    {di === 0 && merged(fmtTotal(w.income), bg, n)}
                    {EXPENSE_COLS.map((c) => amountCell(date, c, bg))}
                    {di === 0 && (
                      <>
                        {merged(fmtTotal(w.expenses), bg, n)}
                        {merged(fmtTotal(w.result), bg, n)}
                        {merged(fmtTotal(w.cashIn), bg, n)}
                        {merged(fmtTotal(w.cashOut), bg, n)}
                        {merged(fmtTotal(w.cashNet), bg, n)}
                        {wi === 0 ? (
                          <td rowSpan={n} className={cx(cell, '!p-0 text-[11px]')} style={{ background: bg }}>
                            <FirstCarry previous={month?.cash_carry} current={w.cashCarry} onSave={(v) => saveMonth({ cash_carry: v })} />
                          </td>
                        ) : (
                          merged(fmtTotal(w.cashCarry), bg, n)
                        )}
                        {merged(fmtTotal(w.bankIn), bg, n)}
                        {merged(fmtTotal(w.bankOut), bg, n)}
                        {merged(fmtTotal(w.bankNet), bg, n)}
                        {wi === 0 ? (
                          <td rowSpan={n} className={cx(cell, '!p-0 text-[11px]')} style={{ background: bg }}>
                            <FirstCarry previous={month?.bank_carry} current={w.bankCarry} onSave={(v) => saveMonth({ bank_carry: v })} />
                          </td>
                        ) : (
                          merged(fmtTotal(w.bankCarry), bg, n)
                        )}
                      </>
                    )}
                  </tr>
                ));
              })}
            </tbody>

            <tfoot>
              {/* Totales del mes: los ingresos y cada grupo de gastos, en % de los ingresos */}
              <tr style={{ height: 26 }}>
                <td className="bg-white" style={sticky} />
                {INCOME_AMOUNT_COLS.map((c) => (
                  <td key={c.key} className={mid} title={`${fmtTotal(sheet.columnTotal(c.key))} €`}>
                    {fmtShare(sheet.columnTotal(c.key), sheet.income)}
                  </td>
                ))}
                <td className={cell} />
                <td className={mid}>{fmtTotal(sheet.income)}</td>
                <td />
                {EXPENSE_GROUPS.map((g) => (
                  <td key={g.key} colSpan={g.columns.length} className={mid} title={`${fmtTotal(sheet.groupTotal(g))} € · ${fmtShare(sheet.groupTotal(g), sheet.income)} de los ingresos`}>
                    {fmtShare(sheet.groupTotal(g), sheet.income)}
                    <span className="ml-1.5 font-normal opacity-60">{fmtAmount(sheet.groupTotal(g))}</span>
                  </td>
                ))}
                {[sheet.expenses, sheet.result, sheet.cashIn, sheet.cashOut, sheet.cashNet, sheet.cashCarry, sheet.bankIn, sheet.bankOut, sheet.bankNet, sheet.bankCarry].map((v, i) => (
                  <td key={i} className={mid}>
                    {fmtTotal(v)}
                  </td>
                ))}
              </tr>
              {/* Ajuste y lo que queda */}
              <tr style={{ height: 26 }}>
                <td style={sticky} className="bg-white" />
                <td colSpan={INCOME_COLUMNS.length + 2 + EXPENSE_COLS.length + 1} />
                <td className={cx(head, 'font-bold')} style={{ background: '#ffff00' }}>
                  Ajuste
                </td>
                <td colSpan={3} className={cx(cell, '!px-1')} title="Ajuste del efectivo">
                  <AmountInput value={month?.cash_adjust} onSave={(v) => saveMonth({ cash_adjust: v })} placeholder="Ajuste efectivo" />
                </td>
                <td className={cell} />
                <td colSpan={3} className={cx(cell, '!px-1')} title="Ajuste del banco">
                  <AmountInput value={month?.bank_adjust} onSave={(v) => saveMonth({ bank_adjust: v })} placeholder="Ajuste banco" />
                </td>
                <td className={cell} />
              </tr>
              <tr style={{ height: 28 }}>
                <td style={sticky} className="bg-white" />
                <td colSpan={INCOME_COLUMNS.length + 2 + EXPENSE_COLS.length + 1 + 4} />
                <td className={cx(mid, 'text-[13px]')} style={{ background: '#f4b183' }} title="Efectivo al final del mes (arrastre + ajuste)">
                  {fmtTotal(sheet.cashFinal)}
                </td>
                <td colSpan={3} />
                <td className={cx(mid, 'text-[13px]')} style={{ background: '#f4b183' }} title="Banco al final del mes (arrastre + ajuste)">
                  {fmtTotal(sheet.bankFinal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="mt-3 px-1 text-[12px] text-ink-2">
        Salen las noches de miércoles a sábado, las de Noches y las que añadas; para quitar una noche añadida, vacía sus casillas. Los porcentajes de abajo son sobre los
        ingresos del mes. En efectivo cuentan los ingresos en efectivo y los gastos de personal, RRPP y gastos extra; lo demás, por banco.
      </p>
    </>
  );
}

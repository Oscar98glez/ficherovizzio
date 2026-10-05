import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Percent, Ticket, Wine } from 'lucide-react';
import { useLoad } from '../hooks';
import { api, errorMessage } from '../lib/api';
import { computeCommissions, WEEKDAYS, type NightCommission } from '../lib/commissions';
import { businessToday, isoDate, makePeriod, periodRange } from '../lib/dates';
import { fmtHours, fmtMoney, fmtNum, fmtWeekday } from '../lib/format';
import type { CommissionRate, Employee, TicketSale } from '../lib/types';
import { entryCost, entryHours, fullName, groupBy, parseAmount, sumBy } from '../lib/utils';
import { Modal, useFeedback } from './overlay';
import { PeriodPicker } from './PeriodPicker';
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Loading, StatCard } from './ui';

const pctText = (n: number | null | undefined) => (n ? String(Number(n)).replace('.', ',') : '');
const fmtPct = (n: number) => `${fmtNum(n, 2)} %`;
const qtyText = (n: number) => fmtNum(n, 0);

/** Datos para calcular las comisiones de un periodo */
async function loadCommissionData(from: string, to: string) {
  const [rates, tickets, reservations] = await Promise.all([
    api.commissionRates.list(),
    api.ticketSales.list({ gte: ['date', from], lt: ['date', to] }),
    api.reservations.list({ gte: ['date', from], lt: ['date', to] }),
  ]);
  return { rates, tickets, reservations, commissions: computeCommissions(reservations, tickets, rates) };
}

// =====================================================================
//  Porcentajes por día de la semana
// =====================================================================

export function CommissionRatesForm({ open, onClose, rates, onSaved }: { open: boolean; onClose: () => void; rates: CommissionRate[]; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [f, setF] = useState<Record<number, { bottle: string; ticket: string }>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const byDay = new Map(rates.map((r) => [r.weekday, r]));
    setF(Object.fromEntries(WEEKDAYS.map((d) => [d.value, { bottle: pctText(byDay.get(d.value)?.bottle_pct), ticket: pctText(byDay.get(d.value)?.ticket_pct) }])));
  }, [open, rates]);

  async function submit() {
    const values = WEEKDAYS.map((d) => ({ weekday: d.value, bottle_pct: parseAmount(f[d.value]?.bottle ?? ''), ticket_pct: parseAmount(f[d.value]?.ticket ?? '') }));
    if (values.some((v) => v.bottle_pct < 0 || v.bottle_pct > 100 || v.ticket_pct < 0 || v.ticket_pct > 100)) return toast.error('Los porcentajes deben estar entre 0 y 100');
    setSaving(true);
    try {
      const byDay = new Map(rates.map((r) => [r.weekday, r]));
      await Promise.all(
        values.map((v) => {
          const current = byDay.get(v.weekday);
          if (!current) return api.commissionRates.create(v);
          if (Number(current.bottle_pct) === v.bottle_pct && Number(current.ticket_pct) === v.ticket_pct) return null;
          return api.commissionRates.update(current.id, { bottle_pct: v.bottle_pct, ticket_pct: v.ticket_pct });
        }),
      );
      toast.success('Porcentajes guardados');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const set = (day: number, k: 'bottle' | 'ticket', v: string) => setF((s) => ({ ...s, [day]: { ...s[day], [k]: v } }));

  return (
    <Modal open={open} onClose={onClose} title="Porcentajes de los RRPP" onSubmit={submit} saving={saving}>
      <p className="mb-4 text-[14px] text-ink-2">
        Lo que se lleva el RRPP de lo vendido cada noche. Se aplica el porcentaje del día de la semana de la noche (una botella de 100 € al 10 % = 10 €).
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_96px_96px] items-center gap-x-3 gap-y-2">
        <span />
        <span className="text-center text-[12px] font-semibold uppercase tracking-wide text-ink-3">Botellas</span>
        <span className="text-center text-[12px] font-semibold uppercase tracking-wide text-ink-3">Entradas</span>
        {WEEKDAYS.map((d) => (
          <div key={d.value} className="contents">
            <span className="text-[15px] font-medium">{d.label}</span>
            {(['bottle', 'ticket'] as const).map((k) => (
              <div key={k} className="relative">
                <Input
                  inputMode="decimal"
                  value={f[d.value]?.[k] ?? ''}
                  onChange={(e) => set(d.value, k, e.target.value)}
                  placeholder="0"
                  aria-label={`${d.label} · ${k === 'bottle' ? 'botellas' : 'entradas'}`}
                  className="pr-7 text-right"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-3">%</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

// =====================================================================
//  Entradas vendidas por cada RRPP en una noche
// =====================================================================

export function TicketSalesForm({ open, onClose, staff, onSaved }: { open: boolean; onClose: () => void; staff: Employee[]; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [date, setDate] = useState(() => isoDate(businessToday()));
  const [existing, setExisting] = useState<TicketSale[]>([]);
  const [rows, setRows] = useState<Record<string, { qty: string; price: string }>>({});
  const [price, setPrice] = useState('');
  const [loadingDay, setLoadingDay] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !date) return;
    let alive = true;
    setLoadingDay(true);
    api.ticketSales
      .list({ eq: { date } })
      .then((sales) => {
        if (!alive) return;
        setExisting(sales);
        const byEmp = new Map(sales.map((s) => [s.employee_id, s]));
        setRows(Object.fromEntries(staff.map((e) => [e.id, { qty: byEmp.get(e.id) ? String(byEmp.get(e.id)!.quantity) : '', price: byEmp.get(e.id) ? pctText(byEmp.get(e.id)!.unit_price) : '' }])));
        if (sales[0]) setPrice(pctText(sales[0].unit_price));
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => alive && setLoadingDay(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, staff]);

  async function submit() {
    setSaving(true);
    try {
      const byEmp = new Map(existing.map((s) => [s.employee_id, s]));
      await Promise.all(
        staff.map((e) => {
          const r = rows[e.id];
          const qty = parseInt(r?.qty ?? '', 10) || 0;
          const unit = parseAmount(r?.price || price);
          const current = byEmp.get(e.id);
          if (current && !qty) return api.ticketSales.remove(current.id);
          if (current) return current.quantity === qty && Number(current.unit_price) === unit ? null : api.ticketSales.update(current.id, { quantity: qty, unit_price: unit });
          return qty ? api.ticketSales.create({ date, employee_id: e.id, quantity: qty, unit_price: unit }) : null;
        }),
      );
      toast.success('Entradas guardadas');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (id: string, k: 'qty' | 'price', v: string) => setRows((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  return (
    <Modal open={open} onClose={onClose} title="Entradas vendidas" onSubmit={submit} saving={saving || loadingDay}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Noche">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Precio de la entrada (€)" hint="Para todos, salvo que pongas otro">
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </Field>
        </div>
        {staff.length ? (
          <div className="divide-y divide-line overflow-hidden rounded-xl bg-fill/50">
            {staff.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={fullName(e)} color={e.color} src={e.photo_url} size={32} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{fullName(e)}</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={rows[e.id]?.qty ?? ''}
                  onChange={(ev) => set(e.id, 'qty', ev.target.value)}
                  placeholder="0"
                  aria-label={`Entradas de ${fullName(e)}`}
                  className="w-20 text-right"
                />
                <Input
                  inputMode="decimal"
                  value={rows[e.id]?.price ?? ''}
                  onChange={(ev) => set(e.id, 'price', ev.target.value)}
                  placeholder={price ? `${price} €` : '€'}
                  aria-label={`Precio de ${fullName(e)}`}
                  className="w-20 text-right"
                />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No hay RRPP activos" />
        )}
        <p className="text-[12px] text-ink-3">Nº de entradas y, si es distinto, el precio. Dejar vacío o en 0 borra lo registrado esa noche.</p>
      </div>
    </Modal>
  );
}

// =====================================================================
//  Panel de la pestaña RRPP (Personal)
// =====================================================================

export function RrppPanel({ employees, onOpen }: { employees: Employee[]; onOpen: (id: string) => void }) {
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const [ratesOpen, setRatesOpen] = useState(false);
  const [ticketsOpen, setTicketsOpen] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [c, entries] = await Promise.all([loadCommissionData(period.from, period.to), api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] })]);
    return { ...c, entries };
  }, [period]);

  const rows = useMemo(() => {
    if (!data) return [];
    const byEmp = groupBy(data.entries, (e) => e.employee_id);
    return employees.map((e) => {
      const es = byEmp[e.id] ?? [];
      return { e, c: data.commissions.get(e.id), hours: sumBy(es, (x) => entryHours(x)), cost: sumBy(es, (x) => entryCost(x)) };
    });
  }, [data, employees]);

  const noRates = !!data && !data.rates.some((r) => Number(r.bottle_pct) > 0 || Number(r.ticket_pct) > 0);
  const sum = (k: 'bottles' | 'bottleSales' | 'tickets' | 'ticketSales' | 'bottleCommission' | 'ticketCommission' | 'total') => sumBy(rows, (r) => r.c?.[k] ?? 0);
  const cols = 'md:grid-cols-[minmax(0,2fr)_110px_110px_110px_110px_110px_16px]';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker period={period} onChange={setPeriod} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Percent />} onClick={() => setRatesOpen(true)} className="!h-9">
            Porcentajes por día
          </Button>
          <Button variant="secondary" size="sm" icon={<Ticket />} onClick={() => setTicketsOpen(true)} className="!h-9">
            Entradas vendidas
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : (
        <>
          {noRates && (
            <Card className="mb-4 flex flex-wrap items-center gap-3 p-4 ring-1 ring-accent/40">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                <Percent className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">Aún no has puesto los porcentajes</div>
                <div className="text-[13px] text-ink-2">Indica qué % de las botellas y de las entradas se lleva el RRPP cada día de la semana.</div>
              </div>
              <Button size="sm" onClick={() => setRatesOpen(true)}>
                Poner porcentajes
              </Button>
            </Card>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Botellas vendidas" value={qtyText(sum('bottles'))} sub={fmtMoney(sum('bottleSales'))} icon={<Wine />} tone="purple" />
            <StatCard label="Entradas vendidas" value={qtyText(sum('tickets'))} sub={fmtMoney(sum('ticketSales'))} icon={<Ticket />} tone="blue" />
            <StatCard label="Comisión botellas" value={fmtMoney(sum('bottleCommission'))} tone="orange" />
            <StatCard label="Total comisiones" value={fmtMoney(sum('total'))} sub={`Entradas ${fmtMoney(sum('ticketCommission'))}`} tone="green" />
          </div>

          <Card className="overflow-hidden">
            {rows.length ? (
              <>
                <div className={`hidden gap-4 border-b border-line px-5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3 md:grid ${cols}`}>
                  <span>RRPP</span>
                  <span className="text-right">Botellas</span>
                  <span className="text-right">Com. botellas</span>
                  <span className="text-right">Entradas</span>
                  <span className="text-right">Com. entradas</span>
                  <span className="text-right">Total</span>
                  <span />
                </div>
                <div className="divide-y divide-line">
                  {rows.map(({ e, c, hours, cost }) => (
                    <button
                      key={e.id}
                      onClick={() => onOpen(e.id)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60 md:gap-4 md:px-5 ${cols}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={fullName(e)} color={e.color} src={e.photo_url} size={40} className={e.active ? '' : 'opacity-40 grayscale'} />
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-medium">{fullName(e)}</div>
                          <div className="truncate text-[13px] text-ink-2">
                            <span className="md:hidden">
                              {qtyText(c?.bottles ?? 0)} botellas · {qtyText(c?.tickets ?? 0)} entradas
                            </span>
                            <span className="hidden md:inline">{hours > 0 ? `Fichajes ${fmtHours(hours)}${cost > 0 ? ` · ${fmtMoney(cost)}` : ''}` : e.position}</span>
                          </div>
                        </div>
                      </div>
                      <div className="tabular hidden text-right text-[14px] md:block">
                        {qtyText(c?.bottles ?? 0)}
                        <div className="text-[12px] text-ink-2">{fmtMoney(c?.bottleSales ?? 0)}</div>
                      </div>
                      <div className="tabular hidden text-right text-[14px] md:block">{fmtMoney(c?.bottleCommission ?? 0)}</div>
                      <div className="tabular hidden text-right text-[14px] md:block">
                        {qtyText(c?.tickets ?? 0)}
                        <div className="text-[12px] text-ink-2">{fmtMoney(c?.ticketSales ?? 0)}</div>
                      </div>
                      <div className="tabular hidden text-right text-[14px] md:block">{fmtMoney(c?.ticketCommission ?? 0)}</div>
                      <div className="tabular text-right text-[15px] font-semibold">{fmtMoney(c?.total ?? 0)}</div>
                      <ChevronRight className="h-4 w-4 text-ink-3" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState title="No hay RRPP" message="Los RRPP aparecen aquí cuando se registran como RRPP o tienen el departamento de Relaciones públicas." />
            )}
          </Card>
          <p className="mt-3 px-1 text-[12px] text-ink-3">
            Botellas: las de sus reservas (como RRPP) que no están canceladas ni marcadas "No vino", al precio de la carta; las de cortesía no cuentan. Entradas: las registradas en
            "Entradas vendidas". Cada noche se calcula con el porcentaje de su día de la semana.
          </p>
        </>
      )}

      {data && <CommissionRatesForm open={ratesOpen} onClose={() => setRatesOpen(false)} rates={data.rates} onSaved={reload} />}
      <TicketSalesForm open={ticketsOpen} onClose={() => setTicketsOpen(false)} staff={employees.filter((e) => e.active)} onSaved={reload} />
    </>
  );
}

// =====================================================================
//  Detalle por noches (ficha del RRPP)
// =====================================================================

export function RrppCommissionCard({ employeeId }: { employeeId: string }) {
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const { data, loading, error, reload } = useLoad(() => loadCommissionData(period.from, period.to), [period]);
  const c = data?.commissions.get(employeeId);

  return (
    <Card>
      <CardHeader title="Comisiones" subtitle="Botellas y entradas vendidas, con el % de cada día" />
      <div className="px-5 pb-3">
        <PeriodPicker period={period} onChange={setPeriod} units={['week', 'month']} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <div className="px-5 pb-5">
          <ErrorBox message={error} onRetry={reload} />
        </div>
      ) : c?.nights.length ? (
        <>
          <div className="divide-y divide-line border-t border-line">
            {c.nights.map((n: NightCommission) => (
              <div key={n.date} className="flex items-center gap-3 px-5 py-3">
                <div className="w-12 shrink-0 text-center leading-tight">
                  <div className="text-[11px] font-semibold uppercase text-ink-2">{fmtWeekday(n.date)}</div>
                  <div className="text-[17px] font-semibold">{Number(n.date.slice(8))}</div>
                </div>
                <div className="tabular min-w-0 flex-1 text-[13px] text-ink-2">
                  {n.bottles > 0 && (
                    <div className="truncate">
                      {qtyText(n.bottles)} botellas · {fmtMoney(n.bottleSales)} × {fmtPct(n.bottlePct)} = <span className="font-medium text-ink">{fmtMoney(n.bottleCommission)}</span>
                    </div>
                  )}
                  {n.tickets > 0 && (
                    <div className="truncate">
                      {qtyText(n.tickets)} entradas · {fmtMoney(n.ticketSales)} × {fmtPct(n.ticketPct)} = <span className="font-medium text-ink">{fmtMoney(n.ticketCommission)}</span>
                    </div>
                  )}
                </div>
                <div className="tabular shrink-0 text-right text-[15px] font-semibold">{fmtMoney(n.total)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line px-5 py-3.5">
            <span className="text-[15px] font-semibold">Total {period.label.toLowerCase()}</span>
            <span className="tabular text-[17px] font-semibold">{fmtMoney(c.total)}</span>
          </div>
        </>
      ) : (
        <p className="px-5 pb-5 text-[14px] text-ink-2">Sin botellas ni entradas vendidas en este periodo.</p>
      )}
    </Card>
  );
}

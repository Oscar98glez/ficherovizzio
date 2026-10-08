import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ListChecks, Percent, Ticket, Wine } from 'lucide-react';
import { useLoad } from '../hooks';
import { api, errorMessage } from '../lib/api';
import { computeCommissions, WEEKDAYS, type NightCommission, type PersonalRates } from '../lib/commissions';
import { businessToday, isoDate, makePeriod, periodRange } from '../lib/dates';
import { fmtHours, fmtMoney, fmtNum, fmtWeekday } from '../lib/format';
import type { CommissionRate, Employee, TicketSale } from '../lib/types';
import { entryCost, entryHours, fullName, groupBy, parseAmount, sumBy } from '../lib/utils';
import { Modal, useFeedback } from './overlay';
import { PeriodPicker } from './PeriodPicker';
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Loading, StatCard } from './ui';

const numText = (n: number | null | undefined) => (n ? String(Number(n)).replace('.', ',') : '');
const fmtPct = (n: number) => `${fmtNum(n, 2)} %`;
const qtyText = (n: number) => fmtNum(n, 0);

/** Datos para calcular las comisiones de un periodo */
async function loadCommissionData(from: string, to: string) {
  const [rates, tickets, reservations] = await Promise.all([
    api.commissionRates.list(),
    api.ticketSales.list({ gte: ['date', from], lt: ['date', to] }),
    api.reservations.list({ gte: ['date', from], lt: ['date', to] }),
  ]);
  return { rates, tickets, reservations };
}

/** Lo que tiene propio el RRPP, para mostrarlo en su ficha y en la lista */
export function personalRatesText(e: PersonalRates) {
  const parts = [
    e.rrpp_bottle_pct != null && `botellas ${fmtPct(Number(e.rrpp_bottle_pct))}`,
    e.rrpp_ticket_pct != null && `entradas ${fmtPct(Number(e.rrpp_ticket_pct))}`,
    e.rrpp_list_fee != null && `lista ${fmtMoney(Number(e.rrpp_list_fee))}/pers.`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// =====================================================================
//  Valores por día de la semana
// =====================================================================

type RateKey = 'bottle' | 'ticket' | 'list';
const RATE_COLUMNS: { key: RateKey; label: string; unit: string }[] = [
  { key: 'bottle', label: 'Botellas', unit: '%' },
  { key: 'ticket', label: 'Entradas', unit: '%' },
  { key: 'list', label: 'Lista', unit: '€' },
];

export function CommissionRatesForm({ open, onClose, rates, onSaved }: { open: boolean; onClose: () => void; rates: CommissionRate[]; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [f, setF] = useState<Record<number, Record<RateKey, string>>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const byDay = new Map(rates.map((r) => [r.weekday, r]));
    setF(
      Object.fromEntries(
        WEEKDAYS.map((d) => {
          const r = byDay.get(d.value);
          return [d.value, { bottle: numText(r?.bottle_pct), ticket: numText(r?.ticket_pct), list: numText(r?.list_fee) }];
        }),
      ),
    );
  }, [open, rates]);

  async function submit() {
    const values = WEEKDAYS.map((d) => ({
      weekday: d.value,
      bottle_pct: parseAmount(f[d.value]?.bottle ?? ''),
      ticket_pct: parseAmount(f[d.value]?.ticket ?? ''),
      list_fee: parseAmount(f[d.value]?.list ?? ''),
    }));
    if (values.some((v) => v.bottle_pct < 0 || v.bottle_pct > 100 || v.ticket_pct < 0 || v.ticket_pct > 100 || v.list_fee < 0))
      return toast.error('Los porcentajes deben estar entre 0 y 100');
    setSaving(true);
    try {
      const byDay = new Map(rates.map((r) => [r.weekday, r]));
      await Promise.all(
        values.map((v) => {
          const current = byDay.get(v.weekday);
          if (!current) return api.commissionRates.create(v);
          if (Number(current.bottle_pct) === v.bottle_pct && Number(current.ticket_pct) === v.ticket_pct && Number(current.list_fee ?? 0) === v.list_fee) return null;
          return api.commissionRates.update(current.id, { bottle_pct: v.bottle_pct, ticket_pct: v.ticket_pct, list_fee: v.list_fee });
        }),
      );
      toast.success('Comisiones guardadas');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const set = (day: number, k: RateKey, v: string) => setF((s) => ({ ...s, [day]: { ...s[day], [k]: v } }));

  return (
    <Modal open={open} onClose={onClose} title="Comisiones por día" onSubmit={submit} saving={saving}>
      <p className="mb-4 text-[14px] text-ink-2">
        Lo que se lleva cada RRPP cada noche, según el día de la semana: un % de las botellas y de las entradas vendidas y un importe por cada persona de su lista. Si un RRPP
        tiene valores propios en su ficha, se usan los suyos.
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,84px)] items-center gap-x-2 gap-y-2">
        <span />
        {RATE_COLUMNS.map((c) => (
          <span key={c.key} className="text-center text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            {c.label}
          </span>
        ))}
        {WEEKDAYS.map((d) => (
          <div key={d.value} className="contents">
            <span className="text-[15px] font-medium">{d.label}</span>
            {RATE_COLUMNS.map((c) => (
              <div key={c.key} className="relative">
                <Input
                  inputMode="decimal"
                  value={f[d.value]?.[c.key] ?? ''}
                  onChange={(e) => set(d.value, c.key, e.target.value)}
                  placeholder="0"
                  aria-label={`${d.label} · ${c.label}`}
                  className="pr-7 text-right"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-3">{c.unit}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-ink-3">Lista: € por cada persona que entra por la lista del RRPP.</p>
    </Modal>
  );
}

// =====================================================================
//  Entradas vendidas y personas de lista de cada RRPP en una noche
// =====================================================================

type TicketRow = { qty: string; price: string; list: string };

export function TicketSalesForm({ open, onClose, staff, onSaved }: { open: boolean; onClose: () => void; staff: Employee[]; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [date, setDate] = useState(() => isoDate(businessToday()));
  const [existing, setExisting] = useState<TicketSale[]>([]);
  const [rows, setRows] = useState<Record<string, TicketRow>>({});
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
        setRows(
          Object.fromEntries(
            staff.map((e) => {
              const s = byEmp.get(e.id);
              return [e.id, { qty: s?.quantity ? String(s.quantity) : '', price: s ? numText(s.unit_price) : '', list: s?.list_quantity ? String(s.list_quantity) : '' }];
            }),
          ),
        );
        if (sales[0]) setPrice(numText(sales[0].unit_price));
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
          const list = parseInt(r?.list ?? '', 10) || 0;
          const unit = parseAmount(r?.price || price);
          const current = byEmp.get(e.id);
          if (current && !qty && !list) return api.ticketSales.remove(current.id);
          if (current)
            return current.quantity === qty && (current.list_quantity ?? 0) === list && Number(current.unit_price) === unit
              ? null
              : api.ticketSales.update(current.id, { quantity: qty, unit_price: unit, list_quantity: list });
          return qty || list ? api.ticketSales.create({ date, employee_id: e.id, quantity: qty, unit_price: unit, list_quantity: list }) : null;
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

  const set = (id: string, k: keyof TicketRow, v: string) => setRows((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  return (
    <Modal open={open} onClose={onClose} title="Entradas y listas" onSubmit={submit} saving={saving || loadingDay}>
      <div className="space-y-4">
        {existing.some((s) => s.fourvenues_synced_at) && (
          <p className="rounded-xl bg-indigo/10 px-3 py-2 text-[13px] text-indigo">
            Las entradas de los RRPP asociados a Fourvenues se rellenan solas al sincronizar: si las cambias aquí, la próxima sincronización las vuelve a poner. La lista sí es a mano.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Noche">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Precio de la entrada (€)" hint="Para todos, salvo que pongas otro">
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </Field>
        </div>
        {staff.length ? (
          <div className="overflow-hidden rounded-xl bg-fill/50">
            <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_64px] gap-2 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              <span>RRPP</span>
              <span className="text-right">Entradas</span>
              <span className="text-right">Precio</span>
              <span className="text-right">Lista</span>
            </div>
            <div className="divide-y divide-line">
              {staff.map((e) => (
                <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_64px_64px_64px] items-center gap-2 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={fullName(e)} color={e.color} src={e.photo_url} size={30} />
                    <span className="truncate text-[15px] font-medium">{fullName(e)}</span>
                  </div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={rows[e.id]?.qty ?? ''}
                    onChange={(ev) => set(e.id, 'qty', ev.target.value)}
                    placeholder="0"
                    aria-label={`Entradas de ${fullName(e)}`}
                    className="px-2 text-right"
                  />
                  <Input
                    inputMode="decimal"
                    value={rows[e.id]?.price ?? ''}
                    onChange={(ev) => set(e.id, 'price', ev.target.value)}
                    placeholder={price || '€'}
                    aria-label={`Precio de ${fullName(e)}`}
                    className="px-2 text-right"
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={rows[e.id]?.list ?? ''}
                    onChange={(ev) => set(e.id, 'list', ev.target.value)}
                    placeholder="0"
                    aria-label={`Personas de lista de ${fullName(e)}`}
                    className="px-2 text-right"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="No hay RRPP activos" />
        )}
        <p className="text-[12px] text-ink-3">Entradas vendidas (y su precio si es distinto) y personas que han entrado por la lista de cada RRPP. Todo en 0 borra lo registrado esa noche.</p>
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
    const commissions = computeCommissions(data.reservations, data.tickets, data.rates, employees);
    const byEmp = groupBy(data.entries, (e) => e.employee_id);
    return employees.map((e) => {
      const es = byEmp[e.id] ?? [];
      return { e, c: commissions.get(e.id), hours: sumBy(es, (x) => entryHours(x)), cost: sumBy(es, (x) => entryCost(x)) };
    });
  }, [data, employees]);

  const noRates =
    !!data &&
    !data.rates.some((r) => Number(r.bottle_pct) > 0 || Number(r.ticket_pct) > 0 || Number(r.list_fee ?? 0) > 0) &&
    !employees.some((e) => personalRatesText(e));
  type Key = 'bottles' | 'bottleSales' | 'tickets' | 'ticketSales' | 'list' | 'bottleCommission' | 'ticketCommission' | 'listCommission' | 'total';
  const sum = (k: Key) => sumBy(rows, (r) => r.c?.[k] ?? 0);
  const cols = 'md:grid-cols-[minmax(0,2fr)_120px_120px_120px_110px_16px]';

  const cell = (value: number, sub: string) => (
    <div className="tabular hidden text-right md:block">
      <div className="text-[14px]">{fmtMoney(value)}</div>
      <div className="text-[12px] text-ink-2">{sub}</div>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker period={period} onChange={setPeriod} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Percent />} onClick={() => setRatesOpen(true)} className="!h-9">
            Comisiones por día
          </Button>
          <Button variant="secondary" size="sm" icon={<Ticket />} onClick={() => setTicketsOpen(true)} className="!h-9">
            Entradas y listas
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
                <div className="text-[15px] font-semibold">Aún no has puesto las comisiones</div>
                <div className="text-[13px] text-ink-2">Ponlas por día de la semana aquí o, para cada RRPP, en su ficha (Editar empleado).</div>
              </div>
              <Button size="sm" onClick={() => setRatesOpen(true)}>
                Comisiones por día
              </Button>
            </Card>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Botellas vendidas" value={qtyText(sum('bottles'))} sub={`${fmtMoney(sum('bottleSales'))} · comisión ${fmtMoney(sum('bottleCommission'))}`} icon={<Wine />} tone="purple" />
            <StatCard label="Entradas vendidas" value={qtyText(sum('tickets'))} sub={`${fmtMoney(sum('ticketSales'))} · comisión ${fmtMoney(sum('ticketCommission'))}`} icon={<Ticket />} tone="blue" />
            <StatCard label="Personas de lista" value={qtyText(sum('list'))} sub={`Comisión ${fmtMoney(sum('listCommission'))}`} icon={<ListChecks />} tone="orange" />
            <StatCard label="Total comisiones" value={fmtMoney(sum('total'))} tone="green" />
          </div>

          <Card className="overflow-hidden">
            {rows.length ? (
              <>
                <div className={`hidden gap-4 border-b border-line px-5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3 md:grid ${cols}`}>
                  <span>RRPP</span>
                  <span className="text-right">Botellas</span>
                  <span className="text-right">Entradas</span>
                  <span className="text-right">Lista</span>
                  <span className="text-right">Total</span>
                  <span />
                </div>
                <div className="divide-y divide-line">
                  {rows.map(({ e, c, hours, cost }) => {
                    const own = personalRatesText(e);
                    return (
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
                                {qtyText(c?.bottles ?? 0)} botellas · {qtyText(c?.tickets ?? 0)} entradas · {qtyText(c?.list ?? 0)} lista
                              </span>
                              <span className="hidden md:inline">
                                {own ? `Propias: ${own}` : 'Comisiones del día'}
                                {hours > 0 && ` · fichajes ${fmtHours(hours)}${cost > 0 ? ` (${fmtMoney(cost)})` : ''}`}
                              </span>
                            </div>
                          </div>
                        </div>
                        {cell(c?.bottleCommission ?? 0, `${qtyText(c?.bottles ?? 0)} uds · ${fmtMoney(c?.bottleSales ?? 0)}`)}
                        {cell(c?.ticketCommission ?? 0, `${qtyText(c?.tickets ?? 0)} uds · ${fmtMoney(c?.ticketSales ?? 0)}`)}
                        {cell(c?.listCommission ?? 0, `${qtyText(c?.list ?? 0)} personas`)}
                        <div className="tabular text-right text-[15px] font-semibold">{fmtMoney(c?.total ?? 0)}</div>
                        <ChevronRight className="h-4 w-4 text-ink-3" />
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <EmptyState title="No hay RRPP" message="Los RRPP aparecen aquí cuando se registran como RRPP o tienen el departamento de Relaciones públicas." />
            )}
          </Card>
          <p className="mt-3 px-1 text-[12px] text-ink-3">
            Botellas: las de sus reservas (como RRPP) que no están canceladas ni marcadas "No vino", al precio de la carta; las de cortesía no cuentan. Entradas y lista: las
            registradas en "Entradas y listas". Se usan las comisiones propias del RRPP (en su ficha) o, si no tiene, las del día de la semana de cada noche.
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

export function RrppCommissionCard({ employee }: { employee: Employee }) {
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const { data, loading, error, reload } = useLoad(() => loadCommissionData(period.from, period.to), [period]);
  const c = useMemo(() => (data ? computeCommissions(data.reservations, data.tickets, data.rates, [employee]).get(employee.id) : undefined), [data, employee]);
  const own = personalRatesText(employee);

  return (
    <Card>
      <CardHeader title="Comisiones" subtitle={own ? `Comisiones propias: ${own}` : 'Con las comisiones de cada día de la semana'} />
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
                  {n.list > 0 && (
                    <div className="truncate">
                      {qtyText(n.list)} de lista × {fmtMoney(n.listFee)} = <span className="font-medium text-ink">{fmtMoney(n.listCommission)}</span>
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
        <p className="px-5 pb-5 text-[14px] text-ink-2">Sin botellas, entradas ni lista en este periodo.</p>
      )}
    </Card>
  );
}

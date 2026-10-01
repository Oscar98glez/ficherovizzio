import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, Receipt } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { CONTRACTS, PAYROLL_CATEGORY } from '../../lib/constants';
import { businessDate, isoDate, makePeriod, periodRange } from '../../lib/dates';
import { fmtHours, fmtMoney } from '../../lib/format';
import type { Employee, Transaction } from '../../lib/types';
import { downloadCSV, entryCost, entryHours, fullName, groupBy, sumBy } from '../../lib/utils';

interface Row {
  e: Employee;
  hours: number;
  nights: number;
  accrued: number;
  paid: number;
  pending: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function Payroll() {
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const [busy, setBusy] = useState<string | null>(null);
  const key = period.from.slice(0, 7);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [employees, entries, payments] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] }),
      api.transactions.list({ eq: { category: PAYROLL_CATEGORY, period: key } }),
    ]);
    return { employees, entries, payments };
  }, [period]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const byEmp = groupBy(data.entries.filter((e) => e.clock_out), (e) => e.employee_id);
    const paidBy = groupBy(data.payments.filter((t) => t.employee_id), (t) => t.employee_id!);
    return data.employees
      .map((e) => {
        const es = byEmp[e.id] ?? [];
        const accrued = round2(sumBy(es, (x) => entryCost(x)));
        const paid = round2(sumBy(paidBy[e.id] ?? [], (t) => t.amount));
        return {
          e,
          hours: sumBy(es, (x) => entryHours(x)),
          nights: new Set(es.map((x) => businessDate(x.clock_in))).size,
          accrued,
          paid,
          pending: round2(Math.max(0, accrued - paid)),
        };
      })
      .filter((r) => r.accrued > 0 || r.paid > 0)
      .sort((a, b) => b.pending - a.pending || b.accrued - a.accrued);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const totals = {
    accrued: sumBy(rows, (r) => r.accrued),
    paid: sumBy(rows, (r) => r.paid),
    pending: sumBy(rows, (r) => r.pending),
    hours: sumBy(rows, (r) => r.hours),
  };
  const openEntries = data.entries.filter((e) => !e.clock_out).length;

  const payment = (r: Row): Partial<Transaction> => ({
    kind: 'expense',
    category: PAYROLL_CATEGORY,
    amount: r.pending,
    method: 'transferencia',
    date: isoDate(new Date()),
    employee_id: r.e.id,
    period: key,
    description: `Nómina ${period.label} · ${fullName(r.e)}`,
  });

  async function pay(r: Row) {
    const ok = await confirm({ title: `Pagar ${fmtMoney(r.pending)}`, message: `Se registrará el pago de la nómina de ${period.label.toLowerCase()} a ${fullName(r.e)}.`, confirmLabel: 'Pagar' });
    if (!ok) return;
    setBusy(r.e.id);
    try {
      await api.transactions.create(payment(r));
      toast.success(`Nómina de ${r.e.first_name} registrada`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function payAll() {
    const pending = rows.filter((r) => r.pending > 0);
    const ok = await confirm({
      title: `Pagar ${fmtMoney(totals.pending)}`,
      message: `Se registrarán ${pending.length} pagos de nómina de ${period.label.toLowerCase()}.`,
      confirmLabel: 'Pagar todo',
    });
    if (!ok) return;
    setBusy('all');
    try {
      await api.transactions.createMany(pending.map(payment));
      toast.success(`${pending.length} nóminas registradas`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const exportCsv = () =>
    downloadCSV(`nominas-${key}.csv`, [
      ['Empleado', 'Puesto', 'Contrato', 'Noches', 'Horas', '€/hora', 'Devengado', 'Pagado', 'Pendiente'],
      ...rows.map((r) => [fullName(r.e), r.e.position, CONTRACTS[r.e.contract_type], r.nights, round2(r.hours), r.e.hourly_rate, r.accrued, r.paid, r.pending]),
    ]);

  return (
    <>
      <PageHeader
        title="Nóminas"
        subtitle="Coste devengado por empleado según sus fichajes"
        actions={
          <>
            <Button variant="secondary" icon={<Download />} onClick={exportCsv}>
              Exportar
            </Button>
            <Button icon={<CheckCircle2 />} onClick={payAll} disabled={totals.pending <= 0} loading={busy === 'all'}>
              Pagar pendientes
            </Button>
          </>
        }
      />

      <div className="mb-5">
        <PeriodPicker period={period} onChange={setPeriod} units={['month']} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
        <StatCard label="Devengado" value={fmtMoney(totals.accrued)} sub={`${fmtHours(totals.hours)} · ${rows.length} personas`} />
        <StatCard label="Pagado" value={fmtMoney(totals.paid)} tone="green" />
        <StatCard label="Pendiente" value={<span className={totals.pending > 0 ? 'text-orange' : ''}>{fmtMoney(totals.pending)}</span>} />
        <StatCard label="Coste medio / hora" value={fmtMoney(totals.hours ? totals.accrued / totals.hours : 0)} />
      </div>

      {openEntries > 0 && (
        <p className="mb-4 rounded-xl bg-orange/10 px-4 py-2.5 text-[13px] font-medium text-orange">
          Hay {openEntries} fichaje{openEntries > 1 ? 's' : ''} abierto{openEntries > 1 ? 's' : ''} en este mes que no se incluye{openEntries > 1 ? 'n' : ''} hasta que se fiche la salida.
        </p>
      )}

      <Card className="overflow-hidden">
        {rows.length ? (
          <>
            <div className="hidden grid-cols-[minmax(0,2fr)_70px_80px_110px_110px_110px_90px] gap-4 border-b border-line px-5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3 md:grid">
              <span>Empleado</span>
              <span className="text-right">Noches</span>
              <span className="text-right">Horas</span>
              <span className="text-right">Devengado</span>
              <span className="text-right">Pagado</span>
              <span className="text-right">Pendiente</span>
              <span />
            </div>
            <div className="divide-y divide-line">
              {rows.map((r) => (
                <div key={r.e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,2fr)_70px_80px_110px_110px_110px_90px] md:gap-4 md:px-5">
                  <button onClick={() => navigate(`/personal/${r.e.id}`)} className="flex min-w-0 items-center gap-3 text-left">
                    <Avatar name={fullName(r.e)} color={r.e.color} src={r.e.photo_url} size={36} />
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-medium">{fullName(r.e)}</div>
                      <div className="truncate text-[13px] text-ink-2">
                        <span className="md:hidden">
                          {fmtHours(r.hours)} · {fmtMoney(r.accrued)} ·{' '}
                        </span>
                        {fmtMoney(r.e.hourly_rate)}/h
                      </div>
                    </div>
                  </button>
                  <span className="tabular hidden text-right text-[14px] text-ink-2 md:block">{r.nights}</span>
                  <span className="tabular hidden text-right text-[14px] text-ink-2 md:block">{fmtHours(r.hours)}</span>
                  <span className="tabular hidden text-right text-[14px] md:block">{fmtMoney(r.accrued)}</span>
                  <span className="tabular hidden text-right text-[14px] text-green md:block">{r.paid ? fmtMoney(r.paid) : '—'}</span>
                  <span className="tabular hidden text-right text-[14px] font-semibold md:block">{r.pending ? fmtMoney(r.pending) : '—'}</span>
                  <div className="flex justify-end">
                    {r.pending > 0 ? (
                      <Button size="sm" variant="tinted" loading={busy === r.e.id} onClick={() => pay(r)}>
                        Pagar
                      </Button>
                    ) : (
                      <Badge tone="green">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Pagado
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon={<Receipt />} title="Sin nóminas este mes" message="Cuando el equipo fiche, aquí verás lo que se le debe a cada persona." />
        )}
      </Card>
    </>
  );
}

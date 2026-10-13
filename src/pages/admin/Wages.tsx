import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Clock, FileSpreadsheet, FileText, Users, Wallet } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Loading, PageHeader, StatCard } from '../../components/ui';
import { useLoad, useNow } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { makePeriod, periodRange } from '../../lib/dates';
import { fmtDate, fmtHours, fmtMoney, fmtTime } from '../../lib/format';
import { cx, sumBy } from '../../lib/utils';
import { buildWageSheet, downloadWages, EXTRA_CATEGORIES, type WageRow, type WageSectionKey } from '../../lib/wages';

const SECTION_TITLE: Record<WageSectionKey, string> = {
  camareras: 'Camareras',
  bandejas: 'Bandejas',
  dj: 'DJ y luces',
  embajadoras: 'Embajadoras',
  otros: 'Otros',
};

export default function Wages() {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const now = useNow(60_000);
  const [period, setPeriod] = useState(() => makePeriod('week'));
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const { start, end } = periodRange(period);
    const [employees, entries, profiles, transactions] = await Promise.all([
      api.employees.list({ order: ['first_name', 'asc'] }),
      api.timeEntries.list({ gte: ['clock_in', start], lt: ['clock_in', end] }),
      api.profiles.list(),
      api.transactions.list({ gte: ['date', period.from], lt: ['date', period.to] }),
    ]);
    return { employees, entries, roles: new Map(profiles.map((p) => [p.id, p.role])), transactions };
  }, [period]);

  const sheet = useMemo(() => (data ? buildWageSheet({ period, ...data, now }) : null), [data, period, now]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!sheet) return null;

  const people = [...sheet.sections.flatMap((s) => s.rows), ...sheet.doormen].filter((r) => r.hours > 0).length;
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

  const row = (r: WageRow) => {
    const worked = sheet.days.filter((d) => r.cells[d.date]);
    return (
      <button
        key={r.employee.id}
        type="button"
        onClick={() => navigate(`/personal/${r.employee.id}`)}
        className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60 active:bg-fill', !worked.length && 'opacity-55')}
      >
        <Avatar name={r.name} color={r.employee.color} src={r.employee.photo_url} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{r.name}</div>
          {worked.length ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {worked.map((d) => {
                const c = r.cells[d.date]!;
                return (
                  <span key={d.date} className="tabular rounded-md bg-fill px-1.5 py-0.5 text-[12px] text-ink-2">
                    <span className="font-medium capitalize text-ink">{fmtDate(d.date, { weekday: 'short' })}</span> {fmtTime(c.clockIn)}–
                    {c.clockOut ? fmtTime(c.clockOut) : '…'} · {fmtHours(c.hours)}
                    {c.guest && ' · invitado'}
                  </span>
                );
              })}
            </div>
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

  return (
    <>
      <PageHeader
        title="Sueldos"
        subtitle={`Sobres de la semana ${sheet.period.label}`}
        actions={
          <>
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
            label="Gastos extras"
            value={fmtMoney(sheet.extrasAmount)}
            sub={sheet.extras.length ? `${sheet.extras.length} en ${EXTRA_CATEGORIES.join(', ')}` : 'Ninguno'}
            icon={<Wallet />}
            tone="orange"
          />
        </div>

        {open > 0 && (
          <p className="mt-3 text-[13px] text-orange">
            {open === 1 ? 'Hay 1 fichaje sin salida' : `Hay ${open} fichajes sin salida`}: cuentan las horas hasta ahora.
          </p>
        )}

        <div className="mt-5 space-y-4">
          {sheet.sections.map((sec) => (
            <Card key={sec.key}>
              <CardHeader
                title={SECTION_TITLE[sec.key]}
                subtitle={`${sec.rows.filter((r) => r.hours > 0).length} con horas · ${fmtHours(sec.hours)}`}
                action={<span className="tabular text-[17px] font-semibold">{fmtMoney(sec.amount)}</span>}
              />
              {sec.rows.length ? (
                <div className="divide-y divide-line pb-2">{sec.rows.map(row)}</div>
              ) : (
                <p className="px-5 pb-5 text-[14px] text-ink-2">Nadie esta semana.</p>
              )}
            </Card>
          ))}

          {sheet.doormen.length > 0 && (
            <Card>
              <CardHeader
                title="Porteros"
                subtitle={fmtHours(sumBy(sheet.doormen, (r) => r.hours))}
                action={<span className="tabular text-[17px] font-semibold">{fmtMoney(sumBy(sheet.doormen, (r) => r.amount))}</span>}
              />
              <div className="divide-y divide-line pb-2">{sheet.doormen.map(row)}</div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Gastos extras"
              subtitle={`Gastos de ${EXTRA_CATEGORIES.join(', ')} de esas noches (en Finanzas)`}
              action={<span className="tabular text-[17px] font-semibold">{fmtMoney(sheet.extrasAmount)}</span>}
            />
            {sheet.extras.length ? (
              <div className="divide-y divide-line pb-2">
                {sheet.extras.map((x, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <Badge>{fmtDate(x.date, { weekday: 'short', day: 'numeric' })}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{x.description}</span>
                    <span className="tabular text-[15px] font-semibold">{fmtMoney(x.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin gastos extras" message="Los gastos de DJ / artistas de esas noches aparecen aquí y en el Excel." />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

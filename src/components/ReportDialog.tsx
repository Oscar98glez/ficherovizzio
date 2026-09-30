import { useEffect, useState, type ReactNode } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { addDays, addMonths, businessToday, isoDate, startOfMonth, startOfWeek } from '../lib/dates';
import { exportFinanceReport, reportDays, reportScope, PAYROLL_DETAIL_MAX_DAYS, type ReportFormat } from '../lib/report';
import { cx } from '../lib/utils';
import { Modal, useFeedback } from './overlay';
import { Field, Input } from './ui';

interface Range {
  from: string;
  to: string;
}

function presets(): { label: string; range: Range }[] {
  const today = businessToday();
  const month = startOfMonth(today);
  const quarter = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  const lastDay = (start: Date, months: number) => isoDate(addDays(addMonths(start, months), -1));
  const week = startOfWeek(today);
  return [
    { label: 'Esta semana', range: { from: isoDate(week), to: isoDate(addDays(week, 6)) } },
    { label: 'Semana anterior', range: { from: isoDate(addDays(week, -7)), to: isoDate(addDays(week, -1)) } },
    { label: 'Este mes', range: { from: isoDate(month), to: lastDay(month, 1) } },
    { label: 'Mes anterior', range: { from: isoDate(addMonths(month, -1)), to: lastDay(addMonths(month, -1), 1) } },
    { label: 'Últimos 30 días', range: { from: isoDate(addDays(today, -29)), to: isoDate(today) } },
    { label: 'Este trimestre', range: { from: isoDate(quarter), to: lastDay(quarter, 3) } },
    { label: 'Este año', range: { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` } },
  ];
}

function FormatOption({
  active,
  onClick,
  icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition',
        active ? 'border-accent bg-accent/5' : 'border-transparent bg-fill hover:bg-fill-2',
      )}
    >
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl [&_svg]:h-5 [&_svg]:w-5', active ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2 dark:bg-elevated')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[12px] leading-snug text-ink-2">{text}</span>
      </span>
    </button>
  );
}

export function ReportDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Range }) {
  const { toast } = useFeedback();
  const [range, setRange] = useState<Range>(initial);
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setRange(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = !!range.from && !!range.to && range.to >= range.from;
  const days = valid ? reportDays(range.from, range.to) : 0;
  const scope = valid ? reportScope(range.from, range.to) : 'personalizado';
  const detailed = days <= PAYROLL_DETAIL_MAX_DAYS;

  async function submit() {
    if (!range.from || !range.to) return toast.error('Indica las dos fechas');
    if (range.to < range.from) return toast.error('La fecha final no puede ser anterior a la inicial');
    setBusy(true);
    try {
      const report = await exportFinanceReport(range.from, range.to, format);
      toast.success(`Informe ${format === 'pdf' ? 'PDF' : 'Excel'} descargado · ${report.movements.length} movimientos`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Exportar informe" onSubmit={submit} submitLabel="Descargar" saving={busy}>
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Periodo</div>
          <div className="scrollbar-none -mx-5 mb-3 flex gap-2 overflow-x-auto px-5">
            {presets().map((p) => {
              const active = p.range.from === range.from && p.range.to === range.to;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setRange(p.range)}
                  className={cx(
                    'h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition',
                    active ? 'bg-accent text-on-accent' : 'bg-fill text-ink hover:bg-fill-2',
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde">
              <Input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} required />
            </Field>
            <Field label="Hasta">
              <Input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} required />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Formato</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FormatOption
              active={format === 'pdf'}
              onClick={() => setFormat('pdf')}
              icon={<FileText />}
              title="PDF"
              text="Informe listo para imprimir o enviar a tu gestoría."
            />
            <FormatOption
              active={format === 'xlsx'}
              onClick={() => setFormat('xlsx')}
              icon={<FileSpreadsheet />}
              title="Excel"
              text="Hojas con resumen, noches, personal y movimientos."
            />
          </div>
        </div>

        {valid && (
          <div className="rounded-xl bg-fill px-4 py-3 text-[13px] text-ink-2">
            <div className="mb-1 font-semibold text-ink">
              Informe {scope === 'personalizado' ? 'personalizado' : scope} · {days} {days === 1 ? 'día' : 'días'}
            </div>
            Indicadores, ingresos, gastos, resultado por noche, coste de personal y movimientos, con el beneficio del periodo al
            final.{' '}
            {detailed
              ? 'Las nóminas pagadas aparecen con el nombre de cada trabajador y su importe.'
              : `Las nóminas pagadas aparecen sólo con los totales (el detalle por trabajador se incluye en informes de ${PAYROLL_DETAIL_MAX_DAYS} días o menos).`}
          </div>
        )}
      </div>
    </Modal>
  );
}

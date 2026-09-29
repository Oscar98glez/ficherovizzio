import { ChevronLeft, ChevronRight } from 'lucide-react';
import { businessToday, isoDate, makePeriod, parseDate, periodContains, shiftPeriod, type Period, type PeriodUnit } from '../lib/dates';
import { Button, IconButton, Segmented } from './ui';

const UNIT_LABEL: Record<PeriodUnit, string> = { week: 'Semana', month: 'Mes', year: 'Año' };

export function PeriodPicker({
  period,
  onChange,
  units = ['week', 'month', 'year'],
}: {
  period: Period;
  onChange: (p: Period) => void;
  units?: PeriodUnit[];
}) {
  const today = businessToday();
  const isCurrent = periodContains(period, isoDate(today));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {units.length > 1 && (
        <Segmented
          value={period.unit}
          onChange={(u) => onChange(makePeriod(u, isCurrent ? today : parseDate(period.from)))}
          options={units.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
        />
      )}
      <div className="flex h-9 items-center rounded-full bg-surface px-0.5 shadow-card">
        <IconButton label="Anterior" onClick={() => onChange(shiftPeriod(period, -1))}>
          <ChevronLeft />
        </IconButton>
        <span className="tabular min-w-[150px] px-1 text-center text-[14px] font-semibold">{period.label}</span>
        <IconButton label="Siguiente" onClick={() => onChange(shiftPeriod(period, 1))}>
          <ChevronRight />
        </IconButton>
      </div>
      {!isCurrent && (
        <Button variant="tinted" size="sm" onClick={() => onChange(makePeriod(period.unit, today))}>
          Hoy
        </Button>
      )}
    </div>
  );
}

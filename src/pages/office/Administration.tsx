import { useState } from 'react';
import { PeriodPicker } from '../../components/PeriodPicker';
import { PageHeader, Segmented } from '../../components/ui';
import { makePeriod, parseDate } from '../../lib/dates';
import { LedgerMonth } from './LedgerMonth';
import { LedgerYear } from './LedgerYear';

type View = 'year' | 'month';

const VIEW_KEY = 'vizzio.administracion.vista';
const savedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'year' ? 'year' : 'month';
  } catch {
    return 'month';
  }
};

/**
 * Apartado de los administrativos: la hoja de caja de cada mes y el resumen del año
 * (las hojas de los meses y la de INICIO de su Excel).
 */
export default function Administration() {
  const [view, setViewState] = useState<View>(savedView);
  const [month, setMonth] = useState(() => makePeriod('month'));
  const [year, setYear] = useState(() => makePeriod('year'));
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  return (
    <>
      <PageHeader
        title="Administración"
        subtitle={view === 'year' ? 'Resumen del año: ingresos, gastos y resultado de cada mes.' : 'Caja del mes: ingresos y gastos de cada noche, el resumen por semanas y el cierre.'}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'Mes' },
            { value: 'year', label: 'Año' },
          ]}
        />
        {view === 'year' ? (
          <PeriodPicker period={year} onChange={setYear} units={['year']} />
        ) : (
          <PeriodPicker period={month} onChange={setMonth} units={['month']} />
        )}
      </div>

      {view === 'year' ? (
        <LedgerYear
          period={year}
          onOpenMonth={(m) => {
            setMonth(makePeriod('month', parseDate(m)));
            setView('month');
            window.scrollTo({ top: 0 });
          }}
        />
      ) : (
        <LedgerMonth period={month} />
      )}
    </>
  );
}

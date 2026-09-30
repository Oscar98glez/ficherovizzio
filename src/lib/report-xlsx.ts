import ExcelJS from 'exceljs';
import { APP_NAME } from './config';
import { periodLabel, reportFileName, reportTitle, type Amount, type FinanceReport } from './report';
import { downloadBlob, groupBy } from './utils';

const MONEY = '#,##0.00 "€";[Red]-#,##0.00 "€"';
const PCT = '0.0%';
const HOURS = '0.0" h"';
const DATE = 'dd/mm/yyyy';

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F7' } };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDF0' } };
const HAIRLINE: Partial<ExcelJS.Borders> = { bottom: { style: 'thin', color: { argb: 'FFD1D1D6' } } };

/** Fecha sin hora: se usa UTC para que Excel no la desplace un día por la zona horaria. */
const excelDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const col = (n: number) => String.fromCharCode(64 + n);

type Fmt = 'money' | 'pct' | 'hours' | 'date' | 'int' | undefined;
const FORMATS: Record<Exclude<Fmt, undefined>, string> = { money: MONEY, pct: PCT, hours: HOURS, date: DATE, int: '0' };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FF6E6E73' }, size: 10 };
    c.fill = HEAD_FILL;
    c.border = HAIRLINE;
    c.alignment = { vertical: 'middle' };
  });
  row.height = 20;
}

function styleTotal(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true };
    c.fill = TOTAL_FILL;
  });
}

/**
 * Escribe una tabla a partir de `startRow` y devuelve la siguiente fila libre.
 * `sum` indica las columnas (1-based) que llevan total con fórmula SUMA.
 */
function writeTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  headers: string[],
  rows: (string | number | Date | ExcelJS.CellFormulaValue | null)[][],
  formats: Fmt[],
  sum: number[] = [],
) {
  const head = ws.getRow(startRow);
  head.values = headers;
  styleHeader(head);
  formats.forEach((f, i) => {
    if (f === 'money' || f === 'pct' || f === 'hours' || f === 'int') head.getCell(i + 1).alignment = { horizontal: 'right', vertical: 'middle' };
  });

  rows.forEach((values, i) => {
    const row = ws.getRow(startRow + 1 + i);
    row.values = values;
    formats.forEach((f, j) => f && (row.getCell(j + 1).numFmt = FORMATS[f]));
    row.eachCell((c) => (c.border = HAIRLINE));
  });

  let next = startRow + 1 + rows.length;
  if (sum.length && rows.length) {
    const first = startRow + 1;
    const last = startRow + rows.length;
    const total = ws.getRow(next);
    total.getCell(1).value = 'Total';
    for (const c of sum) {
      const cell = total.getCell(c);
      cell.value = { formula: `SUM(${col(c)}${first}:${col(c)}${last})` };
      cell.numFmt = FORMATS[formats[c - 1] ?? 'money'];
    }
    for (let c = 1; c <= headers.length; c++) total.getCell(c);
    styleTotal(total);
    next++;
  }
  return next;
}

function sectionTitle(ws: ExcelJS.Worksheet, row: number, title: string) {
  const c = ws.getCell(`A${row}`);
  c.value = title;
  c.font = { bold: true, size: 13 };
  return row + 1;
}

function amountTable(ws: ExcelJS.Worksheet, row: number, title: string, first: string, items: Amount[]) {
  row = sectionTitle(ws, row, title);
  const start = row + 1;
  const totalRow = start + items.length;
  const next = writeTable(
    ws,
    row,
    [first, 'Importe', '%'],
    items.map((x, i) => [x.label, x.value, { formula: `IF($B$${totalRow}=0,0,B${start + i}/$B$${totalRow})` }]),
    [undefined, 'money', 'pct'],
    [2],
  );
  if (items.length) {
    ws.getCell(`C${totalRow}`).value = 1;
    ws.getCell(`C${totalRow}`).numFmt = PCT;
  }
  return next + 1;
}

function freezeAndFilter(ws: ExcelJS.Worksheet, headerRow: number, columns: number, rows: number) {
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  if (rows) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows, column: columns } };
}

export async function renderReportXlsx(r: FinanceReport) {
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  wb.created = r.generatedAt;
  const t = r.totals;

  // ---------- Resumen ----------
  const ws = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FFA07C1C' } }, views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }];
  ws.getCell('A1').value = `${APP_NAME} · ${reportTitle(r)}`;
  ws.getCell('A1').font = { bold: true, size: 18 };
  ws.getCell('A2').value = `Periodo: ${periodLabel(r)}`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF3A3A3C' } };
  ws.getCell('A3').value = `Generado el ${r.generatedAt.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}`;
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF8E8E93' } };

  let row = sectionTitle(ws, 5, 'Indicadores');
  const kpis: [string, number, Fmt][] = [
    ['Ingresos', t.income, 'money'],
    ['Gastos operativos', t.expenses, 'money'],
    ['Gastos de personal (nóminas y personal)', t.staff, 'money'],
  ];
  const kpiStart = row + 1;
  const cell = { income: `B${kpiStart}`, expenses: `B${kpiStart + 1}`, staff: `B${kpiStart + 2}` };
  row = writeTable(ws, row, ['Indicador', 'Valor'], kpis.map(([k, v]) => [k, v]), [undefined, 'money']);
  kpis.forEach(([, , f], i) => (ws.getCell(`B${kpiStart + i}`).numFmt = FORMATS[f!]));
  row += 1;

  const weekly = r.scope === 'semanal';
  if (weekly) {
    // Semanal: cada apartado en una fila, con lo cobrado en efectivo y con tarjeta
    const hasOther = r.incomeBreakdown.some((x) => Math.abs(x.other) >= 0.005);
    const lastCol = hasOther ? 5 : 4;
    row = sectionTitle(ws, row, 'Ingresos por apartado');
    const start = row + 1;
    row = writeTable(
      ws,
      row,
      ['Concepto', 'Efectivo', 'Tarjeta', ...(hasOther ? ['Otros'] : []), 'Total'],
      r.incomeBreakdown.map((x, i) => [
        x.label,
        x.cash,
        x.card,
        ...(hasOther ? [x.other] : []),
        { formula: `SUM(B${start + i}:${col(lastCol - 1)}${start + i})`, result: x.total },
      ]),
      [undefined, 'money', 'money', ...(hasOther ? (['money'] as Fmt[]) : []), 'money'],
      hasOther ? [2, 3, 4, 5] : [2, 3, 4],
    );
    row += 1;
  } else {
    row = amountTable(ws, row, 'Ingresos por concepto', 'Concepto', r.incomeByCategory);
    row = amountTable(ws, row, 'Ingresos por método de cobro', 'Método', r.incomeByMethod);
  }
  // Gastos separados: operativos por un lado y de personal (nóminas y personal) por otro
  row = amountTable(ws, row, 'Gastos operativos', 'Concepto', r.operatingByCategory);
  row = amountTable(ws, row, 'Gastos de personal', 'Concepto', r.staffByCategory);

  // Semanal: detalle de los pagos al personal por persona
  const p = r.staffPayments;
  if (p.detailed && p.rows.length) {
    row = sectionTitle(ws, row, 'Detalle de pagos de personal de la semana');
    row = writeTable(
      ws,
      row,
      ['Fecha', 'Persona', 'Concepto', 'Método', 'Importe'],
      p.rows.map((x) => [excelDate(x.date), x.name, x.concept, x.method, x.amount]),
      ['date', undefined, undefined, undefined, 'money'],
      [5],
    );
    row += 1;
  }

  // Coste estimado según fichajes (informativo): sólo si se usan los fichajes
  if (r.staff.length) {
    row = sectionTitle(ws, row, 'Según fichajes (informativo, no se resta del resultado)');
    const start = row + 1;
    row = writeTable(
      ws,
      row,
      ['Concepto', 'Valor'],
      [
        ['Coste estimado (horas × tarifa)', Math.round(t.accrued * 100) / 100],
        ['Horas trabajadas', t.hours],
        ['Noches con personal', t.nights],
      ],
      [undefined, 'money'],
    );
    ws.getCell(`B${start + 1}`).numFmt = HOURS;
    ws.getCell(`B${start + 2}`).numFmt = '0';
    row += 1;
  }

  // ---------- Resultado del periodo (al final) ----------
  row = sectionTitle(ws, row, 'Resultado del periodo');
  const resStart = row + 1;
  row = writeTable(
    ws,
    row,
    ['Concepto', 'Importe'],
    [
      ['Ingresos', { formula: cell.income, result: t.income }],
      ['Gastos operativos', { formula: `-${cell.expenses}`, result: -t.expenses }],
      ['Gastos de personal (nóminas y personal)', { formula: `-${cell.staff}`, result: -t.staff }],
      [t.result >= 0 ? 'Beneficio' : 'Pérdida', { formula: `SUM(B${resStart}:B${resStart + 2})`, result: t.result }],
      ['Margen sobre ingresos', { formula: `IF(B${resStart}=0,0,B${resStart + 3}/B${resStart})`, result: t.margin }],
    ],
    [undefined, 'money'],
  );
  ws.getCell(`B${resStart + 4}`).numFmt = PCT;
  const resultRow = ws.getRow(resStart + 3);
  styleTotal(resultRow);
  resultRow.font = { bold: true, size: 13, color: { argb: t.result >= 0 ? 'FF24A048' : 'FFE32D24' } };
  resultRow.height = 22;
  row += 1;

  const note = ws.getCell(`A${row}`);
  note.value =
    'Resultado = ingresos - gastos operativos - gastos de personal (nóminas y personal pagados en el periodo). El coste según fichajes es informativo.';
  note.font = { size: 9, italic: true, color: { argb: 'FF8E8E93' } };

  // ---------- Resultado por día / semana / mes ----------
  const bd = r.breakdown;
  const wn = wb.addWorksheet({ day: 'Por día', week: 'Por semana', month: 'Por mes' }[bd.unit]);
  if (bd.unit === 'day') {
    wn.columns = [{ width: 13 }, { width: 30 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];
    writeTable(
      wn,
      1,
      ['Fecha', 'Noche', 'Ingresos', 'Gastos operativos', 'Gastos de personal', 'Resultado'],
      bd.rows.map((x, i) => [excelDate(x.from), x.night || null, x.income, x.expenses, x.staff, { formula: `C${i + 2}-D${i + 2}-E${i + 2}`, result: x.result }]),
      ['date', undefined, 'money', 'money', 'money', 'money'],
      [3, 4, 5, 6],
    );
    freezeAndFilter(wn, 1, 6, bd.rows.length);
  } else {
    wn.columns = [{ width: 22 }, { width: 12 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];
    writeTable(
      wn,
      1,
      [bd.unit === 'week' ? 'Semana' : 'Mes', 'Desde', 'Hasta', 'Ingresos', 'Gastos operativos', 'Gastos de personal', 'Resultado'],
      bd.rows.map((x, i) => [x.label, excelDate(x.from), excelDate(x.to), x.income, x.expenses, x.staff, { formula: `D${i + 2}-E${i + 2}-F${i + 2}`, result: x.result }]),
      [undefined, 'date', 'date', 'money', 'money', 'money', 'money'],
      [4, 5, 6, 7],
    );
    freezeAndFilter(wn, 1, 7, bd.rows.length);
  }

  // ---------- Horas según fichajes (informativo; sólo si se usan los fichajes) ----------
  if (r.staff.length) {
    const wp = wb.addWorksheet('Horas (fichajes)');
    wp.columns = [{ width: 24 }, { width: 22 }, { width: 20 }, { width: 9 }, { width: 10 }, { width: 11 }, { width: 16 }];
    writeTable(
      wp,
      1,
      ['Empleado', 'Puesto', 'Departamento', 'Noches', 'Horas', '€/hora', 'Coste estimado'],
      r.staff.map((s) => [s.name, s.position, s.department, s.nights, Math.round(s.hours * 100) / 100, s.rate, Math.round(s.cost * 100) / 100]),
      [undefined, undefined, undefined, 'int', 'hours', 'money', 'money'],
      [4, 5, 7],
    );
    freezeAndFilter(wp, 1, 7, r.staff.length);
  }

  // ---------- Movimientos ----------
  if (weekly) {
    // Semanal: agrupado por apartado, con efectivo y tarjeta por separado
    const wm = wb.addWorksheet('Movimientos por concepto');
    wm.columns = [{ width: 10 }, { width: 26 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 16 }];
    const groups = Object.values(groupBy(r.movements, (m) => `${m.kind}|${m.category}`));
    const sumMethod = (ms: typeof r.movements, method?: string) =>
      ms.filter((m) => (method ? m.method === method : m.method !== 'Efectivo' && m.method !== 'Tarjeta')).reduce((a, m) => a + m.amount, 0);
    writeTable(
      wm,
      1,
      ['Tipo', 'Concepto', 'Efectivo', 'Tarjeta', 'Otros', 'Total'],
      groups.map((ms, i) => [
        ms[0].kind === 'income' ? 'Ingreso' : 'Gasto',
        ms[0].category,
        sumMethod(ms, 'Efectivo'),
        sumMethod(ms, 'Tarjeta'),
        sumMethod(ms),
        { formula: `SUM(C${i + 2}:E${i + 2})`, result: ms.reduce((a, m) => a + m.amount, 0) },
      ]),
      [undefined, undefined, 'money', 'money', 'money', 'money'],
    );
    freezeAndFilter(wm, 1, 6, groups.length);
  } else {
    // Mensual/anual: detalle ordenado por categoría
    const wm = wb.addWorksheet('Movimientos');
    wm.columns = [{ width: 22 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 26 }, { width: 22 }, { width: 40 }];
    writeTable(
      wm,
      1,
      ['Categoría', 'Fecha', 'Tipo', 'Importe', 'Método', 'Noche', 'Empleado', 'Concepto'],
      r.movements.map((m) => [
        m.category,
        excelDate(m.date),
        m.kind === 'income' ? 'Ingreso' : 'Gasto',
        m.kind === 'income' ? m.amount : -m.amount,
        m.method,
        m.night || null,
        m.employee || null,
        m.description || null,
      ]),
      [undefined, 'date', undefined, 'money'],
      [4],
    );
    freezeAndFilter(wm, 1, 8, r.movements.length);
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(reportFileName(r, 'xlsx'), new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

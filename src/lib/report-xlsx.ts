import ExcelJS from 'exceljs';
import { APP_NAME } from './config';
import { periodLabel, reportFileName, type Amount, type FinanceReport } from './report';
import { downloadBlob } from './utils';

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
  const ws = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FF0071E3' } }, views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 10 }];
  ws.getCell('A1').value = `${APP_NAME} · Informe financiero`;
  ws.getCell('A1').font = { bold: true, size: 18 };
  ws.getCell('A2').value = `Periodo: ${periodLabel(r)}`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF3A3A3C' } };
  ws.getCell('A3').value = `Generado el ${r.generatedAt.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}`;
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF8E8E93' } };

  let row = sectionTitle(ws, 5, 'Indicadores');
  const kpis: [string, number, Fmt][] = [
    ['Ingresos', t.income, 'money'],
    ['Gastos operativos', t.expenses, 'money'],
    ['Coste de personal (fichajes)', Math.round(t.staff * 100) / 100, 'money'],
    ['Resultado', t.result, 'money'],
    ['Margen', t.margin, 'pct'],
    ['Horas trabajadas', t.hours, 'hours'],
    ['Noches con personal', t.nights, 'int'],
    ['Nóminas pagadas', t.payrollPaid, 'money'],
  ];
  const kpiStart = row + 1;
  row = writeTable(ws, row, ['Indicador', 'Valor'], kpis.map(([k, v]) => [k, v]), [undefined, 'money']);
  kpis.forEach(([, , f], i) => (ws.getCell(`B${kpiStart + i}`).numFmt = FORMATS[f!]));
  // Resultado como fórmula para que se recalcule si se editan los datos
  ws.getCell(`B${kpiStart + 3}`).value = { formula: `B${kpiStart}-B${kpiStart + 1}-B${kpiStart + 2}`, result: t.result };
  ws.getCell(`B${kpiStart + 4}`).value = { formula: `IF(B${kpiStart}=0,0,B${kpiStart + 3}/B${kpiStart})`, result: t.margin };
  ws.getRow(kpiStart + 3).font = { bold: true };
  row += 1;

  row = amountTable(ws, row, 'Ingresos por concepto', 'Concepto', r.incomeByCategory);
  row = amountTable(ws, row, 'Ingresos por método de cobro', 'Método', r.incomeByMethod);
  row = amountTable(ws, row, 'Gastos por concepto', 'Concepto', r.expenseByCategory);
  const note = ws.getCell(`A${row}`);
  note.value =
    'Resultado = ingresos - gastos operativos - coste de personal devengado (horas fichadas × tarifa). Los pagos de nóminas no se descuentan dos veces.';
  note.font = { size: 9, italic: true, color: { argb: 'FF8E8E93' } };

  // ---------- Por noche ----------
  const wn = wb.addWorksheet('Por noche');
  wn.columns = [{ width: 13 }, { width: 30 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];
  writeTable(
    wn,
    1,
    ['Fecha', 'Noche', 'Ingresos', 'Gastos', 'Personal', 'Resultado'],
    r.nights.map((n, i) => [excelDate(n.date), n.name, n.income, n.expenses, Math.round(n.staff * 100) / 100, { formula: `C${i + 2}-D${i + 2}-E${i + 2}`, result: n.result }]),
    ['date', undefined, 'money', 'money', 'money', 'money'],
    [3, 4, 5, 6],
  );
  freezeAndFilter(wn, 1, 6, r.nights.length);

  // ---------- Personal ----------
  const wp = wb.addWorksheet('Personal');
  wp.columns = [{ width: 24 }, { width: 22 }, { width: 20 }, { width: 9 }, { width: 10 }, { width: 11 }, { width: 14 }, { width: 18 }];
  writeTable(
    wp,
    1,
    ['Empleado', 'Puesto', 'Departamento', 'Noches', 'Horas', '€/hora', 'Coste', 'Nóminas pagadas'],
    r.staff.map((s) => [
      s.name,
      s.position,
      s.department,
      s.nights,
      Math.round(s.hours * 100) / 100,
      s.rate,
      Math.round(s.cost * 100) / 100,
      s.paid,
    ]),
    [undefined, undefined, undefined, 'int', 'hours', 'money', 'money', 'money'],
    [4, 5, 7, 8],
  );
  freezeAndFilter(wp, 1, 8, r.staff.length);

  // ---------- Movimientos ----------
  const wm = wb.addWorksheet('Movimientos');
  wm.columns = [{ width: 12 }, { width: 10 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 26 }, { width: 22 }, { width: 40 }];
  writeTable(
    wm,
    1,
    ['Fecha', 'Tipo', 'Categoría', 'Importe', 'Método', 'Noche', 'Empleado', 'Concepto'],
    r.movements.map((m) => [
      excelDate(m.date),
      m.kind === 'income' ? 'Ingreso' : 'Gasto',
      m.category,
      m.kind === 'income' ? m.amount : -m.amount,
      m.method,
      m.night || null,
      m.employee || null,
      m.description || null,
    ]),
    ['date', undefined, undefined, 'money'],
    [4],
  );
  freezeAndFilter(wm, 1, 8, r.movements.length);

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(reportFileName(r, 'xlsx'), new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

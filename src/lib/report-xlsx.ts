import ExcelJS from 'exceljs';
import { APP_NAME } from './config';
import { periodLabel, reportFileName, reportTitle, type Amount, type FinanceReport } from './report';
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
    ['Coste de personal (fichajes)', Math.round(t.staff * 100) / 100, 'money'],
    ['Horas trabajadas', t.hours, 'hours'],
    ['Noches con personal', t.nights, 'int'],
    ['Nóminas pagadas', r.payroll.total, 'money'],
  ];
  const kpiStart = row + 1;
  const cell = { income: `B${kpiStart}`, expenses: `B${kpiStart + 1}`, staff: `B${kpiStart + 2}` };
  row = writeTable(ws, row, ['Indicador', 'Valor'], kpis.map(([k, v]) => [k, v]), [undefined, 'money']);
  kpis.forEach(([, , f], i) => (ws.getCell(`B${kpiStart + i}`).numFmt = FORMATS[f!]));
  row += 1;

  row = amountTable(ws, row, 'Ingresos por concepto', 'Concepto', r.incomeByCategory);
  row = amountTable(ws, row, 'Ingresos por método de cobro', 'Método', r.incomeByMethod);
  row = amountTable(ws, row, 'Gastos por concepto', 'Concepto', r.expenseByCategory);

  // Nóminas: detalle por trabajador en el informe semanal; sólo totales en el resto
  const p = r.payroll;
  if (p.detailed) {
    row = sectionTitle(ws, row, 'Nóminas pagadas');
    if (p.rows.length) {
      row = writeTable(
        ws,
        row,
        ['Fecha', 'Trabajador', 'Nómina de', 'Método', 'Importe'],
        p.rows.map((x) => [excelDate(x.date), x.name, x.period, x.method, x.amount]),
        ['date', undefined, undefined, undefined, 'money'],
        [5],
      );
    } else {
      ws.getCell(`A${row}`).value = 'No se han pagado nóminas en este periodo';
      ws.getCell(`A${row}`).font = { color: { argb: 'FF8E8E93' } };
      row++;
    }
    row += 1;
  } else {
    row = sectionTitle(ws, row, 'Nóminas pagadas (totales)');
    const start = row + 1;
    row = writeTable(
      ws,
      row,
      ['Concepto', 'Valor'],
      [
        ['Total pagado', p.total],
        ['Trabajadores pagados', p.workers],
        ['Pagos realizados', p.payments],
      ],
      [undefined, 'money'],
    );
    ws.getCell(`B${start + 1}`).numFmt = '0';
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
      ['Coste de personal (fichajes)', { formula: `-${cell.staff}`, result: -Math.round(t.staff * 100) / 100 }],
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
  wp.columns = [{ width: 24 }, { width: 22 }, { width: 20 }, { width: 9 }, { width: 10 }, { width: 11 }, { width: 14 }];
  writeTable(
    wp,
    1,
    ['Empleado', 'Puesto', 'Departamento', 'Noches', 'Horas', '€/hora', 'Coste'],
    r.staff.map((s) => [s.name, s.position, s.department, s.nights, Math.round(s.hours * 100) / 100, s.rate, Math.round(s.cost * 100) / 100]),
    [undefined, undefined, undefined, 'int', 'hours', 'money', 'money'],
    [4, 5, 7],
  );
  freezeAndFilter(wp, 1, 7, r.staff.length);

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

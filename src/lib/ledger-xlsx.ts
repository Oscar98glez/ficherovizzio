/**
 * Excel de la caja de un mes, con las columnas del Excel "MODELO" de los administrativos: cada día con
 * sus ingresos y sus gastos por columna, el total de cada semana y del mes, y el efectivo y el banco
 * (lo que viene del mes anterior, lo que entra y sale, el ajuste y lo que queda). En otra hoja, todos
 * los pagos del mes con cómo se pagaron.
 */
import ExcelJS from 'exceljs';
import { fmtWeekday } from './format';
import {
  cashByMonth,
  conceptInfo,
  EXCEL_GROUP_ORDER,
  EXPENSE_GROUPS,
  INCOME_COLUMNS,
  inRange,
  monthName,
  monthWeeks,
  dayHasData,
} from './ledger';
import type { AdminLedgerDay, AdminLedgerExpense, AdminLedgerMonth } from './types';
import { downloadBlob } from './utils';

const MONEY = '#,##0.00';
const THIN: ExcelJS.Border = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BOX: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const INCOME_FILL = fill('FFE2F0D9');
const EXPENSE_FILL = fill('FFFCE4D6');
const WEEK_FILL = fill('FFFFF2CC');
const TOTAL_FILL = fill('FFD9D9D9');

/** Letra de columna (1 → A, 27 → AA) */
const L = (n: number): string => (n > 26 ? L(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));
const sumF = (col: number, rows: number[]) => (rows.length ? `SUM(${rows.map((r) => `${L(col)}${r}`).join(',')})` : '0');

export async function downloadLedgerMonth(month: string, days: AdminLedgerDay[], expenses: AdminLedgerExpense[], months: AdminLedgerMonth[]) {
  const weeks = monthWeeks(month);
  const from = weeks[0].start;
  const to = weeks[weeks.length - 1].end;
  const ownDays = days.filter((d) => inRange(d.date, from, to));
  const ownExpenses = expenses.filter((e) => inRange(e.date, from, to)).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(ownDays.map((d) => [d.date, d]));
  const cash = cashByMonth(month, months, days, expenses).get(month)!;
  const title = `${monthName(month).toUpperCase()} ${month.slice(0, 4)}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vizzio';
  const ws = wb.addWorksheet(monthName(month).toUpperCase(), { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });

  // ---------- Columnas ----------
  const incomeCols = INCOME_COLUMNS; // efectivo, banco, plataforma, rappel, definición
  const groups = EXCEL_GROUP_ORDER.map((k) => EXPENSE_GROUPS.find((g) => g.key === k)!);
  const expenseCols = groups.flatMap((g) => g.columns.map((c) => ({ g, c })));
  let col = 2; // B: fecha
  const C = {
    date: col,
    income: Object.fromEntries(incomeCols.map((c) => [c.key, ++col])) as Record<string, number>,
    incomeTotal: ++col,
    expense: {} as Record<string, number>,
    note: 0,
    expenseTotal: 0,
    result: 0,
    cashOut: 0,
    bankOut: 0,
  };
  for (const { c } of expenseCols) C.expense[c.key] = ++col;
  C.note = ++col;
  C.expenseTotal = ++col;
  C.result = ++col;
  C.cashOut = ++col;
  C.bankOut = ++col;
  const lastCol = col;

  ws.getColumn(1).width = 2;
  ws.getColumn(C.date).width = 16;
  for (let i = C.date + 1; i <= lastCol; i++) ws.getColumn(i).width = 12;
  ws.getColumn(C.income.rappel_def).width = 18;
  ws.getColumn(C.note).width = 24;

  // ---------- Cabecera ----------
  ws.getCell('B1').value = `VIZZIO · CAJA DE ${title}`;
  ws.getCell('B1').font = { bold: true, size: 14 };

  const band = (c1: number, c2: number, text: string, f: ExcelJS.Fill) => {
    if (c2 > c1) ws.mergeCells(3, c1, 3, c2);
    const cell = ws.getCell(3, c1);
    cell.value = text;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
    for (let i = c1; i <= c2; i++) {
      ws.getCell(3, i).fill = f;
      ws.getCell(3, i).border = BOX;
    }
  };
  band(C.income.efectivo, C.incomeTotal, 'INGRESOS', INCOME_FILL);
  for (const g of groups) band(C.expense[g.columns[0].key], C.expense[g.columns[g.columns.length - 1].key], g.label.toUpperCase(), EXPENSE_FILL);
  band(C.note, C.bankOut, 'RESUMEN', TOTAL_FILL);

  const head: [number, string][] = [
    [C.date, 'FECHA'],
    ...incomeCols.map((c) => [C.income[c.key], c.key === 'rappel_def' ? 'DEFINICIÓN RAPPEL' : c.label.toUpperCase()] as [number, string]),
    [C.incomeTotal, 'TOTAL'],
    ...expenseCols.map(({ c }) => [C.expense[c.key], c.label.toUpperCase()] as [number, string]),
    [C.note, 'DEFINICIÓN'],
    [C.expenseTotal, 'TOTAL GASTOS'],
    [C.result, 'INGRESOS - GASTOS'],
    [C.cashOut, 'GASTO EFECTIVO'],
    [C.bankOut, 'GASTO BANCO'],
  ];
  for (const [c, text] of head) {
    const cell = ws.getCell(4, c);
    cell.value = text;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BOX;
    cell.fill = c <= C.incomeTotal ? INCOME_FILL : c < C.note ? EXPENSE_FILL : TOTAL_FILL;
  }
  ws.getRow(4).height = 30;

  // ---------- Días y semanas ----------
  const moneyCells = (row: number, f?: ExcelJS.Fill, bold = false) => {
    for (let c = C.income.efectivo; c <= lastCol; c++) {
      const cell = ws.getCell(row, c);
      if (c !== C.income.rappel_def && c !== C.note) cell.numFmt = MONEY;
      cell.border = BOX;
      if (f) cell.fill = f;
      if (bold) cell.font = { bold: true };
    }
    ws.getCell(row, C.date).border = BOX;
    if (f) ws.getCell(row, C.date).fill = f;
    if (bold) ws.getCell(row, C.date).font = { bold: true };
  };
  const formula = (row: number, c: number, f: string) => (ws.getCell(row, c).value = { formula: f });
  const incomeAmountCols = incomeCols.filter((c) => !c.text).map((c) => C.income[c.key]);
  const expenseAmountCols = expenseCols.map(({ c }) => C.expense[c.key]);
  const numericCols = [...incomeAmountCols, C.incomeTotal, ...expenseAmountCols, C.expenseTotal, C.result, C.cashOut, C.bankOut];

  let r = 5;
  const weekRows: number[] = [];
  for (const w of weeks) {
    const dates = w.dates.filter((d) => w.nights.includes(d) || dayHasData(byDate.get(d)) || ownExpenses.some((e) => e.date === d));
    const first = r;
    for (const date of dates) {
      const day = byDate.get(date);
      const dayExp = ownExpenses.filter((e) => e.date === date);
      ws.getCell(r, C.date).value = `${fmtWeekday(date)} ${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
      for (const c of incomeCols) {
        const v = day?.data?.[c.key];
        if (v !== undefined && v !== '' && v !== 0) ws.getCell(r, C.income[c.key]).value = v;
      }
      if (day?.data?.cerrado) ws.getCell(r, C.income.rappel_def).value = 'NO SE ABRIÓ';
      const byConcept = new Map<string, number>();
      for (const e of dayExp) {
        const key = C.expense[e.concept] ? e.concept : 'gastos_extra';
        byConcept.set(key, (byConcept.get(key) ?? 0) + Number(e.amount));
      }
      for (const [k, v] of byConcept) ws.getCell(r, C.expense[k]).value = v;
      const notes = dayExp.filter((e) => e.note).map((e) => (conceptInfo(e.concept).group.key === 'otros' ? e.note : `${conceptInfo(e.concept).column.label}: ${e.note}`));
      if (notes.length) ws.getCell(r, C.note).value = notes.join(' · ');
      formula(r, C.incomeTotal, `SUM(${L(C.income.efectivo)}${r}:${L(C.income.rappel)}${r})`);
      formula(r, C.expenseTotal, `SUM(${L(expenseAmountCols[0])}${r}:${L(expenseAmountCols[expenseAmountCols.length - 1])}${r})`);
      formula(r, C.result, `${L(C.incomeTotal)}${r}-${L(C.expenseTotal)}${r}`);
      ws.getCell(r, C.cashOut).value = dayExp.filter((e) => e.method === 'cash').reduce((n, e) => n + Number(e.amount), 0) || null;
      ws.getCell(r, C.bankOut).value = dayExp.filter((e) => e.method === 'bank').reduce((n, e) => n + Number(e.amount), 0) || null;
      moneyCells(r);
      r++;
    }
    ws.getCell(r, C.date).value = `SEMANA ${w.n}`;
    for (const c of numericCols) formula(r, c, `SUM(${L(c)}${first}:${L(c)}${r - 1})`);
    moneyCells(r, WEEK_FILL, true);
    weekRows.push(r);
    r++;
  }

  const totalRow = r;
  ws.getCell(r, C.date).value = 'TOTAL MES';
  for (const c of numericCols) formula(r, c, sumF(c, weekRows));
  moneyCells(r, TOTAL_FILL, true);
  r++;
  ws.getCell(r, C.date).value = '% INGRESOS';
  for (const c of numericCols) {
    formula(r, c, `IF(${L(C.incomeTotal)}${totalRow}=0,0,${L(c)}${totalRow}/${L(C.incomeTotal)}${totalRow})`);
    ws.getCell(r, c).numFmt = '0.0%';
    ws.getCell(r, c).border = BOX;
  }
  ws.getCell(r, C.date).border = BOX;
  r += 2;

  // ---------- Efectivo y banco ----------
  const t = cash.totals;
  const lines: [string, number, number][] = [
    ['VIENE DEL MES ANTERIOR', cash.cashStart, cash.bankStart],
    ['ENTRA', t.cashIn, t.bankIn],
    ['SALE', -t.cashOut, -t.bankOut],
    ['AJUSTE', cash.cashAdjust, cash.bankAdjust],
    ['QUEDA PARA EL MES SIGUIENTE', cash.cashEnd, cash.bankEnd],
  ];
  const hc = C.income.efectivo;
  ws.getCell(r, C.date).value = 'CAJA';
  ws.getCell(r, hc).value = 'EFECTIVO';
  ws.getCell(r, hc + 1).value = 'BANCO';
  for (const c of [C.date, hc, hc + 1]) {
    ws.getCell(r, c).font = { bold: true };
    ws.getCell(r, c).fill = TOTAL_FILL;
    ws.getCell(r, c).border = BOX;
  }
  r++;
  for (const [label, a, b] of lines) {
    ws.getCell(r, C.date).value = label;
    ws.getCell(r, hc).value = Math.round(a * 100) / 100;
    ws.getCell(r, hc + 1).value = Math.round(b * 100) / 100;
    for (const c of [C.date, hc, hc + 1]) {
      ws.getCell(r, c).border = BOX;
      if (c !== C.date) ws.getCell(r, c).numFmt = MONEY;
      if (label.startsWith('QUEDA')) ws.getCell(r, c).font = { bold: true };
    }
    r++;
  }
  ws.getColumn(C.date).width = 30;

  // ---------- Pagos ----------
  const ps = wb.addWorksheet('PAGOS', { views: [{ state: 'frozen', ySplit: 1 }] });
  ps.columns = [
    { header: 'FECHA', key: 'date', width: 14 },
    { header: 'GRUPO', key: 'group', width: 18 },
    { header: 'CONCEPTO', key: 'concept', width: 22 },
    { header: 'IMPORTE', key: 'amount', width: 14, style: { numFmt: MONEY } },
    { header: 'FORMA DE PAGO', key: 'method', width: 16 },
    { header: 'NOTA', key: 'note', width: 36 },
  ];
  ps.getRow(1).font = { bold: true };
  for (const e of ownExpenses) {
    const { group, column } = conceptInfo(e.concept);
    const [y, m, d] = e.date.split('-').map(Number);
    ps.addRow({ date: new Date(Date.UTC(y, m - 1, d)), group: group.label, concept: column.label, amount: Number(e.amount), method: e.method === 'cash' ? 'Efectivo' : 'Banco', note: e.note ?? '' });
  }
  ps.getColumn('date').numFmt = 'dd/mm/yyyy';

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(`Caja ${monthName(month)} ${month.slice(0, 4)}.xlsx`, new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

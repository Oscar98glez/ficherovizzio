/**
 * Excel de los sobres de una semana, con el formato de la plantilla "SOBRES VIZZIO":
 * por cada noche H ENTRADA · H SALIDA · H TOTAL · V HORAS · TOTAL, y el TOTAL SEMANA.
 * Las horas y los totales van con fórmulas, como en la plantilla, para poder retocarlos a mano.
 */
import ExcelJS from 'exceljs';
import { downloadBlob } from './utils';
import { DOORMAN_RATE, IVA, wageFileName, type WageRow, type WageSheet } from './wages';

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8989EB' } };
const BAND_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E7FC' } };
const THIN: ExcelJS.Border = { style: 'thin', color: { argb: 'FF000000' } };
const BOX: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const MONEY = '#,##0.00 "€"';
const CLOCK = 'h:mm';
const DURATION = '[h]:mm';

const SANS = 'Arial';
const SERIF = 'Times New Roman';

/** Letra de columna (1 → A, 27 → AA) */
const L = (n: number): string => (n > 26 ? L(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

/** Hora del día (fracción de día de Excel), en la hora local */
const timeOfDay = (iso: string) => {
  const d = new Date(iso);
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
};

export async function renderWagesXlsx(s: WageSheet) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vizzio';
  wb.title = 'SOBRES VIZZIO';
  const ws = wb.addWorksheet(`SOBRES ${s.days[0].short}-${s.days[s.days.length - 1].short}`.replace(/\//g, '.'), {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
  });

  // Columnas: A nombre · 5 por noche · TOTAL SEMANA · una de margen (como en la plantilla)
  const nDays = s.days.length;
  const cIn = (i: number) => 2 + 5 * i;
  const cOut = (i: number) => 3 + 5 * i;
  const cHours = (i: number) => 4 + 5 * i;
  const cRate = (i: number) => 5 + 5 * i;
  const cTotal = (i: number) => 6 + 5 * i;
  const cWeek = 2 + 5 * nDays;
  const cLast = cWeek + 1;

  ws.getColumn(1).width = 26;
  for (let c = 2; c < cWeek; c++) ws.getColumn(c).width = 10.5;
  ws.getColumn(cWeek).width = 14;
  ws.getColumn(cLast).width = 8;

  let r = 0;
  /** Filas de tabla (con bordes) y filas en blanco entre bloques */
  const boxed = new Set<number>();

  const cell = (row: number, c: number) => ws.getCell(row, c);
  const font = (row: number, c: number, f: Partial<ExcelJS.Font>) => (cell(row, c).font = { name: SANS, size: 9, ...f });

  /** Fila de los días: MIERCOLES 8/10 · JUEVES 9/10 … */
  function dayHeader(serif = false) {
    r++;
    boxed.add(r);
    ws.getRow(r).height = 15;
    for (let c = 1; c <= cLast; c++) cell(r, c).fill = HEAD_FILL;
    s.days.forEach((d, i) => {
      ws.mergeCells(r, cIn(i), r, cTotal(i));
      const x = cell(r, cIn(i));
      x.value = `${d.name} ${d.short}`;
      x.font = { name: serif ? SERIF : SANS, size: 9, bold: true, italic: true, color: { argb: 'FF000000' } };
      x.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  /** Fila con el título del bloque (PERSONAL FIJO, GASTOS EXTRAS, PORTEROS) */
  function titleRow(title: string, columns: boolean) {
    r++;
    boxed.add(r);
    ws.getRow(r).height = 22;
    cell(r, 1).value = title;
    font(r, 1, { size: 16, bold: true, italic: true });
    cell(r, 1).alignment = { vertical: 'middle' };
    if (!columns) return;
    s.days.forEach((_, i) => {
      ['H ENTRADA', 'H SALIDA', 'H TOTAL', 'V HORAS', 'TOTAL'].forEach((h, k) => {
        cell(r, cIn(i) + k).value = h;
        font(r, cIn(i) + k, { bold: true, italic: true });
        cell(r, cIn(i) + k).alignment = { vertical: 'middle' };
      });
    });
    cell(r, cWeek).value = 'TOTAL SEMANA';
    font(r, cWeek, { bold: true });
    cell(r, cWeek).alignment = { vertical: 'middle' };
  }

  function sectionRow(label: string) {
    r++;
    boxed.add(r);
    cell(r, 1).value = label;
    font(r, 1, { bold: true });
  }

  /** Una persona (o un portero sin nombre): entrada, salida, horas, valor hora y total de cada noche */
  function personRow(name: string, row: WageRow | null, rate: number, nameFont: Partial<ExcelJS.Font> = {}) {
    r++;
    boxed.add(r);
    cell(r, 1).value = name;
    font(r, 1, nameFont);
    let week = 0;
    s.days.forEach((d, i) => {
      const c = row?.cells[d.date];
      const inRef = `${L(cIn(i))}${r}`;
      const outRef = `${L(cOut(i))}${r}`;
      if (c?.clockIn) {
        cell(r, cIn(i)).value = timeOfDay(c.clockIn);
        if (c.clockOut) cell(r, cOut(i)).value = timeOfDay(c.clockOut);
      }
      for (const k of [cIn(i), cOut(i)]) {
        cell(r, k).numFmt = CLOCK;
        font(r, k, {});
        cell(r, k).alignment = { horizontal: 'right' };
      }
      // H TOTAL: con la entrada y la salida (como en la plantilla) salvo que haya pausas o varios fichajes
      const hours = cell(r, cHours(i));
      hours.value =
        c && !c.simple
          ? c.hours / 24
          : { formula: `IF(OR(${inRef}="",${outRef}=""),0,MOD(${outRef}-${inRef},1))`, result: c ? c.hours / 24 : 0 };
      hours.numFmt = DURATION;
      hours.font = { name: SERIF, size: 9 };
      const v = cell(r, cRate(i));
      v.value = c ? c.rate : rate;
      v.numFmt = MONEY;
      v.font = { name: SANS, size: 10 };
      const amount = c?.amount ?? 0;
      week += amount;
      const t = cell(r, cTotal(i));
      // Importe fijo (extras): va tal cual, no es horas × precio
      // Con máximo por noche: MIN(horas × precio; máximo)
      const product = `${L(cHours(i))}${r}*24*${L(cRate(i))}${r}`;
      t.value = c?.fixed ? amount : { formula: c?.cap != null ? `MIN(${product},${c.cap})` : product, result: amount };
      t.numFmt = MONEY;
      t.font = { name: SERIF, size: 9 };
    });
    const w = cell(r, cWeek);
    w.value = { formula: `SUM(${s.days.map((_, i) => `${L(cTotal(i))}${r}`).join(',')})`, result: Math.round(week * 100) / 100 };
    w.numFmt = MONEY;
    w.font = { name: SERIF, size: 9 };
  }

  /** Fila TOTAL: suma de cada noche (si `perDay`) y de la semana entre las filas `from` y `to` */
  function totalRow(from: number, to: number, perDay: boolean, results: { days: number[]; week: number }) {
    r++;
    boxed.add(r);
    cell(r, 1).value = 'TOTAL';
    cell(r, 1).font = { name: SERIF, size: 9, italic: true };
    if (perDay)
      s.days.forEach((_, i) => {
        const x = cell(r, cTotal(i));
        x.value = { formula: `SUM(${L(cTotal(i))}${from}:${L(cTotal(i))}${to})`, result: results.days[i] };
        x.numFmt = MONEY;
        x.font = { name: SERIF, size: 9 };
      });
    const w = cell(r, cWeek);
    w.value = { formula: `SUM(${L(cWeek)}${from}:${L(cWeek)}${to})`, result: results.week };
    w.numFmt = MONEY;
    w.font = { name: SERIF, size: 9 };
    return r;
  }

  const sumDays = (rows: WageRow[]) => s.days.map((d) => Math.round(rows.reduce((a, x) => a + (x.cells[d.date]?.amount ?? 0), 0) * 100) / 100);

  // ---------- Personal ----------
  dayHeader();
  titleRow('PERSONAL FIJO', true);
  const staffFrom = r + 1;
  const staff = s.sections.flatMap((sec) => sec.rows);
  for (const sec of s.sections) {
    sectionRow(sec.label);
    if (!sec.rows.length) {
      r++;
      boxed.add(r);
    }
    for (const row of sec.rows) personRow(row.name, row, row.rate);
  }
  totalRow(staffFrom, r, true, { days: sumDays(staff), week: Math.round(staff.reduce((a, x) => a + x.amount, 0) * 100) / 100 });
  r += 2;

  // ---------- Gastos extras (para rellenar a mano: lo pagado de la caja no va en los sobres) ----------
  dayHeader();
  titleRow('GASTOS EXTRAS', false);
  const extrasFrom = r + 1;
  for (let k = 0; k < 6; k++) {
    r++;
    boxed.add(r);
  }
  totalRow(extrasFrom, r, false, { days: [], week: 0 });
  r += 2;

  // ---------- Porteros ----------
  dayHeader(true);
  titleRow('PORTEROS', false);
  const doorFrom = r + 1;
  s.doormen.forEach((row) => personRow(row.name, row, row.rate));
  for (let k = s.doormen.length; k < 6; k++) personRow(`PORTERO ${k + 1}`, null, DOORMAN_RATE);
  personRow('COCHES+GASOLINA', null, DOORMAN_RATE, { name: SERIF, italic: true });
  const doorTotal = totalRow(doorFrom, r, true, {
    days: sumDays(s.doormen),
    week: Math.round(s.doormen.reduce((a, x) => a + x.amount, 0) * 100) / 100,
  });
  const base = s.doormen.reduce((a, x) => a + x.amount, 0);
  const lastRate = cRate(nDays - 1);
  const lastTotal = cTotal(nDays - 1);

  // TOTAL CON IVA · IVA · TOTAL (como al pie de la plantilla)
  r++;
  const ivaRow = r + 1;
  ws.mergeCells(r, lastRate, r, lastTotal);
  cell(r, lastRate).value = 'TOTAL CON IVA';
  cell(r, lastRate).font = { name: SERIF, size: 9 };
  cell(r, lastRate).alignment = { horizontal: 'right' };
  cell(r, cWeek).value = { formula: `${L(cWeek)}${doorTotal}+${L(cWeek)}${ivaRow}`, result: Math.round(base * (1 + IVA) * 100) / 100 };
  cell(r, cWeek).numFmt = MONEY;
  cell(r, cWeek).font = { name: SANS, size: 9 };
  for (let c = lastRate; c <= cWeek; c++) cell(r, c).border = BOX;

  r++;
  cell(r, lastRate).value = 'IVA';
  cell(r, lastRate).font = { name: SERIF, size: 9 };
  cell(r, lastRate).alignment = { horizontal: 'center' };
  cell(r, lastTotal).value = IVA;
  cell(r, lastTotal).numFmt = '0.00';
  cell(r, lastTotal).font = { name: SANS, size: 9 };
  cell(r, cWeek).value = { formula: `${L(cWeek)}${doorTotal}*${L(lastTotal)}${r}`, result: Math.round(base * IVA * 100) / 100 };
  cell(r, cWeek).numFmt = MONEY;
  cell(r, cWeek).font = { name: SANS, size: 9 };
  cell(r, lastRate).border = { top: THIN };

  r++;
  cell(r, lastRate).value = 'TOTAL';
  cell(r, lastRate).font = { name: SANS, size: 9, bold: true, italic: true };
  cell(r, lastRate).alignment = { horizontal: 'center' };
  cell(r, lastTotal).value = { formula: `${L(cWeek)}${doorTotal}`, result: Math.round(base * 100) / 100 };
  cell(r, lastTotal).numFmt = MONEY;
  cell(r, lastTotal).font = { name: SANS, size: 9 };

  // ---------- Bandas, bordes ----------
  for (let row = 3; row <= r; row++) {
    for (let c = 1; c <= cLast; c++) {
      const x = cell(row, c);
      if (row % 2 === 1 && !x.fill) x.fill = BAND_FILL;
      if (boxed.has(row) && c <= cWeek && !x.border?.top) x.border = BOX;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(wageFileName(s, 'xlsx'), new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

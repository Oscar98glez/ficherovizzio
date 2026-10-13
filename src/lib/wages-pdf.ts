/**
 * PDF de los sobres de una semana, parecido a la plantilla "SOBRES VIZZIO":
 * cabecera morada con las noches, filas alternas en lila y rejilla negra.
 */
import { jsPDF } from 'jspdf';
import { autoTable, type CellInput, type RowInput } from 'jspdf-autotable';
import { fmtMoney, fmtTime } from './format';
import { dayAmount, DOORMAN_RATE, IVA, wageFileName, type WageRow, type WageSheet } from './wages';

type RGB = [number, number, number];
const HEAD: RGB = [137, 137, 235];
const BAND: RGB = [232, 231, 252];
const BLACK: RGB = [0, 0, 0];

const M = 8; // margen (mm)

/** Las fuentes estándar de PDF no tienen los espacios finos que usa Intl. */
const clean = (s: string) => s.replace(/[  ]/g, ' ');
const money = (n: number) => clean(fmtMoney(n));
/** 5,75 h → "5:45" */
const hm = (h: number) => {
  const min = Math.round(h * 60);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
};

export async function renderWagesPdf(s: WageSheet) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const nCols = 2 + 5 * s.days.length;
  const nameW = 34;
  const weekW = 17;
  const dayW = (W - 2 * M - nameW - weekW) / (5 * s.days.length);
  let y = 12;

  // ---------- Cabecera ----------
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(13);
  doc.setTextColor(...BLACK);
  doc.text('SOBRES VIZZIO', M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(clean(`Semana ${s.period.label} · generado el ${s.generatedAt.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`), W - M, y, {
    align: 'right',
  });
  y += 4;

  const columnStyles: Record<number, { cellWidth: number; halign?: 'left' | 'right' | 'center' }> = { 0: { cellWidth: nameW } };
  for (let c = 1; c < nCols - 1; c++) columnStyles[c] = { cellWidth: dayW, halign: 'right' };
  columnStyles[nCols - 1] = { cellWidth: weekW, halign: 'right' };

  const dayHead = (title: string, columns: boolean): RowInput[] => [
    [
      { content: '', styles: { fillColor: HEAD } },
      ...s.days.map((d) => ({ content: `${d.name} ${d.short}`, colSpan: 5, styles: { fillColor: HEAD, halign: 'center' as const } })),
      { content: '', styles: { fillColor: HEAD } },
    ],
    [
      { content: title, styles: { fontSize: 10, fontStyle: 'bolditalic' as const, overflow: 'visible' as const, cellPadding: { top: 1.2, bottom: 1.2, left: 0.8, right: 0.8 } } },
      ...s.days.flatMap(() =>
        (columns ? ['H ENTRADA', 'H SALIDA', 'H TOTAL', 'V HORAS', 'TOTAL'] : ['', '', '', '', '']).map((h) => ({
          content: h,
          styles: { halign: 'left' as const, fontSize: 5.6, overflow: 'linebreak' as const },
        })),
      ),
      { content: columns ? 'TOTAL SEMANA' : '', styles: { fontStyle: 'bold' as const, halign: 'left' as const, fontSize: 5.6, overflow: 'linebreak' as const } },
    ],
  ];

  /** Una persona: entrada, salida, horas, valor hora y total de cada noche, y el total de la semana */
  const personRow = (name: string, row: WageRow | null, rate: number): CellInput[] => [
    name,
    ...s.days.flatMap((d) => {
      const c = row?.cells[d.date];
      return [
        c ? fmtTime(c.clockIn) : '',
        c?.clockOut ? fmtTime(c.clockOut) : '',
        hm(c?.hours ?? 0),
        money(c ? c.rate : rate) + (c?.guest ? ' *' : ''),
        money(c?.amount ?? 0),
      ];
    }),
    money(row?.amount ?? 0),
  ];

  /** Fila TOTAL: total de cada noche (si se dan) y de la semana */
  const totalRow = (days: number[] | null, week: number): RowInput => [
    { content: 'TOTAL', styles: { font: 'times', fontStyle: 'italic' } },
    ...s.days.flatMap((_, i) => ['', '', '', '', days ? money(days[i]) : '']),
    money(week),
  ];

  const table = (head: RowInput[], body: RowInput[]) => {
    autoTable(doc, {
      startY: y,
      head,
      body,
      theme: 'grid',
      margin: { left: M, right: M },
      tableWidth: W - 2 * M,
      columnStyles,
      styles: {
        font: 'helvetica',
        fontSize: 6.2,
        textColor: BLACK,
        lineColor: BLACK,
        lineWidth: 0.1,
        cellPadding: 0.7,
        overflow: 'ellipsize',
        valign: 'middle',
      },
      headStyles: { fillColor: [255, 255, 255], textColor: BLACK, fontStyle: 'bolditalic', fontSize: 6.2 },
      bodyStyles: { fillColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: BAND },
      showHead: 'everyPage',
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  };

  // ---------- Personal ----------
  const staff = s.sections.flatMap((sec) => sec.rows);
  const body: RowInput[] = [];
  for (const sec of s.sections) {
    body.push([{ content: sec.label, colSpan: nCols, styles: { fontStyle: 'bold' } }]);
    for (const row of sec.rows) body.push(personRow(row.name, row, row.rate));
  }
  body.push(totalRow(s.days.map((d) => dayAmount(staff, d.date)), s.amount - s.doormen.reduce((a, x) => a + x.amount, 0)));
  table(dayHead('PERSONAL FIJO', true), body);

  // ---------- Gastos extras ----------
  if (s.extras.length) {
    table(dayHead('GASTOS EXTRAS', false), [
      ...s.extras.map((x): RowInput => [
        x.description,
        ...s.days.flatMap((d) => ['', '', '', '', d.date === x.date ? money(x.amount) : '']),
        money(x.amount),
      ]),
      totalRow(null, s.extrasAmount),
    ]);
  }

  // ---------- Porteros (sólo si hay personal de seguridad con fichajes) ----------
  if (s.doormen.length) {
    const base = s.doormen.reduce((a, x) => a + x.amount, 0);
    table(dayHead('PORTEROS', false), [
      ...s.doormen.map((row) => personRow(row.name, row, row.rate ?? DOORMAN_RATE)),
      totalRow(s.days.map((d) => dayAmount(s.doormen, d.date)), base),
      [{ content: `IVA ${String(IVA).replace('.', ',')} · ${money(base * IVA)}    TOTAL CON IVA`, colSpan: nCols - 1, styles: { halign: 'right' } }, money(base * (1 + IVA))],
    ]);
  }

  if (staff.some((r) => Object.values(r.cells).some((c) => c?.guest))) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('* De invitado (con su tarifa de invitado)', M, y - 2);
  }

  doc.save(wageFileName(s, 'pdf'));
}

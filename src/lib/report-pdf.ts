import { jsPDF } from 'jspdf';
import { autoTable, type CellInput, type RowInput, type UserOptions } from 'jspdf-autotable';
import { APP_NAME } from './config';
import { fmtDate, fmtHours, fmtMoney, fmtNum, fmtPercent } from './format';
import { periodLabel, reportFileName, reportTitle, type Amount, type FinanceReport } from './report';

type RGB = [number, number, number];
const INK: RGB = [29, 29, 31];
const INK2: RGB = [110, 110, 115];
const INK3: RGB = [162, 162, 168];
const LINE: RGB = [229, 229, 234];
const FILL: RGB = [245, 245, 247];
const GREEN: RGB = [36, 160, 72];
const RED: RGB = [227, 45, 36];

const M = 16; // margen lateral (mm)

/** Las fuentes estándar de PDF no tienen los espacios finos que usa Intl. */
const clean = (s: string) => s.replace(/[  ]/g, ' ');
const money = (n: number) => clean(fmtMoney(n));
const shortDate = (d: string) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });

export async function renderReportPdf(r: FinanceReport) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const contentW = W - 2 * M;
  const t = r.totals;
  let y = 0;

  const text = (s: string, x: number, yy: number, opts: { size?: number; bold?: boolean; color?: RGB; align?: 'left' | 'right' | 'center' } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(...(opts.color ?? INK));
    doc.text(clean(s), x, yy, { align: opts.align ?? 'left' });
  };

  const ensureSpace = (needed: number) => {
    if (y > H - 18 - needed) {
      doc.addPage();
      y = 20;
    }
  };

  // ---------- Cabecera ----------
  doc.setFillColor(...INK);
  doc.roundedRect(M, 13, 12, 12, 2.8, 2.8, 'F');
  text('V', M + 6, 21.6, { size: 13, bold: true, color: [90, 200, 250], align: 'center' });
  text(APP_NAME, M + 16, 18.6, { size: 16, bold: true });
  text(reportTitle(r), M + 16, 24, { size: 9, color: INK2 });

  text('PERIODO', W - M, 16.5, { size: 7, bold: true, color: INK3, align: 'right' });
  text(periodLabel(r), W - M, 21.5, { size: 10.5, bold: true, align: 'right' });
  text(`Generado el ${r.generatedAt.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}`, W - M, 26, {
    size: 7.5,
    color: INK2,
    align: 'right',
  });

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, 31, W - M, 31);

  // ---------- Indicadores ----------
  const kpiRow = (top: number, items: { label: string; value: string; color?: RGB }[], h: number, valueSize: number) => {
    const gap = 4;
    const w = (contentW - gap * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const x = M + i * (w + gap);
      doc.setFillColor(...FILL);
      doc.roundedRect(x, top, w, h, 2.5, 2.5, 'F');
      text(it.label.toUpperCase(), x + 4, top + 6, { size: 6.5, bold: true, color: INK2 });
      text(it.value, x + 4, top + h - 4.5, { size: valueSize, bold: true, color: it.color ?? INK });
    });
  };

  kpiRow(
    36,
    [
      { label: 'Ingresos', value: money(t.income), color: GREEN },
      { label: 'Gastos operativos', value: money(t.expenses) },
      { label: 'Gastos de personal', value: money(t.staff) },
    ],
    19,
    13,
  );
  y = 66;

  // ---------- Tablas ----------
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const section = (title: string, subtitle?: string) => {
    ensureSpace(27);
    text(title, M, y, { size: 12, bold: true });
    if (subtitle) text(subtitle, W - M, y, { size: 7.5, color: INK2, align: 'right' });
    y += 5;
  };

  const table = (opts: {
    head: string[];
    body: CellInput[][];
    foot?: CellInput[];
    right?: number[];
    signed?: number[];
    left?: number;
    width?: number;
    fontSize?: number;
    columnWidths?: Record<number, number>;
    empty?: string;
  }) => {
    const right = new Set(opts.right ?? []);
    const signed = new Set(opts.signed ?? []);
    const body: RowInput[] = opts.body.length
      ? opts.body
      : [[{ content: opts.empty ?? 'Sin datos en este periodo', colSpan: opts.head.length, styles: { textColor: INK3, halign: 'center' } }]];
    const options: UserOptions = {
      startY: y,
      head: [opts.head],
      body,
      foot: opts.foot && opts.body.length ? [opts.foot] : undefined,
      showFoot: 'lastPage',
      theme: 'plain',
      tableWidth: opts.width ?? 'auto',
      margin: { left: opts.left ?? M, right: opts.width ? W - (opts.left ?? M) - opts.width : M, top: 18, bottom: 18 },
      styles: {
        font: 'helvetica',
        fontSize: opts.fontSize ?? 8.5,
        textColor: INK,
        cellPadding: { top: 2.1, bottom: 2.1, left: 2.2, right: 2.2 },
        lineColor: LINE,
        lineWidth: { bottom: 0.2 },
        overflow: 'linebreak',
      },
      headStyles: { fillColor: FILL, textColor: INK2, fontStyle: 'bold', fontSize: 7, lineWidth: 0 },
      footStyles: { fillColor: FILL, textColor: INK, fontStyle: 'bold', lineWidth: 0 },
      columnStyles: Object.fromEntries(Object.entries(opts.columnWidths ?? {}).map(([k, v]) => [k, { cellWidth: v }])),
      didParseCell: (d) => {
        if (right.has(d.column.index)) d.cell.styles.halign = 'right';
        if (d.section === 'body' && signed.has(d.column.index)) {
          const s = String(d.cell.raw ?? '');
          d.cell.styles.textColor = s.startsWith('-') ? RED : GREEN;
          d.cell.styles.fontStyle = 'bold';
        }
      },
    };
    autoTable(doc, options);
    return lastY();
  };

  const pct = (v: number, total: number) => (total ? clean(fmtPercent(v / total)) : '—');
  const amountRows = (xs: Amount[], total: number) => xs.map((x) => [x.label, money(x.value), pct(x.value, total)]);

  const weekly = r.scope === 'semanal';

  if (weekly) {
    // Semanal: cada apartado en una fila, con lo cobrado en efectivo y con tarjeta
    const hasOther = r.incomeBreakdown.some((x) => Math.abs(x.other) >= 0.005);
    const sumOf = (k: 'cash' | 'card' | 'other') => r.incomeBreakdown.reduce((a, x) => a + x[k], 0);
    section('Ingresos', 'Efectivo y tarjeta por apartado');
    y = table({
      head: ['Concepto', 'Efectivo', 'Tarjeta', ...(hasOther ? ['Otros'] : []), 'Total'],
      body: r.incomeBreakdown.map((x) => [x.label, money(x.cash), money(x.card), ...(hasOther ? [money(x.other)] : []), money(x.total)]),
      foot: ['Total', money(sumOf('cash')), money(sumOf('card')), ...(hasOther ? [money(sumOf('other'))] : []), money(t.income)],
      right: hasOther ? [1, 2, 3, 4] : [1, 2, 3],
    }) + 11;
  } else {
    // Ingresos: por concepto y por método, en paralelo
    section('Ingresos');
    const half = (contentW - 6) / 2;
    const y0 = y;
    const endA = table({
      head: ['Concepto', 'Importe', '%'],
      body: amountRows(r.incomeByCategory, t.income),
      foot: ['Total', money(t.income), ''],
      right: [1, 2],
      width: half,
    });
    y = y0;
    const endB = table({
      head: ['Método de cobro', 'Importe', '%'],
      body: amountRows(r.incomeByMethod, t.income),
      foot: ['Total', money(t.income), ''],
      right: [1, 2],
      left: M + half + 6,
      width: half,
    });
    y = Math.max(endA, endB) + 11;
  }

  section('Gastos', 'Incluye los gastos de personal: nóminas y camareros');
  const totalOut = t.expenses + t.staff;
  y = table({
    head: ['Concepto', 'Importe', '%'],
    body: amountRows(r.expenseByCategory, totalOut),
    foot: ['Total', money(totalOut), ''],
    right: [1, 2],
  }) + 11;

  section('Resultado por noche');
  y = table({
    head: ['Fecha', 'Noche', 'Ingresos', 'Gastos', 'Personal', 'Resultado'],
    body: r.nights.map((n) => [shortDate(n.date), n.name, money(n.income), money(n.expenses), money(n.staff), money(n.result)]),
    foot: [
      'Total',
      `${r.nights.length} noches`,
      money(r.nights.reduce((a, n) => a + n.income, 0)),
      money(r.nights.reduce((a, n) => a + n.expenses, 0)),
      money(r.nights.reduce((a, n) => a + n.staff, 0)),
      money(r.nights.reduce((a, n) => a + n.result, 0)),
    ],
    right: [2, 3, 4, 5],
    signed: [5],
    columnWidths: { 0: 26 },
  }) + 11;

  // Gastos de personal (nóminas + camareros): detalle por persona en el semanal; sólo totales en el resto
  const p = r.staffPayments;
  if (p.detailed) {
    section('Gastos de personal', 'Nóminas y camareros pagados durante la semana');
    y = table({
      head: ['Fecha', 'Persona', 'Concepto', 'Método', 'Importe'],
      body: p.rows.map((x) => [shortDate(x.date), x.name, x.concept, x.method, money(x.amount)]),
      foot: ['Total', '', '', '', money(p.total)],
      right: [4],
      columnWidths: { 0: 26 },
      empty: 'No se han pagado nóminas ni camareros en este periodo',
    }) + 11;
  } else {
    section('Gastos de personal', 'Totales del periodo');
    ensureSpace(17);
    kpiRow(
      y,
      [
        { label: 'Nóminas', value: money(p.payroll) },
        { label: 'Camareros', value: money(p.waiters) },
        { label: 'Total gastos de personal', value: money(p.total) },
      ],
      15,
      10.5,
    );
    y += 15 + 11;
  }

  // Horas según fichajes: sólo si se usan los fichajes. Informativo, no se resta del resultado.
  if (r.staff.length) {
    section('Horas trabajadas según fichajes', 'Informativo · no se resta del resultado');
    y = table({
      head: ['Empleado', 'Puesto', 'Noches', 'Horas', '€/hora', 'Coste estimado'],
      body: r.staff.map((s) => [s.name, s.position, fmtNum(s.nights, 0), clean(fmtHours(s.hours)), money(s.rate), money(s.cost)]),
      foot: ['Total', '', '', clean(fmtHours(t.hours)), '', money(t.accrued)],
      right: [2, 3, 4, 5],
    }) + 11;
  }

  // Mensual/anual: detalle de movimientos ordenado por categoría. El semanal ya va agrupado por apartado.
  if (!weekly) {
    section('Movimientos', `${r.movements.length} registros · ordenados por categoría`);
    y = table({
      head: ['Categoría', 'Fecha', 'Método', 'Detalle', 'Importe'],
      body: r.movements.map((m) => [
        m.category,
        fmtDate(m.date, { day: '2-digit', month: '2-digit', year: '2-digit' }),
        m.method,
        [m.night, m.employee, m.description].filter(Boolean).join(' · '),
        `${m.kind === 'income' ? '' : '-'}${money(m.amount)}`,
      ]),
      right: [4],
      signed: [4],
      fontSize: 7.5,
      columnWidths: { 0: 32, 1: 17, 2: 24, 4: 26 },
    }) + 11;
  }

  // ---------- Resultado del periodo (al final) ----------
  ensureSpace(75);
  section('Resultado del periodo');
  y = table({
    head: ['Concepto', 'Importe'],
    body: [
      ['Ingresos', money(t.income)],
      ['Gastos operativos', money(-t.expenses)],
      ['Gastos de personal (nóminas y camareros)', money(-t.staff)],
    ],
    right: [1],
  }) + 4;

  const good = t.result >= 0;
  doc.setFillColor(...(good ? ([232, 246, 236] as RGB) : ([252, 234, 233] as RGB)));
  doc.roundedRect(M, y, contentW, 24, 3, 3, 'F');
  text(good ? 'BENEFICIO DEL PERIODO' : 'PÉRDIDA DEL PERIODO', M + 6, y + 8, { size: 7.5, bold: true, color: INK2 });
  text(money(t.result), M + 6, y + 18.5, { size: 20, bold: true, color: good ? GREEN : RED });
  text('MARGEN SOBRE INGRESOS', W - M - 6, y + 8, { size: 7.5, bold: true, color: INK2, align: 'right' });
  text(clean(fmtPercent(t.margin)), W - M - 6, y + 18.5, { size: 16, bold: true, color: good ? INK : RED, align: 'right' });
  y += 24 + 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...INK3);
  doc.text(
    doc.splitTextToSize(
      clean(
        'Resultado = ingresos - gastos operativos - gastos de personal (nóminas y camareros pagados en el periodo). ' +
          'El coste estimado según fichajes es informativo y no se resta. ' +
          'En el resultado por noche, "Personal" incluye los fichajes y los camareros asociados a esa noche. ' +
          'Las noches van de 06:00 a 06:00.',
      ),
      contentW,
    ),
    M,
    y,
  );

  // ---------- Pie de página ----------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, H - 12, W - M, H - 12);
    text(`${APP_NAME} · ${reportTitle(r)} · ${periodLabel(r)}`, M, H - 7.5, { size: 7, color: INK3 });
    text(`Página ${i} de ${pages}`, W - M, H - 7.5, { size: 7, color: INK3, align: 'right' });
  }

  doc.save(reportFileName(r, 'pdf'));
}

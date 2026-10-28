import { useState, type ReactNode } from 'react';
import { fmtMoney0 } from '../lib/format';
import { cx } from '../lib/utils';

export interface Series {
  name: string;
  color: string;
}

/** Barras agrupadas; al pasar el ratón se muestran los valores en la cabecera. */
export function BarChart({
  data,
  series,
  height = 190,
  format = fmtMoney0,
}: {
  data: { label: string; detail?: string; values: number[] }[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const active = hover !== null ? data[hover] : null;
  const totals = series.map((_, j) => data.reduce((a, d) => a + (d.values[j] ?? 0), 0));

  return (
    <div>
      <div className="mb-4 flex min-h-[40px] flex-wrap items-end gap-x-6 gap-y-1">
        {series.map((s, j) => (
          <div key={s.name}>
            <div className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <i className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}
              {active && <span className="text-ink-3">· {active.detail ?? active.label}</span>}
            </div>
            <div className="tabular text-[17px] font-semibold">{format(active ? active.values[j] ?? 0 : totals[j])}</div>
          </div>
        ))}
      </div>
      <div className="relative" style={{ height }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${f * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-3">
          {data.map((d, i) => (
            <div
              key={i}
              className="flex h-full flex-1 cursor-default items-end justify-center gap-[3px]"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(hover === i ? null : i)}
            >
              {d.values.map((v, j) => (
                <div
                  key={j}
                  className="w-full max-w-[20px] rounded-t-[4px] transition-all duration-300"
                  style={{
                    height: `${Math.max(v > 0 ? 1.5 : 0, (v / max) * 100)}%`,
                    background: series[j]?.color,
                    opacity: hover === null || hover === i ? 1 : 0.35,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-3">
        {data.map((d, i) => (
          <div key={i} className={cx('flex-1 truncate text-center text-[11px]', hover === i ? 'font-semibold text-ink' : 'text-ink-3')}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lista con barras horizontales proporcionales (desglose por categoría). */
export function HBarList({
  items,
  format = fmtMoney0,
  color = 'rgb(var(--accent))',
  empty,
}: {
  items: { label: ReactNode; value: number; color?: string; sub?: ReactNode }[];
  format?: (n: number) => string;
  color?: string;
  empty?: ReactNode;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!items.length) return <div className="py-6 text-center text-[14px] text-ink-3">{empty ?? 'Sin datos'}</div>;
  return (
    <div className="space-y-3.5">
      {items.map((it, idx) => (
        <div key={idx}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[14px]">
            <span className="truncate font-medium">{it.label}</span>
            <span className="tabular shrink-0 text-ink-2">
              <span className="font-semibold text-ink">{format(it.value)}</span>
              {total > 0 && <span className="ml-2 text-[12px]">{Math.round((it.value / total) * 100)}%</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fill">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Anillo con el reparto de un total; al pasar el ratón por un trozo se ve su importe en el centro. */
export function Donut({
  items,
  format = fmtMoney0,
  size = 168,
  empty,
}: {
  items: { label: string; value: number; color: string }[];
  format?: (n: number) => string;
  size?: number;
  empty?: ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((a, i) => a + Math.max(0, i.value), 0);
  if (!total) return <div className="py-6 text-center text-[14px] text-ink-3">{empty ?? 'Sin datos'}</div>;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // 2 px de hueco entre trozos (sólo si hay más de uno)
  const gap = items.filter((i) => i.value > 0).length > 1 ? 2 : 0;
  let offset = 0;
  const active = hover !== null ? items[hover] : null;
  const pct = (v: number) => `${(Math.round((v / total) * 1000) / 10).toLocaleString('es-ES')} %`;
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {items.map((it, i) => {
            const len = (Math.max(0, it.value) / total) * c;
            const seg = (
              <circle
                key={it.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={it.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                opacity={hover === null || hover === i ? 1 : 0.35}
                className="cursor-default transition-opacity"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(hover === i ? null : i)}
              />
            );
            offset += len;
            return it.value > 0 ? seg : null;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[12px] text-ink-2">{active ? active.label : 'Total'}</span>
          <span className="tabular text-[15px] font-semibold">{format(active ? active.value : total)}</span>
          {active && <span className="tabular text-[12px] text-ink-2">{pct(active.value)}</span>}
        </div>
      </div>
      <div className="w-full space-y-2.5">
        {items.map((it, i) => (
          <div
            key={it.label}
            className={cx('flex items-center justify-between gap-4 text-[14px] transition-opacity', hover !== null && hover !== i && 'opacity-50')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex items-center gap-2">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
              {it.label}
            </span>
            <span className="tabular text-ink-2">
              <span className="font-semibold text-ink">{format(it.value)}</span>
              <span className="ml-2 text-[12px]">{pct(it.value)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

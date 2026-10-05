import type { KeyboardEvent } from 'react';
import { MAP_H, MAP_W, tableNumber } from '../lib/club-map';
import { RESERVATION_STATUS } from '../lib/constants';
import type { Reservation, ReservationStatus, VipTable } from '../lib/types';

/** Color de cada estado en el plano (los libres van en gris) */
const STATUS_COLOR: Record<ReservationStatus, string> = {
  pending: 'var(--orange)',
  confirmed: 'var(--green)',
  arrived: 'var(--purple)',
  cancelled: 'var(--ink-3)',
  no_show: 'var(--red)',
};

const LEGEND: ReservationStatus[] = ['pending', 'confirmed', 'arrived'];

const WALL = {
  stroke: 'rgb(var(--ink) / 0.85)',
  strokeWidth: 3,
  fill: 'none',
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
};
const LABEL = {
  fill: 'rgb(var(--ink) / 0.85)',
  fontWeight: 500,
  textAnchor: 'middle' as const,
};

/**
 * Plano interactivo de la planta alta: cada reservado se colorea según su reserva
 * de la noche y al pulsarlo se abre la reserva (o se crea una nueva).
 */
export function ClubMap({
  tables,
  reservationByTable,
  myEmployeeId,
  onSelect,
}: {
  /** Sólo los reservados con posición en el plano */
  tables: VipTable[];
  reservationByTable: Map<string, Reservation>;
  myEmployeeId: string | null;
  onSelect: (table: VipTable, reservation?: Reservation) => void;
}) {
  const key = (t: VipTable, r?: Reservation) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(t, r);
    }
  };

  return (
    <div>
      <svg
        viewBox={`-14 -14 ${MAP_W + 28} ${MAP_H + 28}`}
        className="mx-auto block w-full max-w-[460px] select-none"
        role="group"
        aria-label="Plano de reservados"
      >
        {/* Paredes y zonas */}
        <rect x={0} y={0} width={MAP_W} height={MAP_H} rx={5} {...WALL} />
        <line x1={0} y1={156} x2={MAP_W} y2={156} {...WALL} />
        <polyline points="0,96 159,96 159,156" {...WALL} />
        <polyline points={`${MAP_W},96 327,96 327,156`} {...WALL} />
        <polyline points={`${MAP_W},231 380,231 380,505 ${MAP_W},505`} {...WALL} />
        <polyline points="0,505 126,505 126,740" {...WALL} />

        <text x={243} y={52} fontSize={24} letterSpacing={2} {...LABEL}>
          ZONA DJ
        </text>
        <text x={243} y={70} fontSize={8.5} letterSpacing={1.5} {...LABEL} fill="rgb(var(--ink) / 0.6)">
          · BOILER ROOM ·
        </text>
        <text x={66} y={490} fontSize={17} letterSpacing={1} {...LABEL}>
          ROOM 1
        </text>
        <text x={432} y={530} fontSize={17} letterSpacing={1} {...LABEL}>
          ROOM 2
        </text>
        <text x={243} y={360} fontSize={15} letterSpacing={6} {...LABEL} fill="rgb(var(--ink) / 0.18)">
          PISTA
        </text>

        {/* Reservados */}
        {tables.map((t) => {
          const r = reservationByTable.get(t.id);
          const x = t.map_x ?? 0;
          const y = t.map_y ?? 0;
          const w = t.map_w ?? 60;
          const h = t.map_h ?? 54;
          const color = r ? STATUS_COLOR[r.status] : null;
          const mine = !!r && !!myEmployeeId && r.rrpp_id === myEmployeeId;
          const label = `${t.name}${r ? ` · ${r.customer_name} · ${r.guests} pers. · ${RESERVATION_STATUS[r.status].label}` : ' · Libre'}`;
          return (
            <g
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={label}
              onClick={() => onSelect(t, r)}
              onKeyDown={key(t, r)}
              className="cursor-pointer outline-none transition-opacity hover:opacity-85 focus-visible:opacity-85"
            >
              <title>{label}</title>
              {mine && (
                <rect
                  x={x - 5}
                  y={y - 5}
                  width={w + 10}
                  height={h + 10}
                  rx={13}
                  fill="none"
                  stroke="rgb(var(--ink))"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              )}
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={9}
                fill={color ? `rgb(${color})` : 'rgb(var(--ink) / 0.08)'}
                stroke={color ? `rgb(${color})` : 'rgb(var(--ink) / 0.55)'}
                strokeWidth={2}
              />
              <text
                x={x + w / 2}
                y={y + h / 2 + (r ? -2 : 8)}
                fontSize={r ? 21 : 24}
                fontWeight={700}
                textAnchor="middle"
                fill={color ? '#fff' : 'rgb(var(--ink))'}
              >
                {tableNumber(t.name)}
              </text>
              {r && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + 15}
                  fontSize={11}
                  fontWeight={600}
                  textAnchor="middle"
                  fill="#fff"
                >
                  {r.guests} pers.
                </text>
              )}
              {/* Capacidad, como en el cartel */}
              {t.capacity && (
                <g>
                  <circle cx={x + w} cy={y} r={11} fill="rgb(var(--surface))" stroke="rgb(var(--ink) / 0.5)" strokeWidth={1.2} />
                  <text x={x + w} y={y + 3.6} fontSize={10} fontWeight={600} textAnchor="middle" fill="rgb(var(--ink))">
                    {t.capacity}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Leyenda */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[4px] border border-ink-2/60 bg-fill" /> Libre
        </span>
        {LEGEND.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[4px]" style={{ background: `rgb(${STATUS_COLOR[s]})` }} /> {RESERVATION_STATUS[s].label}
          </span>
        ))}
        {myEmployeeId && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[4px] border border-dashed border-ink" /> Tuya
          </span>
        )}
      </div>
    </div>
  );
}

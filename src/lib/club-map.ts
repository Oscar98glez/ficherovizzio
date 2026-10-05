/**
 * Plano del local (planta alta). Coordenadas en un lienzo de MAP_W × MAP_H,
 * con el origen en la esquina superior izquierda del recinto.
 */
export const MAP_W = 487;
export const MAP_H = 740;

export interface MapSpot {
  name: string;
  zone: string;
  capacity: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Reservados del local con su posición en el plano */
export const CLUB_TABLES: MapSpot[] = [
  { name: 'Reservado 1', zone: 'Room 1', capacity: null, x: 32, y: 673, w: 72, h: 56 },
  { name: 'Reservado 2', zone: 'Room 1', capacity: null, x: 32, y: 600, w: 72, h: 56 },
  { name: 'Reservado 3', zone: 'Room 1', capacity: null, x: 32, y: 525, w: 72, h: 56 },
  { name: 'Reservado 4', zone: 'Room 2', capacity: null, x: 400, y: 442, w: 64, h: 52 },
  { name: 'Reservado 5', zone: 'Room 2', capacity: null, x: 400, y: 382, w: 64, h: 52 },
  { name: 'Reservado 6', zone: 'Room 2', capacity: null, x: 400, y: 312, w: 64, h: 52 },
  { name: 'Reservado 7', zone: 'Room 2', capacity: null, x: 400, y: 247, w: 64, h: 52 },
  { name: 'Reservado 8', zone: 'Zona DJ', capacity: 16, x: 369, y: 97, w: 58, h: 54 },
  { name: 'Reservado 9', zone: 'Zona DJ', capacity: 16, x: 45, y: 97, w: 58, h: 54 },
  { name: 'Reservado 10', zone: 'Zona DJ', capacity: 8, x: 357, y: 10, w: 58, h: 56 },
  { name: 'Reservado 11', zone: 'Zona DJ', capacity: 8, x: 45, y: 10, w: 58, h: 56 },
];

/** Número que se pinta en el plano: "Reservado 7" → "7" */
export const tableNumber = (name: string) => name.match(/\d+/)?.[0] ?? name.slice(0, 3);

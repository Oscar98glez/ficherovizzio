/** Ubicación del móvil al fichar y distancias al local. */

export interface Position {
  lat: number;
  lng: number;
  /** Precisión en metros */
  accuracy: number;
}

/** Código que devuelve getPosition al fallar, para dar el mensaje adecuado */
export type GeoError = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class PositionError extends Error {
  constructor(public code: GeoError) {
    super(GEO_ERRORS[code]);
  }
}

export const GEO_ERRORS: Record<GeoError, string> = {
  unsupported: 'Este navegador no permite saber tu ubicación. Ficha desde el móvil con Chrome o Safari.',
  denied:
    'Para fichar tienes que dar permiso de ubicación a la app. En el iPhone: Ajustes → Privacidad → Localización → Safari (o Chrome) → «Al usarse la app». En Android: toca el candado junto a la dirección → Permisos → Ubicación.',
  unavailable: 'No se ha podido saber tu ubicación. Activa la ubicación (GPS) del móvil y vuelve a intentarlo.',
  timeout: 'Se ha tardado demasiado en obtener tu ubicación. Vuelve a intentarlo.',
};

function locate(options: PositionOptions): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new PositionError('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(new PositionError(e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable')),
      options,
    );
  });
}

/**
 * Pide la ubicación actual al navegador: primero una nueva con GPS (sin reutilizar una antigua, que
 * podría ser de antes de llegar al local); si el GPS no responde, la de la red, aunque sea menos precisa.
 */
export async function getPosition(timeoutMs = 12000): Promise<Position> {
  try {
    return await locate({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
  } catch (e) {
    if (e instanceof PositionError && (e.code === 'denied' || e.code === 'unsupported')) throw e;
    return locate({ enableHighAccuracy: false, timeout: 8000, maximumAge: 0 });
  }
}

/** Metros entre dos puntos (haversine), igual que distance_m de la base de datos */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** Como check_clock_location: margen por la precisión del GPS, hasta 150 m */
export const isOutside = (distance: number, accuracy: number | null | undefined, radius: number) =>
  distance - Math.min(Math.max(accuracy ?? 0, 0), 150) > radius;

export const fmtDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** Mapa de OpenStreetMap para incrustar, centrado en el punto y con su marca */
export function osmEmbedUrl(lat: number, lng: number, spanM = 400) {
  const dLat = spanM / 111_320;
  const dLng = spanM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((x) => x.toFixed(6)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

/** Lee unas coordenadas pegadas de Google Maps ("40.4168, -3.7038") */
export function parseCoords(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lng = Number(m[2].replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

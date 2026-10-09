import { useEffect, useState } from 'react';
import { Crosshair, ExternalLink, MapPin } from 'lucide-react';
import { useLoad } from '../hooks';
import { api, errorMessage } from '../lib/api';
import { fmtDate, fmtTime } from '../lib/format';
import { fmtDistance, getPosition, mapsUrl, osmEmbedUrl, parseCoords } from '../lib/geo';
import type { TimeEntry } from '../lib/types';
import { cx } from '../lib/utils';
import { useFeedback } from './overlay';
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, Switch } from './ui';

/** Desde este día los fichajes de la app guardan la ubicación: los anteriores no avisan de que les falta */
const LOCATION_SINCE = '2026-10-09T00:00:00Z';

type Side = 'in' | 'out';

function sideOf(e: TimeEntry, side: Side) {
  const lat = side === 'in' ? e.clock_in_lat : e.clock_out_lat;
  const lng = side === 'in' ? e.clock_in_lng : e.clock_out_lng;
  if (lat == null || lng == null) return null;
  return {
    lat,
    lng,
    accuracy: side === 'in' ? e.clock_in_accuracy : e.clock_out_accuracy,
    distance: side === 'in' ? e.clock_in_distance : e.clock_out_distance,
    outside: side === 'in' ? e.clock_in_outside : e.clock_out_outside,
  };
}

/** Resumen en una línea de dónde se fichó: en el local, fuera (con la distancia) o sin ubicación */
export function LocationTag({ entry, className }: { entry: TimeEntry; className?: string }) {
  if (entry.source !== 'app') return null;
  const inn = sideOf(entry, 'in');
  const out = entry.clock_out ? sideOf(entry, 'out') : null;
  const outsides = [inn?.outside && `Entrada fuera · ${fmtDistance(inn.distance ?? 0)}`, out?.outside && `Salida fuera · ${fmtDistance(out.distance ?? 0)}`].filter(Boolean);

  let tone: 'red' | 'green' | 'gray' | 'orange';
  let text: string;
  if (outsides.length) [tone, text] = ['red', outsides.join(' · ')];
  else if (inn?.distance != null) [tone, text] = ['green', 'En el local'];
  else if (inn) [tone, text] = ['gray', 'Ubicación guardada'];
  else if (entry.clock_in >= LOCATION_SINCE) [tone, text] = ['orange', 'Sin ubicación'];
  else return null;

  return (
    <span
      className={cx(
        'inline-flex min-w-0 items-center gap-1 text-[12px] font-medium',
        { red: 'text-red', green: 'text-green', gray: 'text-ink-2', orange: 'text-orange' }[tone],
        className,
      )}
    >
      <MapPin className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** En el fichaje: dónde se fichó la entrada y la salida, con el mapa */
export function EntryLocations({ entry }: { entry: TimeEntry }) {
  if (entry.source !== 'app') return null;
  const sides = (['in', 'out'] as Side[])
    .map((side) => ({ side, at: side === 'in' ? entry.clock_in : entry.clock_out, loc: sideOf(entry, side) }))
    .filter((s) => s.at);
  if (!sides.some((s) => s.loc) && entry.clock_in < LOCATION_SINCE) return null;

  return (
    <div className="space-y-3">
      <div className="text-[13px] font-medium text-ink-2">Dónde ha fichado</div>
      {sides.map(({ side, at, loc }) => (
        <div key={side} className="overflow-hidden rounded-xl bg-fill/60">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[14px] font-medium">
                {side === 'in' ? 'Entrada' : 'Salida'} · {fmtTime(at!)}
              </div>
              <div className="text-[12px] text-ink-2">
                {!loc
                  ? 'Sin ubicación (no se pudo obtener o no dio permiso)'
                  : [loc.distance != null && `A ${fmtDistance(loc.distance)} del local`, loc.accuracy != null && `precisión ±${fmtDistance(loc.accuracy)}`]
                      .filter(Boolean)
                      .join(' · ') || 'Ubicación guardada'}
              </div>
            </div>
            {loc?.outside ? <Badge tone="red">Fuera del local</Badge> : loc?.distance != null ? <Badge tone="green">En el local</Badge> : !loc ? <Badge tone="orange">Sin ubicación</Badge> : null}
          </div>
          {loc && (
            <>
              <iframe
                title={`Ubicación de la ${side === 'in' ? 'entrada' : 'salida'}`}
                src={osmEmbedUrl(loc.lat, loc.lng)}
                className="block h-40 w-full border-0"
                loading="lazy"
              />
              <a
                href={mapsUrl(loc.lat, loc.lng)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium text-accent hover:opacity-70"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Abrir en Google Maps
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Ajustes: ubicación del local, radio y si se impide fichar fuera */
export function VenueLocationCard() {
  const { toast, confirm } = useFeedback();
  const { data: venue, loading, error, reload } = useLoad(() => api.getVenue(), []);
  const [coords, setCoords] = useState('');
  const [radius, setRadius] = useState('150');
  const [enforce, setEnforce] = useState(true);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!venue) return;
    setCoords(`${venue.lat.toFixed(6)}, ${venue.lng.toFixed(6)}`);
    setRadius(String(venue.radius_m));
    setEnforce(venue.enforce);
  }, [venue]);

  const point = parseCoords(coords);
  const radiusM = Number(radius);
  const radiusOk = Number.isInteger(radiusM) && radiusM >= 20 && radiusM <= 5000;

  async function useHere() {
    setLocating(true);
    try {
      const p = await getPosition(20000);
      setCoords(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`);
      if (p.accuracy > 100) toast.info(`Ubicación con poca precisión (±${fmtDistance(p.accuracy)}). Revísala en el mapa o pega las coordenadas de Google Maps.`);
      else toast.success(`Ubicación obtenida (±${fmtDistance(p.accuracy)}). Pulsa Guardar.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    if (!point) return toast.error('Escribe las coordenadas del local (por ejemplo 40.420050, -3.705780) o usa tu ubicación actual.');
    if (!radiusOk) return toast.error('El radio tiene que estar entre 20 y 5000 metros.');
    setSaving(true);
    try {
      await api.saveVenue({ lat: point.lat, lng: point.lng, radius_m: radiusM, enforce });
      toast.success('Ubicación del local guardada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: '¿Quitar la ubicación del local?',
      message: 'Los fichajes seguirán guardando dónde se hacen, pero no se comprobará si es en el local.',
      confirmLabel: 'Quitar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.saveVenue(null);
      setCoords('');
      toast.success('Ubicación del local quitada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Ubicación del local"
        subtitle="Al fichar se guarda dónde está cada trabajador. Con la ubicación del local se comprueba que fichan desde el trabajo."
        action={venue ? <Badge tone={venue.enforce ? 'green' : 'blue'}>{venue.enforce ? 'Activa' : 'Sólo avisa'}</Badge> : null}
      />
      <div className="space-y-4 px-5 pb-5">
        {loading && !venue ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : error ? (
          <p className="text-[14px] text-red">{error}</p>
        ) : (
          <>
            {!venue && (
              <p className="rounded-xl bg-orange/10 px-3 py-2.5 text-[13px] text-orange">
                Sin configurar: los fichajes guardan la ubicación, pero no se comprueba si es en el local. Desde el local, pulsa «Usar mi ubicación actual» y guarda.
              </p>
            )}
            <Field label="Coordenadas del local" hint="Pégalas de Google Maps (mantén pulsado sobre el local) o usa tu ubicación estando allí.">
              <div className="flex gap-2">
                <Input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="40.420050, -3.705780" inputMode="decimal" className="min-w-0 flex-1" />
                <Button type="button" variant="secondary" icon={<Crosshair />} onClick={useHere} loading={locating} className="shrink-0">
                  <span className="hidden sm:inline">Usar mi ubicación actual</span>
                  <span className="sm:hidden">Aquí</span>
                </Button>
              </div>
            </Field>
            {coords && !point && <p className="-mt-2 text-[12px] text-red">No se reconocen las coordenadas. Ejemplo: 40.420050, -3.705780</p>}
            {point && (
              <div className="overflow-hidden rounded-xl bg-fill/60">
                <iframe title="Ubicación del local" src={osmEmbedUrl(point.lat, point.lng, Math.max(radiusOk ? radiusM * 2 : 300, 200))} className="block h-44 w-full border-0" loading="lazy" />
                <a href={mapsUrl(point.lat, point.lng)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium text-accent hover:opacity-70">
                  <ExternalLink className="h-3.5 w-3.5" /> Comprobar en Google Maps
                </a>
              </div>
            )}
            <Field label="Radio (metros)" hint="Distancia al local que cuenta como «en el local». Se da algo de margen por la precisión del GPS dentro del local.">
              <Input value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="w-32" />
            </Field>
            <Switch
              checked={enforce}
              onChange={setEnforce}
              label="Impedir fichar fuera del local"
              description="Si está activo, no se puede fichar la entrada fuera del local ni sin dar la ubicación. Si no, se ficha igual y aquí sale marcado. La salida nunca se bloquea: si es fuera, queda marcada."
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={save} loading={saving}>
                Guardar
              </Button>
              {venue && (
                <Button variant="secondary" onClick={remove}>
                  Quitar ubicación
                </Button>
              )}
            </div>
            {venue?.updated_at && <p className="text-[12px] text-ink-3">Guardada el {fmtDate(venue.updated_at)}, {fmtTime(venue.updated_at)}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

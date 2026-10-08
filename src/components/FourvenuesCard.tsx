import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, RefreshCw, Ticket, Users } from 'lucide-react';
import { useLoad } from '../hooks';
import { api, errorMessage } from '../lib/api';
import { IS_DEMO } from '../lib/config';
import { addDays, businessToday, isoDate } from '../lib/dates';
import { fmtDate, fmtMoney, fmtNum, fmtTime } from '../lib/format';
import { fourvenuesStatus, fourvenuesUsers, syncFourvenues } from '../lib/fourvenues';
import type { Employee, FourvenuesResult, FourvenuesUser } from '../lib/types';
import { fullName } from '../lib/utils';
import { Modal, useFeedback } from './overlay';
import { Badge, Button, Card, CardHeader, Field, Input, ListRow, SearchInput, Select, Spinner } from './ui';

const when = (iso: string) => `${fmtDate(iso)} · ${fmtTime(iso)}`;

function resultText(r: FourvenuesResult) {
  const nights = [r.created && `${r.created} creadas`, r.linked && `${r.linked} asociadas`, r.moved && `${r.moved} con fecha cambiada`].filter(Boolean);
  return [
    `${r.events} ${r.events === 1 ? 'noche' : 'noches'}${nights.length ? ` (${nights.join(', ')})` : ''}`,
    r.paid != null ? `${fmtNum(r.paid, 0)} entradas vendidas · ${fmtNum(r.free ?? 0, 0)} QR gratis` : `${fmtNum(r.tickets, 0)} entradas online`,
    r.rrpp ? `entradas de ${r.rrpp} RRPP` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Integración con Fourvenues (en Ajustes): estado, sincronizar y asociar los RRPP.
 * La clave está en los secretos de la función de Supabase, nunca en la app.
 */
export function FourvenuesCard() {
  const { toast } = useFeedback();
  const [syncing, setSyncing] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [backfill, setBackfill] = useState(false);
  const [from, setFrom] = useState(() => isoDate(addDays(businessToday(), -60)));
  const { data: status, error, loading, reload } = useLoad(() => (IS_DEMO ? Promise.resolve(null) : fourvenuesStatus()), []);

  async function sync(since?: string) {
    setSyncing(true);
    try {
      const r = await syncFourvenues(since);
      if (r.running) toast.success('Ya hay una sincronización en curso');
      else if (r.result) toast.success(`Sincronizado: ${resultText(r.result)}`);
      setBackfill(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSyncing(false);
      reload();
    }
  }

  const s = status?.sync;
  const result = s?.last_result;

  return (
    <Card className="mt-4">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Ticket className="h-4 w-4 text-accent" /> Fourvenues
          </span>
        }
        subtitle="Trae las noches, sus entradas vendidas y QR gratis, y las entradas que vende cada RRPP. No apunta ingresos en Finanzas."
        action={status?.configured ? <Badge tone={status.env === 'alpha' ? 'orange' : 'green'}>{status.env === 'alpha' ? 'Pruebas' : 'Producción'}</Badge> : undefined}
      />
      <div className="space-y-3 px-5 pb-5 text-[13px]">
        {IS_DEMO ? (
          <p className="text-ink-2">Disponible solo con Supabase conectado (no en el modo demo).</p>
        ) : loading && !status ? (
          <Spinner />
        ) : error ? (
          <p className="text-red">{error}</p>
        ) : !status?.configured ? (
          <p className="text-ink-2">
            Falta la clave. Guárdala en <b className="text-ink">Supabase → Edge Functions → Secrets</b> con el nombre{' '}
            <code className="rounded bg-fill px-1">FOURVENUES_API_KEY</code> (si es de pruebas, añade también{' '}
            <code className="rounded bg-fill px-1">FOURVENUES_ENV</code> = <code className="rounded bg-fill px-1">alpha</code>) y vuelve aquí.
          </p>
        ) : (
          <>
            <div className="text-ink-2">
              {s?.last_ok_at ? (
                <>
                  Última sincronización: <span className="text-ink">{when(s.last_ok_at)}</span>
                  {result && <div className="mt-0.5">{resultText(result)}</div>}
                </>
              ) : (
                'Todavía no se ha sincronizado.'
              )}
              <div className="mt-0.5 text-ink-3">Se sincroniza sola al abrir Noches (como mucho cada 10 minutos).</div>
            </div>
            {s?.last_error && s.last_run_at && (!s.last_ok_at || s.last_run_at > s.last_ok_at) && (
              <p className="flex gap-2 rounded-xl bg-red/10 px-3 py-2 text-red">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Falló el {when(s.last_run_at)}: {s.last_error}
                </span>
              </p>
            )}
            {!!result?.unmatched.length && (
              <p className="flex gap-2 rounded-xl bg-orange/10 px-3 py-2 text-orange">
                <Users className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {result.unmatched.length === 1 ? 'Hay 1 RRPP' : `Hay ${result.unmatched.length} RRPP`} de Fourvenues con ventas sin asociar a su ficha: sus entradas no
                  cuentan para las comisiones hasta que lo asocies.
                </span>
              </p>
            )}
            {result?.warnings.map((w) => (
              <p key={w} className="text-orange">
                {w}
              </p>
            ))}
            <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
              <Button icon={<RefreshCw />} loading={syncing} onClick={() => sync()}>
                Sincronizar ahora
              </Button>
              <Button variant="secondary" icon={<Users />} onClick={() => setMapping(true)}>
                Asociar RRPP
              </Button>
            </div>
            <button type="button" onClick={() => setBackfill(true)} className="flex items-center gap-1.5 text-accent hover:opacity-70">
              <CalendarClock className="h-4 w-4" /> Traer noches anteriores
            </button>
          </>
        )}
      </div>

      <Modal open={backfill} onClose={() => setBackfill(false)} title="Traer noches anteriores" onSubmit={() => sync(from)} submitLabel="Traer" saving={syncing}>
        <div className="space-y-4">
          <Field label="Desde la noche del" hint="Como mucho, los últimos 180 días">
            <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <p className="text-[13px] text-ink-2">
            Crea las noches que falten y rellena sus entradas vendidas, los QR gratis y las entradas de cada RRPP. Lo que ya estaba importado se actualiza (no se duplica). Puede tardar un minuto.
          </p>
        </div>
      </Modal>

      <RrppMappingModal open={mapping} onClose={() => setMapping(false)} pending={result?.unmatched ?? []} />
    </Card>
  );
}

// =====================================================================
//  Asociar cada usuario de Fourvenues (el RRPP de sus entradas) con su ficha
// =====================================================================

function RrppMappingModal({ open, onClose, pending }: { open: boolean; onClose: () => void; pending: FourvenuesResult['unmatched'] }) {
  const { toast } = useFeedback();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(async () => {
    if (!open) return null;
    // Si la clave no da acceso a los usuarios, se pueden asociar igualmente los RRPP con ventas
    let usersError: string | null = null;
    const [users, employees] = await Promise.all([
      fourvenuesUsers().catch((e) => ((usersError = errorMessage(e)), [] as FourvenuesUser[])),
      api.employees.list({ order: ['first_name', 'asc'] }),
    ]);
    return { users, employees, usersError: usersError as string | null };
  }, [open]);

  const rows = useMemo(() => {
    if (!data) return [];
    const linked = new Map(data.employees.filter((e) => e.fourvenues_user_id).map((e) => [e.fourvenues_user_id!, e]));
    const sales = new Map(pending.map((p) => [p.id, p]));
    const users: FourvenuesUser[] = [...data.users];
    // RRPP con ventas que no salen en la lista de usuarios (p. ej. de otra organización)
    for (const p of pending) if (!users.some((u) => u.id === p.id)) users.push({ id: p.id, name: p.name, email: p.email });
    const q = query.trim().toLowerCase();
    return users
      .map((u) => ({ user: u, employee: linked.get(u.id) ?? null, sales: sales.get(u.id) ?? null }))
      .filter((r) => !q || [r.user.name, r.user.email, fullName(r.employee)].some((t) => t?.toLowerCase().includes(q)))
      .sort((a, b) => Number(!!b.sales) - Number(!!a.sales) || Number(!!b.employee) - Number(!!a.employee) || (a.user.name ?? '').localeCompare(b.user.name ?? '', 'es'));
  }, [data, pending, query]);

  // Primero los de Relaciones públicas; luego el resto del personal activo
  const options = useMemo(() => {
    const list = (data?.employees ?? []).filter((e) => e.active);
    return [...list.filter((e) => e.department === 'relaciones'), ...list.filter((e) => e.department !== 'relaciones')];
  }, [data]);

  async function link(fvUserId: string, current: Employee | null, employeeId: string) {
    setSaving(fvUserId);
    try {
      // Cada usuario de Fourvenues va con una sola ficha (y cada ficha con un usuario)
      if (current) await api.employees.update(current.id, { fourvenues_user_id: null });
      if (employeeId) await api.employees.update(employeeId, { fourvenues_user_id: fvUserId });
      toast.success(employeeId ? 'RRPP asociado: sus entradas se traerán en la próxima sincronización' : 'Asociación quitada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Asociar RRPP de Fourvenues" wide>
      <div className="space-y-3">
        <p className="text-[13px] text-ink-2">
          Elige la ficha de cada RRPP de Fourvenues. Los que tienen el mismo email en Fourvenues y en su ficha se asocian solos al sincronizar.
        </p>
        {data?.usersError && <p className="text-[13px] text-orange">{data.usersError}</p>}
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar por nombre o email" />
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <p className="text-[13px] text-red">{error}</p>
        ) : rows.length ? (
          <div className="-mx-4 divide-y divide-line">
            {rows.slice(0, 80).map(({ user, employee, sales }) => (
              <ListRow
                key={user.id}
                title={
                  <span className="flex items-center gap-2">
                    {user.name ?? 'Sin nombre'}
                    {sales && !employee && <Badge tone="orange">Sin asociar</Badge>}
                  </span>
                }
                subtitle={[user.email, sales && `${fmtNum(sales.tickets, 0)} entradas · ${fmtMoney(sales.revenue)}`].filter(Boolean).join(' · ') || user.id}
                trailing={
                  saving === user.id ? (
                    <Spinner />
                  ) : (
                    <Select
                      value={employee?.id ?? ''}
                      onChange={(e) => link(user.id, employee, e.target.value)}
                      className="h-8 w-40 rounded-lg py-0 text-[13px] sm:w-48"
                      aria-label={`Ficha de ${user.name ?? user.id}`}
                    >
                      <option value="">Sin asociar</option>
                      {options.map((e) => (
                        <option key={e.id} value={e.id} disabled={!!e.fourvenues_user_id && e.fourvenues_user_id !== user.id}>
                          {fullName(e)}
                        </option>
                      ))}
                    </Select>
                  )
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">{query ? 'Nadie coincide con la búsqueda.' : 'Fourvenues no ha devuelto ningún usuario.'}</p>
        )}
      </div>
    </Modal>
  );
}

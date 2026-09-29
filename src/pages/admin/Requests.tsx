import { useState } from 'react';
import { Check, Inbox, X } from 'lucide-react';
import { useFeedback } from '../../components/overlay';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { REQUEST_KINDS, REQUEST_STATUS } from '../../lib/constants';
import { parseDate } from '../../lib/dates';
import { fmtDate } from '../../lib/format';
import type { LeaveRequest, RequestStatus } from '../../lib/types';
import { byId, fullName } from '../../lib/utils';

export function requestDates(r: LeaveRequest) {
  const days = Math.round((parseDate(r.end_date).getTime() - parseDate(r.start_date).getTime()) / 86_400_000) + 1;
  const range = r.start_date === r.end_date ? fmtDate(r.start_date, { weekday: 'short', day: 'numeric', month: 'short' }) : `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`;
  return `${range} · ${days} día${days > 1 ? 's' : ''}`;
}

export default function Requests() {
  const { toast } = useFeedback();
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [busy, setBusy] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [requests, employees] = await Promise.all([api.requests.list({ order: ['created_at', 'desc'] }), api.employees.list()]);
    return { requests, employees };
  }, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const emps = byId(data.employees);
  const list = data.requests
    .filter((r) => (tab === 'pending' ? r.status === 'pending' : r.status !== 'pending'))
    .sort((a, b) => (tab === 'pending' ? a.start_date.localeCompare(b.start_date) : b.created_at.localeCompare(a.created_at)));
  const pendingCount = data.requests.filter((r) => r.status === 'pending').length;

  async function resolve(r: LeaveRequest, status: RequestStatus) {
    setBusy(r.id + status);
    try {
      await api.requests.update(r.id, { status, reviewed_at: new Date().toISOString() });
      toast.success(status === 'approved' ? 'Solicitud aprobada' : 'Solicitud rechazada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Solicitudes" subtitle="Vacaciones, ausencias y cambios de turno del equipo" />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: `Pendientes${pendingCount ? ` (${pendingCount})` : ''}` },
            { value: 'done', label: 'Resueltas' },
          ]}
        />
      </div>

      {list.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((r) => {
            const emp = emps.get(r.employee_id);
            return (
              <Card key={r.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={fullName(emp)} color={emp?.color} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold">{fullName(emp)}</span>
                      <Badge tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Badge>
                    </div>
                    <div className="text-[14px] font-medium text-accent">{REQUEST_KINDS[r.kind]}</div>
                    <div className="text-[13px] text-ink-2">{requestDates(r)}</div>
                    {r.reason && <p className="mt-2 rounded-lg bg-fill/60 px-3 py-2 text-[14px]">{r.reason}</p>}
                  </div>
                </div>
                {r.status === 'pending' && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button variant="danger-tinted" icon={<X />} loading={busy === r.id + 'rejected'} onClick={() => resolve(r, 'rejected')}>
                      Rechazar
                    </Button>
                    <Button variant="success" icon={<Check />} loading={busy === r.id + 'approved'} onClick={() => resolve(r, 'approved')}>
                      Aprobar
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Inbox />} title={tab === 'pending' ? 'Todo al día' : 'Sin historial'} message={tab === 'pending' ? 'No hay solicitudes pendientes de revisar.' : 'Aquí verás las solicitudes ya resueltas.'} />
        </Card>
      )}
    </>
  );
}

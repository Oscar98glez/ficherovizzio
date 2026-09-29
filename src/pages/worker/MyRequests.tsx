import { useState } from 'react';
import { Inbox, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth';
import { RequestForm } from '../../components/finance-forms';
import { useFeedback } from '../../components/overlay';
import { Badge, Button, Card, EmptyState, ErrorBox, IconButton, Loading, PageHeader } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { REQUEST_KINDS, REQUEST_STATUS } from '../../lib/constants';
import { requestDates } from '../admin/Requests';
import { NotLinked } from './Clock';

export default function MyRequests() {
  const { employee } = useAuth();
  const { toast, confirm } = useFeedback();
  const [creating, setCreating] = useState(false);

  const { data, loading, error, reload } = useLoad(
    async () => (employee ? api.requests.list({ eq: { employee_id: employee.id }, order: ['created_at', 'desc'] }) : []),
    [employee?.id],
  );

  if (!employee) return <NotLinked />;
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  async function cancel(id: string) {
    if (!(await confirm({ title: '¿Retirar la solicitud?', confirmLabel: 'Retirar', destructive: true }))) return;
    try {
      await api.requests.remove(id);
      toast.success('Solicitud retirada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Solicitudes"
        subtitle="Vacaciones, ausencias y cambios de turno"
        actions={
          <Button icon={<Plus />} onClick={() => setCreating(true)}>
            Nueva
          </Button>
        }
      />
      {data?.length ? (
        <Card className="divide-y divide-line overflow-hidden">
          {data.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold">{REQUEST_KINDS[r.kind]}</span>
                  <Badge tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Badge>
                </div>
                <div className="text-[13px] text-ink-2">{requestDates(r)}</div>
                {r.reason && <div className="mt-1 text-[14px]">{r.reason}</div>}
              </div>
              {r.status === 'pending' && (
                <IconButton label="Retirar solicitud" onClick={() => cancel(r.id)} className="text-red hover:bg-red/10 hover:text-red">
                  <Trash2 />
                </IconButton>
              )}
            </div>
          ))}
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<Inbox />} title="No has hecho solicitudes" message="Pide días libres o cambios de turno y tu responsable los revisará." action={<Button icon={<Plus />} onClick={() => setCreating(true)}>Nueva solicitud</Button>} />
        </Card>
      )}
      <RequestForm open={creating} onClose={() => setCreating(false)} employeeId={employee.id} onSaved={reload} />
    </div>
  );
}

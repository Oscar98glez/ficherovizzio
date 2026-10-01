import { useNavigate } from 'react-router-dom';
import { Database, LogOut, RotateCcw } from 'lucide-react';
import { useAuth } from '../../auth';
import { useFeedback } from '../../components/overlay';
import { Avatar, Badge, Button, Card, CardHeader, ListRow, PageHeader, SectionTitle, Select } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage } from '../../lib/api';
import { APP_NAME, IS_DEMO, SUPABASE_URL } from '../../lib/config';
import { resetDemoData } from '../../lib/demo';
import type { Role } from '../../lib/types';
import { PasswordCard } from '../worker/Profile';

export default function Settings() {
  const { profile, employee, userId, signOut, refresh } = useAuth();
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const { data: profiles, reload } = useLoad(() => api.profiles.list({ order: ['created_at', 'asc'] }), []);

  async function changeRole(id: string, role: Role) {
    try {
      await api.profiles.update(id, { role });
      toast.success('Rol actualizado');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function resetDemo() {
    if (!(await confirm({ title: '¿Restablecer datos de ejemplo?', message: 'Se perderán los cambios hechos en la demo.', confirmLabel: 'Restablecer', destructive: true }))) return;
    resetDemoData();
    await refresh();
    toast.success('Datos de ejemplo restablecidos');
    navigate('/resumen');
  }

  return (
    <>
      <PageHeader title="Ajustes" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <SectionTitle>Tu cuenta</SectionTitle>
          <Card className="flex items-center gap-4 p-5">
            <Avatar name={profile?.full_name || profile?.email || '?'} color={employee?.color ?? '#8e8e93'} src={employee?.photo_url} size={56} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-semibold">{profile?.full_name || 'Sin nombre'}</div>
              <div className="truncate text-[14px] text-ink-2">{profile?.email}</div>
              <Badge tone="purple" className="mt-1.5">
                Administrador
              </Badge>
            </div>
          </Card>

          {!IS_DEMO && (
            <div className="mt-4">
              <PasswordCard />
            </div>
          )}

          <SectionTitle>Base de datos</SectionTitle>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${IS_DEMO ? 'bg-orange/15 text-orange' : 'bg-green/15 text-green'}`}>
                <Database className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">{IS_DEMO ? 'Modo demo' : 'Supabase conectado'}</div>
                <div className="truncate text-[13px] text-ink-2">
                  {IS_DEMO ? 'Los datos se guardan solo en este navegador.' : SUPABASE_URL?.replace('https://', '')}
                </div>
              </div>
            </div>
            {IS_DEMO && (
              <Button variant="secondary" className="mt-4 w-full" icon={<RotateCcw />} onClick={resetDemo}>
                Restablecer datos de ejemplo
              </Button>
            )}
          </Card>

          <Button
            variant="danger-tinted"
            size="lg"
            className="mt-6 w-full"
            icon={<LogOut />}
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Cerrar sesión
          </Button>
        </div>

        <div>
          <SectionTitle>Usuarios con acceso</SectionTitle>
          <Card>
            <CardHeader title={`${profiles?.length ?? 0} usuarios`} subtitle="Los trabajadores se registran con el email de su ficha. Aquí puedes cambiar su rol." />
            <div className="divide-y divide-line pb-2">
              {(profiles ?? []).map((p) => (
                <ListRow
                  key={p.id}
                  leading={<Avatar name={p.full_name || p.email} size={36} />}
                  title={p.full_name || p.email}
                  subtitle={p.email}
                  trailing={
                    p.id === userId ? (
                      <Badge tone="purple">Tú</Badge>
                    ) : (
                      <Select value={p.role} onChange={(e) => changeRole(p.id, e.target.value as Role)} className="h-8 w-auto rounded-lg py-0 text-[13px]">
                        <option value="worker">Trabajador</option>
                        <option value="admin">Administrador</option>
                      </Select>
                    )
                  }
                />
              ))}
            </div>
          </Card>
          <p className="mt-3 px-1 text-[12px] text-ink-3">
            {APP_NAME} · v0.1 · El primer usuario registrado es administrador. Cualquiera puede registrarse como trabajador: si su email no está en ninguna ficha, se le crea una como Camarero/a (revisa su tarifa en Personal).
          </p>
        </div>
      </div>
    </>
  );
}

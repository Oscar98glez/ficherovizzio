import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../auth';
import { useFeedback } from '../../components/overlay';
import { Avatar, Button, Card, CardHeader, Field, Input, PageHeader, SectionTitle } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { IS_DEMO } from '../../lib/config';
import { DEPARTMENTS } from '../../lib/constants';
import { fmtDate } from '../../lib/format';
import { NotificationsCard } from '../../components/NotificationsCard';
import { PhotoPicker } from '../../components/PhotoPicker';
import { api } from '../../lib/api';
import { fullName } from '../../lib/utils';

/** Comprueba la contraseña nueva antes de enviarla; devuelve el error o null */
export function checkNewPassword(pw: string, repeat: string, current?: string): string | null {
  if (pw.length < 6) return 'La contraseña nueva debe tener al menos 6 caracteres.';
  if (pw !== repeat) return 'Las dos contraseñas nuevas no coinciden.';
  if (current !== undefined && pw === current) return 'La nueva contraseña tiene que ser distinta de la actual.';
  return null;
}

export function PasswordCard() {
  const { updatePassword, resetPassword, email } = useAuth();
  const { toast } = useFeedback();
  const empty = { current: '', pw: '', repeat: '' };
  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.current) return toast.error('Escribe tu contraseña actual');
    const problem = checkNewPassword(f.pw, f.repeat, f.current);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      await updatePassword(f.pw, f.current);
      setF(empty);
      toast.success('Contraseña cambiada');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function forgot() {
    if (!email) return;
    try {
      await resetPassword(email);
      toast.success(`Te hemos enviado un email a ${email} para crear una contraseña nueva`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="Cambiar contraseña" />
      <form onSubmit={submit} className="space-y-3 px-5 pb-5">
        <Field label="Contraseña actual">
          <Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label="Contraseña nueva">
          <Input type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} placeholder="Mínimo 6 caracteres" />
        </Field>
        <Field label="Repite la contraseña nueva">
          <Input type="password" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {email && (
            <button type="button" onClick={forgot} className="text-[14px] text-accent hover:underline">
              ¿No recuerdas la actual?
            </button>
          )}
          <Button type="submit" loading={saving} className="ml-auto">
            Cambiar contraseña
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function Profile() {
  const { employee, profile, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const name = employee ? fullName(employee) : profile?.full_name || profile?.email || '';

  const rows: [string, string][] = employee
    ? [
        ['Puesto', employee.position],
        ['Departamento', DEPARTMENTS[employee.department].label],
        ['Email', employee.email ?? profile?.email ?? '—'],
        ['Teléfono', employee.phone ?? '—'],
        ['Fecha de alta', employee.hire_date ? fmtDate(employee.hire_date, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'],
      ]
    : [['Email', profile?.email ?? '—']];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Perfil" />
      <div className="mb-6 flex flex-col items-center text-center">
        {employee ? (
          <PhotoPicker
            name={name}
            color={employee.color}
            src={employee.photo_url}
            size={137}
            folder={employee.id}
            onChange={async (url) => {
              await api.setMyPhoto(url);
              await refresh();
            }}
          />
        ) : (
          <Avatar name={name} size={127} />
        )}
        <h2 className="mt-3 text-[24px] font-bold tracking-tight">{name}</h2>
        {employee && <p className="text-[15px] text-ink-2">{employee.position}</p>}
      </div>

      <SectionTitle>Mis datos</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-3 text-[15px]">
            <span className="text-ink-2">{k}</span>
            <span className="truncate text-right font-medium">{v}</span>
          </div>
        ))}
      </Card>
      <p className="mt-2 px-1 text-[12px] text-ink-3">Si algún dato no es correcto, avisa a tu responsable.</p>

      {!IS_DEMO && employee && (
        <>
          <SectionTitle>Avisos</SectionTitle>
          <NotificationsCard />
        </>
      )}

      {!IS_DEMO && (
        <>
          <SectionTitle>Seguridad</SectionTitle>
          <PasswordCard />
        </>
      )}

      <Button
        variant="danger-tinted"
        size="lg"
        className="mt-8 w-full"
        icon={<LogOut />}
        onClick={async () => {
          await signOut();
          navigate('/login');
        }}
      >
        Cerrar sesión
      </Button>
    </div>
  );
}

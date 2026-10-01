import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../auth';
import { useFeedback } from '../../components/overlay';
import { Avatar, Button, Card, CardHeader, Input, PageHeader, SectionTitle } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { IS_DEMO } from '../../lib/config';
import { DEPARTMENTS } from '../../lib/constants';
import { fmtDate } from '../../lib/format';
import { PhotoPicker } from '../../components/PhotoPicker';
import { api } from '../../lib/api';
import { fullName } from '../../lib/utils';

export function PasswordCard() {
  const { updatePassword } = useAuth();
  const { toast } = useFeedback();
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 6) return toast.error('Mínimo 6 caracteres');
    setSaving(true);
    try {
      await updatePassword(pw);
      setPw('');
      toast.success('Contraseña actualizada');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Cambiar contraseña" />
      <form onSubmit={submit} className="flex gap-2 px-5 pb-5">
        <Input type="password" autoComplete="new-password" placeholder="Nueva contraseña" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button type="submit" variant="secondary" loading={saving} className="!h-11">
          Guardar
        </Button>
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
            size={114}
            folder={employee.id}
            onChange={async (url) => {
              await api.setMyPhoto(url);
              await refresh();
            }}
          />
        ) : (
          <Avatar name={name} size={106} />
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

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useFeedback } from '../components/overlay';
import { Button, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/api';
import { AuthLayout } from './Login';
import { checkNewPassword } from './worker/Profile';

/**
 * Se ve al entrar con el enlace del email de "¿Has olvidado la contraseña?", sea cual sea la
 * página a la que lleve: la sesión de ese enlace sirve justo para elegir una contraseña nueva.
 */
export default function NewPassword() {
  const { updatePassword, finishRecovery, email } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkNewPassword(pw, repeat);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      await updatePassword(pw);
      toast.success('Contraseña cambiada. Ya puedes usarla para entrar.');
      finishRecovery();
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout title="Crea tu nueva contraseña" subtitle={email ?? undefined}>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <Field label="Contraseña nueva">
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mínimo 6 caracteres" required autoFocus />
        </Field>
        <Field label="Repite la contraseña nueva">
          <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={saving}>
          Guardar contraseña
        </Button>
        <button
          type="button"
          onClick={() => {
            finishRecovery();
            navigate('/', { replace: true });
          }}
          className="block w-full text-center text-[14px] text-ink-2 hover:underline"
        >
          Ahora no
        </button>
      </form>
    </AuthLayout>
  );
}

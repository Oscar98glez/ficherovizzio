import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { useAuth } from '../auth';
import { useFeedback } from '../components/overlay';
import { Button, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/api';
import { AuthLayout } from './Login';

export default function Register() {
  const { signUp } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error('La contraseña debe tener al menos 6 caracteres');
    setLoading(true);
    try {
      const { needsConfirmation } = await signUp(name, email, password);
      if (needsConfirmation) setSent(true);
      else navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (sent)
    return (
      <AuthLayout title="Revisa tu correo" subtitle={`Hemos enviado un enlace de confirmación a ${email}.`}>
        <div className="card flex flex-col items-center gap-4 p-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-green/15 text-green">
            <MailCheck className="h-7 w-7" />
          </span>
          <p className="text-[14px] text-ink-2">Cuando confirmes tu email podrás iniciar sesión y empezar a fichar.</p>
          <Link to="/login" className="font-medium text-accent">
            Ir a iniciar sesión
          </Link>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Crea tu cuenta" subtitle="Regístrate para fichar, ver tus turnos e indicar tu disponibilidad.">
      <form onSubmit={submit} className="card space-y-4 p-6">
        <Field label="Nombre completo">
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Contraseña" hint="Mínimo 6 caracteres.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Crear cuenta
        </Button>
      </form>
      <p className="mt-6 text-center text-[14px] text-ink-2">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Inicia sesión
        </Link>
      </p>
    </AuthLayout>
  );
}

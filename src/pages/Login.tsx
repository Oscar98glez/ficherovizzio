import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, Sofa, UserRound } from 'lucide-react';
import { useAuth } from '../auth';
import { Logo } from '../components/AppShell';
import { useFeedback } from '../components/overlay';
import { Button, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/api';
import { APP_NAME, IS_DEMO } from '../lib/config';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="theme-dark auth-bg flex min-h-dvh flex-col items-center justify-center px-4 py-10 text-ink">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={64} />
          <h1 className="mt-5 text-[28px] font-bold tracking-tight [text-shadow:0_2px_16px_rgba(0,0,0,0.6)]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-ink-2">{subtitle}</p>}
        </div>
        {children}
      </div>
      <p className="mt-10 text-[12px] text-ink-2">
        {APP_NAME} · Gestión de personal y finanzas
      </p>
    </div>
  );
}

export default function Login() {
  const { signIn, demoSignIn, resetPassword } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function forgot() {
    if (!email) return toast.info('Escribe tu email y vuelve a pulsar');
    try {
      await resetPassword(email);
      toast.success('Te hemos enviado un email para restablecer la contraseña');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function demo(role: 'admin' | 'worker' | 'rrpp') {
    await demoSignIn(role);
    navigate('/');
  }

  if (IS_DEMO) {
    return (
      <AuthLayout title={`Bienvenido a ${APP_NAME}`} subtitle="Modo demo con datos de ejemplo. Elige cómo quieres entrar.">
        <div className="space-y-3">
          <DemoOption
            icon={<ShieldCheck className="h-6 w-6" />}
            title="Administrador"
            text="Personal, fichajes, turnos, finanzas y nóminas."
            onClick={() => demo('admin')}
          />
          <DemoOption
            icon={<UserRound className="h-6 w-6" />}
            title="Trabajador"
            text="Fichar entrada y salida, horas, turnos y solicitudes."
            onClick={() => demo('worker')}
          />
          <DemoOption
            icon={<Sofa className="h-6 w-6" />}
            title="RRPP"
            text="Fichar entrada y salida y gestionar los reservados."
            onClick={() => demo('rrpp')}
          />
        </div>
        <p className="mt-6 text-center text-[13px] text-ink-2">
          Añade <code className="rounded bg-fill px-1 py-0.5 text-[12px]">VITE_SUPABASE_ANON_KEY</code> en <code className="rounded bg-fill px-1 py-0.5 text-[12px]">.env.local</code> para conectar la base de datos real.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={`Inicia sesión en ${APP_NAME}`}>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <Field label="Email">
          <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Contraseña">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Continuar
        </Button>
        <button type="button" onClick={forgot} className="block w-full text-center text-[14px] text-accent hover:underline">
          ¿Has olvidado la contraseña?
        </button>
      </form>
      <p className="mt-6 text-center text-[14px] text-ink-2">
        ¿Primera vez?{' '}
        <Link to="/registro" className="font-medium text-accent hover:underline">
          Crea tu cuenta
        </Link>
      </p>
    </AuthLayout>
  );
}

function DemoOption({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card flex w-full items-center gap-4 p-5 text-left transition hover:scale-[1.01] active:scale-[0.99]">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-accent/10 text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[17px] font-semibold">{title}</span>
        <span className="block text-[14px] text-ink-2">{text}</span>
      </span>
    </button>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GlassWater, MailCheck, Sofa, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth';
import { useFeedback } from '../components/overlay';
import { Button, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/api';
import { cx } from '../lib/utils';
import { AuthLayout } from './Login';

type WorkerRole = 'worker' | 'rrpp';

const ROLE_OPTIONS: { value: WorkerRole; title: string; text: string; icon: LucideIcon }[] = [
  { value: 'worker', title: 'Camarero/a', text: 'Fichar, horas, turnos y disponibilidad', icon: GlassWater },
  { value: 'rrpp', title: 'RRPP', text: 'Fichar y gestionar los reservados', icon: Sofa },
];

export default function Register() {
  const { signUp } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<WorkerRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!role) return toast.error('Elige si eres camarero/a o RRPP');
    if (password.length < 6) return toast.error('La contraseña debe tener al menos 6 caracteres');
    setLoading(true);
    try {
      const { needsConfirmation } = await signUp(name, email, password, role);
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
    <AuthLayout title="Crea tu cuenta" subtitle="Regístrate y elige tu puesto para entrar con tus funciones.">
      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">¿Cuál es tu puesto?</span>
          <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Puesto">
            {ROLE_OPTIONS.map((o) => {
              const active = role === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRole(o.value)}
                  className={cx(
                    'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition',
                    active ? 'border-accent bg-accent/10 ring-2 ring-accent/30' : 'border-line bg-fill/50 hover:bg-fill',
                  )}
                >
                  <span className={cx('grid h-9 w-9 place-items-center rounded-[10px]', active ? 'bg-accent text-on-accent' : 'bg-fill text-ink-2')}>
                    <o.icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[15px] font-semibold">{o.title}</span>
                  <span className="text-[12px] leading-snug text-ink-2">{o.text}</span>
                </button>
              );
            })}
          </div>
        </div>
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

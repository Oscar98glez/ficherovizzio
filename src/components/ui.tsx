import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronRight } from 'lucide-react';
import type { Tone } from '../lib/constants';
import { cx, initials } from '../lib/utils';

// ---------- Botones ----------

type Variant = 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger' | 'danger-tinted' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 shadow-sm',
  secondary: 'bg-fill text-ink hover:bg-fill-2',
  tinted: 'bg-accent/10 text-accent hover:bg-accent/15',
  ghost: 'text-accent hover:bg-accent/10',
  danger: 'bg-red text-white hover:brightness-110 shadow-sm',
  'danger-tinted': 'bg-red/10 text-red hover:bg-red/15',
  success: 'bg-green text-white hover:brightness-110 shadow-sm',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5 [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-10 px-4 text-[15px] gap-2 [&_svg]:h-[18px] [&_svg]:w-[18px]',
  lg: 'h-12 px-6 text-[17px] gap-2 [&_svg]:h-5 [&_svg]:w-5',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-medium transition duration-150',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="!h-4 !w-4" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  className,
  label,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-2 transition hover:bg-fill hover:text-ink active:scale-95',
        'disabled:pointer-events-none disabled:opacity-30 [&_svg]:h-[18px] [&_svg]:w-[18px]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Contenedores ----------

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', className)} {...rest} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-3 px-5 pb-3 pt-5', className)}>
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="mb-6 lg:mb-8">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.025em] md:text-[34px]">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-8 flex items-center justify-between px-1 first:mt-0">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">{children}</h2>
      {action}
    </div>
  );
}

/** Lista agrupada estilo iOS */
export function List({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card divide-y divide-line overflow-hidden', className)}>{children}</div>;
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  chevron,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 px-4 py-3 text-left',
        onClick && 'transition hover:bg-fill/60 active:bg-fill',
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{title}</div>
        {subtitle && <div className="truncate text-[13px] text-ink-2">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />}
    </Comp>
  );
}

// ---------- Formularios ----------

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx('input', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={cx('input', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx('input', className)} {...rest} />;
  },
);

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
}) {
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-green' : 'bg-fill-2',
      )}
    >
      <span
        className={cx(
          'absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
  if (!label) return toggle;
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[15px] font-medium">{label}</div>
        {description && <div className="text-[13px] text-ink-2">{description}</div>}
      </div>
      {toggle}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  full,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  full?: boolean;
}) {
  return (
    <div className={cx('inline-flex rounded-[10px] bg-fill p-[3px]', full && 'flex w-full', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'h-[30px] flex-1 whitespace-nowrap rounded-[8px] px-3.5 text-[13px] font-medium transition-all duration-200',
            value === o.value
              ? 'bg-surface text-ink shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] dark:bg-elevated'
              : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Indicadores ----------

export const TONES: Record<Tone, string> = {
  gray: 'bg-fill text-ink-2',
  blue: 'bg-accent/10 text-accent',
  green: 'bg-green/15 text-green',
  red: 'bg-red/10 text-red',
  orange: 'bg-orange/15 text-orange',
  purple: 'bg-purple/15 text-purple',
  teal: 'bg-teal/15 text-teal',
  pink: 'bg-pink/10 text-pink',
  indigo: 'bg-indigo/15 text-indigo',
};

export function Badge({ tone = 'gray', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cx('relative inline-flex h-2 w-2', className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
    </span>
  );
}

export function Avatar({
  name,
  color = '#8e8e93',
  size = 36,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cx('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(160deg, ${color}cc, ${color})`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('h-5 w-5 animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-ink-2">
      <Spinner />
      <span className="text-[15px]">{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-[15px] text-red">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-fill text-ink-3 [&_svg]:h-7 [&_svg]:w-7">
          {icon}
        </div>
      )}
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-[14px] text-ink-2">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'blue',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card className={cx('p-4 sm:p-5', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
        {icon && (
          <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-[10px] [&_svg]:h-4 [&_svg]:w-4', TONES[tone])}>
            {icon}
          </span>
        )}
      </div>
      <div className="tabular mt-1.5 truncate text-[clamp(19px,1.75vw,26px)] font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[13px] text-ink-2">{sub}</div>}
    </Card>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input h-9 rounded-[10px] pl-9 text-[15px]"
      />
    </div>
  );
}

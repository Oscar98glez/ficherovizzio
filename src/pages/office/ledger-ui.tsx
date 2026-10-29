/** Piezas de la pantalla de Administración: tarjetas, casillas de importe y el selector de efectivo / banco */
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { Banknote, CreditCard, Ticket, type LucideIcon } from 'lucide-react';
import { fmtAmount, parseLedgerAmount, type LedgerMethod } from '../../lib/ledger';
import { cx } from '../../lib/utils';

/** Tarjeta blanca grande */
export function Panel({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx('rounded-[24px] bg-surface p-5 shadow-card sm:p-7', className)} {...rest} />;
}

export function PanelTitle({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="text-[21px] font-semibold tracking-[-0.02em]">{title}</h3>
      {aside && <div className="text-[14px] text-ink-2">{aside}</div>}
    </div>
  );
}

/** Barra horizontal de un importe sobre un máximo */
export function Bar({ value, max, className, color = 'bg-ink' }: { value: number; max: number; className?: string; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className={cx('flex h-2 overflow-hidden rounded-full bg-fill', className)}>
      <span className={cx('rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </span>
  );
}

export const INCOME_ICONS: Record<string, LucideIcon> = { efectivo: Banknote, banco: CreditCard, plataforma: Ticket };

/** Texto de una casilla de importe mientras se escribe ("1234,5") a partir del número guardado */
export const amountText = (n: number | null | undefined) => (n ? String(n).replace('.', ',') : '');

/**
 * Casilla de importe grande. Se escribe como en el Excel ("1234,56" o "1.234,56") y al salir se
 * muestra con los puntos de los miles.
 */
export function MoneyInput({
  value,
  onChange,
  label,
  hint,
  icon: Icon,
  iconClass,
  size = 'lg',
  autoFocus,
}: {
  value: string;
  onChange: (text: string) => void;
  label: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  iconClass?: string;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const n = parseLedgerAmount(value);
  const shown = focused || n === null ? value : fmtAmount(n);
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="flex items-center gap-2 text-[15px] font-medium">
        {Icon && <Icon className={cx('h-[18px] w-[18px]', iconClass)} strokeWidth={2} />}
        {label}
      </span>
      <span className="relative">
        <input
          inputMode="decimal"
          autoFocus={autoFocus}
          value={shown}
          placeholder="0,00"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          className={cx(
            'tabular w-full rounded-2xl border border-line bg-surface pl-4 pr-10 text-right font-semibold tracking-[-0.02em] text-ink outline-none transition',
            'placeholder:text-ink-3/60 focus:border-accent focus:ring-4 focus:ring-accent/15',
            size === 'lg' ? 'h-[60px] text-[26px]' : 'h-[52px] text-[20px]',
          )}
        />
        <span className={cx('pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-medium text-ink-3', size === 'lg' ? 'text-[20px]' : 'text-[17px]')}>€</span>
      </span>
      {hint && <span className="text-[13px] text-ink-2">{hint}</span>}
    </label>
  );
}

/** ¿En efectivo o por el banco? Dos botones grandes */
export function MethodToggle({ value, onChange }: { value: LedgerMethod; onChange: (m: LedgerMethod) => void }) {
  const opt = (m: LedgerMethod, label: string, Icon: LucideIcon) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      aria-pressed={value === m}
      className={cx(
        'flex flex-1 items-center justify-center gap-2 rounded-[12px] text-[16px] transition',
        value === m ? 'bg-surface font-semibold text-ink shadow-[0_1px_3px_rgba(0,0,0,0.14)] dark:bg-elevated' : 'font-medium text-ink-2 hover:text-ink',
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Cómo se pagó" className="flex h-[56px] gap-1 rounded-[15px] bg-fill p-1">
      {opt('cash', 'En efectivo', Banknote)}
      {opt('bank', 'Por el banco', CreditCard)}
    </div>
  );
}

/** Chip seleccionable (¿a quién?, otro día...) */
export function Chip({ selected, onClick, children }: { selected?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'h-10 rounded-full px-4 text-[15px] font-medium transition active:scale-[0.97]',
        selected ? 'bg-ink text-surface' : 'bg-surface text-ink ring-1 ring-inset ring-line hover:bg-fill',
      )}
    >
      {children}
    </button>
  );
}

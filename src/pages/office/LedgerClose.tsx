import { useState } from 'react';
import { useFeedback } from '../../components/overlay';
import { Button, Textarea } from '../../components/ui';
import { fmtEuros2, monthName, parseLedgerAmount, shiftMonth, type LedgerMonthCash } from '../../lib/ledger';
import type { AdminLedgerMonth } from '../../lib/types';
import { cx } from '../../lib/utils';
import { amountText, MoneyInput, Panel } from './ledger-ui';

type Patch = Partial<Pick<AdminLedgerMonth, 'cash_carry' | 'bank_carry' | 'cash_adjust' | 'bank_adjust' | 'note'>>;

/**
 * Cierre del mes: lo que viene del mes anterior, lo que entra y sale, el ajuste y lo que pasa al mes
 * siguiente, en efectivo y en el banco. Lo que viene del mes anterior se calcula solo, pero se puede
 * cambiar (por ejemplo, el primer mes que se usa la app).
 */
export function LedgerClose({ month, cash, row, onSave }: { month: string; cash: LedgerMonthCash; row: AdminLedgerMonth | null; onSave: (patch: Patch) => Promise<void> }) {
  const { toast } = useFeedback();
  const prevName = monthName(shiftMonth(month, -1));
  const nextName = monthName(shiftMonth(month, 1));
  const t = cash.totals;
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(() => ({
    cash_carry: amountText(row?.cash_carry ?? null),
    bank_carry: amountText(row?.bank_carry ?? null),
    cash_adjust: amountText(row?.cash_adjust ?? null),
    bank_adjust: amountText(row?.bank_adjust ?? null),
  }));
  const [note, setNote] = useState(row?.note ?? '');
  const [saving, setSaving] = useState(false);

  async function save(patch: Patch, message: string) {
    setSaving(true);
    try {
      await onSave(patch);
      toast.success(message);
      setEdit(false);
    } catch {
      /* el aviso ya se ha mostrado */
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    const patch: Patch = {};
    for (const k of ['cash_carry', 'bank_carry', 'cash_adjust', 'bank_adjust'] as const) {
      const text = form[k].trim();
      const n = text ? parseLedgerAmount(text) : null;
      if (text && n === null) return toast.error('Revisa los importes: escribe sólo números, por ejemplo 1234,50');
      patch[k] = n;
    }
    void save(patch, 'Cierre guardado');
  }

  const rows: { label: string; cash: number; bank: number; strong?: boolean; tone?: string }[] = [
    { label: `Viene de ${prevName}`, cash: cash.cashStart, bank: cash.bankStart },
    { label: 'Ha entrado', cash: t.cashIn, bank: t.bankIn, tone: 'text-green' },
    { label: 'Ha salido', cash: -t.cashOut, bank: -t.bankOut },
    { label: 'Ajuste', cash: cash.cashAdjust, bank: cash.bankAdjust },
    { label: `Pasa a ${nextName}`, cash: cash.cashEnd, bank: cash.bankEnd, strong: true },
  ];

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <header>
        <p className="text-[15px] text-ink-2">Efectivo y banco</p>
        <h2 className="text-[30px] font-bold leading-tight tracking-[-0.03em] sm:text-[34px]">Cierre de {monthName(month)}</h2>
      </header>

      <Panel className="tabular">
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] text-[15px] sm:text-[16px]">
          <span />
          <span className="pb-2 text-right text-[13px] font-medium text-ink-2">En efectivo</span>
          <span className="pb-2 text-right text-[13px] font-medium text-ink-2">En el banco</span>
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <span className={cx('border-t border-line py-3.5', r.strong && 'font-semibold')}>{r.label}</span>
              {[r.cash, r.bank].map((v, i) => (
                <span key={i} className={cx('border-t border-line py-3.5 text-right', r.strong ? 'text-[18px] font-bold sm:text-[20px]' : r.tone && v ? r.tone : '', r.strong && v < 0 && 'text-red')}>
                  {r.label === 'Ha entrado' && v ? '+' : ''}
                  {fmtEuros2(v)}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-4 text-[14px] text-ink-2">
          {cash.cashStartManual || cash.bankStartManual
            ? `Lo que viene de ${prevName} está escrito a mano.`
            : `Lo que viene de ${prevName} es lo que quedó al cerrarlo: no hace falta escribirlo.`}{' '}
          Lo que queda al final pasa solo a {nextName}.
        </p>
      </Panel>

      {edit ? (
        <Panel>
          <h3 className="text-[21px] font-semibold tracking-[-0.02em]">Cambiar el cierre</h3>
          <p className="mt-1 text-[15px] text-ink-2">Deja en blanco lo que viene de {prevName} para que se calcule solo.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <MoneyInput size="md" label={`Efectivo que viene de ${prevName}`} hint={`Calculado: ${fmtEuros2(cash.cashStart)}`} value={form.cash_carry} onChange={(v) => setForm({ ...form, cash_carry: v })} />
            <MoneyInput size="md" label={`Banco que viene de ${prevName}`} hint={`Calculado: ${fmtEuros2(cash.bankStart)}`} value={form.bank_carry} onChange={(v) => setForm({ ...form, bank_carry: v })} />
            <MoneyInput size="md" label="Ajuste del efectivo" hint="Lo que falte o sobre al contar la caja (en negativo si falta)" value={form.cash_adjust} onChange={(v) => setForm({ ...form, cash_adjust: v })} />
            <MoneyInput size="md" label="Ajuste del banco" hint="Comisiones, devoluciones… (en negativo si resta)" value={form.bank_adjust} onChange={(v) => setForm({ ...form, bank_adjust: v })} />
          </div>
          <div className="mt-6 flex justify-end gap-2.5">
            <Button variant="secondary" size="lg" onClick={() => setEdit(false)}>
              Cancelar
            </Button>
            <Button variant="solid" size="lg" loading={saving} onClick={submit}>
              Guardar
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="flex justify-end">
          <Button variant="secondary" size="lg" onClick={() => setEdit(true)}>
            Cambiar el cierre o un ajuste
          </Button>
        </div>
      )}

      <Panel>
        <h3 className="mb-3 text-[21px] font-semibold tracking-[-0.02em]">Notas del mes</h3>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lo que haya que recordar de este mes" className="min-h-[110px] text-[16px]" />
        {(note.trim() || null) !== (row?.note ?? null) && (
          <div className="mt-3 flex justify-end">
            <Button variant="solid" loading={saving} onClick={() => void save({ note: note.trim() || null }, 'Nota guardada')}>
              Guardar la nota
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { CheckCircle2, Download, Eye, FileImage, FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Modal, useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, PageHeader, SearchInput, Segmented, Select, StatCard, Switch, Textarea } from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage, files } from '../../lib/api';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../lib/constants';
import { businessToday, isoDate, makePeriod } from '../../lib/dates';
import { fmtDate, fmtMoney } from '../../lib/format';
import type { Invoice, InvoiceKind, InvoiceStatus } from '../../lib/types';
import { cx, parseAmount, sumBy, uid } from '../../lib/utils';

const MAX_SIZE = 15 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

const KIND_LABEL: Record<InvoiceKind, string> = { received: 'Recibida', issued: 'Emitida' };
const isPdf = (i: Pick<Invoice, 'mime_type' | 'file_name'>) => i.mime_type === 'application/pdf' || /\.pdf$/i.test(i.file_name);

const fmtSize = (bytes: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/** Nombre de archivo seguro para el almacenamiento (sin tildes ni espacios) */
const safeName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);

/**
 * Abre el archivo en otra pestaña. La ventana se abre antes de pedir el enlace para que
 * el navegador del móvil no la bloquee como ventana emergente.
 */
async function openFile(inv: Invoice, download: boolean, onError: (m: string) => void) {
  const win = window.open('', '_blank');
  try {
    const url = await files.url(inv.file_path, download ? inv.file_name : undefined);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    win?.close();
    onError(errorMessage(e));
  }
}

// =====================================================================
//  Formulario para subir / editar una factura
// =====================================================================

function InvoiceForm({
  open,
  onClose,
  invoice,
  onSaved,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  invoice?: Invoice | null;
  onSaved: () => void;
  footer?: ReactNode;
}) {
  const { toast } = useFeedback();
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const init = () => ({
    kind: (invoice?.kind ?? 'received') as InvoiceKind,
    party: invoice?.party ?? '',
    number: invoice?.number ?? '',
    date: invoice?.date ?? isoDate(businessToday()),
    due_date: invoice?.due_date ?? '',
    amount: invoice ? String(invoice.amount).replace('.', ',') : '',
    tax: invoice?.tax != null ? String(invoice.tax).replace('.', ',') : '',
    category: invoice?.category ?? 'Proveedores bebida',
    status: (invoice?.status ?? 'pending') as InvoiceStatus,
    notes: invoice?.notes ?? '',
    addMovement: false,
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (!open) return;
    setF(init());
    setFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice]);

  const categories = f.kind === 'received' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  function pick(list: FileList | null) {
    const chosen = list?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_SIZE) return toast.error('El archivo es demasiado grande (máximo 15 MB)');
    if (chosen.type && !ACCEPT.split(',').includes(chosen.type)) return toast.error('Sube un PDF o una imagen (JPG, PNG, WEBP o HEIC)');
    setFile(chosen);
    // Si el nombre del archivo parece un número de factura y aún no hay uno, se propone
    if (!f.number && !invoice) setF((s) => ({ ...s, number: chosen.name.replace(/\.[^.]+$/, '').replace(/^factura[\s_-]*/i, '').slice(0, 40) }));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  }

  async function submit() {
    if (!invoice && !file) return toast.error('Adjunta el archivo de la factura');
    if (!f.party.trim()) return toast.error(f.kind === 'received' ? 'Indica el proveedor' : 'Indica el cliente');
    const amount = parseAmount(f.amount);
    if (amount < 0) return toast.error('El importe no es válido');
    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      const values: Partial<Invoice> = {
        kind: f.kind,
        party: f.party.trim(),
        number: f.number.trim() || null,
        date: f.date,
        due_date: f.due_date || null,
        amount,
        tax: f.tax.trim() ? parseAmount(f.tax) : null,
        category: f.category || null,
        status: f.status,
        notes: f.notes.trim() || null,
      };
      if (file) {
        uploadedPath = `${f.date.slice(0, 4)}/${f.date.slice(5, 7)}/${uid()}-${safeName(file.name)}`;
        await files.upload(uploadedPath, file);
        Object.assign(values, { file_path: uploadedPath, file_name: file.name, file_size: file.size, mime_type: file.type || null });
      }

      if (invoice) {
        await api.invoices.update(invoice.id, values);
        // Si se ha sustituido el archivo, se borra el anterior
        if (file) await files.remove(invoice.file_path).catch(() => {});
      } else {
        if (f.addMovement && amount > 0) {
          const tx = await api.transactions.create({
            kind: f.kind === 'received' ? 'expense' : 'income',
            category: f.category,
            amount,
            date: f.date,
            method: 'transferencia',
            description: `Factura ${values.number ?? ''} · ${values.party}`.replace('  ', ' '),
          });
          values.transaction_id = tx.id;
        }
        await api.invoices.create(values);
      }
      toast.success(invoice ? 'Factura actualizada' : f.addMovement ? 'Factura guardada y registrada en Finanzas' : 'Factura guardada');
      onSaved();
      onClose();
    } catch (e) {
      // Si falla al guardar los datos, no se deja el archivo huérfano
      if (uploadedPath && !invoice) await files.remove(uploadedPath).catch(() => {});
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const currentName = file?.name ?? invoice?.file_name;

  return (
    <Modal open={open} onClose={onClose} title={invoice ? 'Editar factura' : 'Subir factura'} onSubmit={submit} submitLabel="Guardar" saving={saving} wide footer={footer}>
      <div className="space-y-4">
        {/* Archivo */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          className={cx(
            'flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-4 transition',
            dragging ? 'border-accent bg-accent/10' : currentName ? 'border-green/50 bg-green/5' : 'border-line bg-fill/50 hover:bg-fill',
          )}
        >
          <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-xl', currentName ? 'bg-green/15 text-green' : 'bg-accent/15 text-accent')}>
            {currentName ? <FileText className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{currentName ?? 'Elige el archivo de la factura'}</div>
            <div className="text-[13px] text-ink-2">
              {file
                ? `${fmtSize(file.size)} · pulsa para cambiarlo`
                : invoice
                  ? 'Pulsa para sustituir el archivo'
                  : 'PDF o foto (JPG, PNG, HEIC) · máx. 15 MB · también puedes arrastrarlo aquí'}
            </div>
          </div>
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files)} />
        </div>

        <Segmented
          full
          value={f.kind}
          onChange={(kind) => setF({ ...f, kind, category: kind === 'received' ? 'Proveedores bebida' : INCOME_CATEGORIES[0] })}
          options={[
            { value: 'received', label: 'Recibida (de proveedor)' },
            { value: 'issued', label: 'Emitida (a cliente)' },
          ]}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={f.kind === 'received' ? 'Proveedor' : 'Cliente'}>
            <Input value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} placeholder={f.kind === 'received' ? 'Ej. Distribuidora Martínez' : 'Ej. Empresa Acme'} required />
          </Field>
          <Field label="Nº de factura">
            <Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder="Opcional" />
          </Field>
          <Field label="Fecha de la factura">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="Vencimiento">
            <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
          <Field label="Importe total (€)">
            <Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" />
          </Field>
          <Field label="IVA incluido (€)" hint="Opcional">
            <Input inputMode="decimal" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} placeholder="0,00" />
          </Field>
          <Field label="Categoría">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {(categories.includes(f.category) ? categories : [...categories, f.category]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Estado">
            <Segmented
              full
              value={f.status}
              onChange={(status) => setF({ ...f, status })}
              options={[
                { value: 'pending', label: f.kind === 'received' ? 'Pendiente de pago' : 'Pendiente de cobro' },
                { value: 'paid', label: f.kind === 'received' ? 'Pagada' : 'Cobrada' },
              ]}
            />
          </Field>
        </div>

        <Field label="Notas">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Opcional" className="min-h-[64px]" />
        </Field>

        {!invoice && (
          <div className="rounded-xl bg-fill/60 p-4">
            <Switch
              checked={f.addMovement}
              onChange={(addMovement) => setF({ ...f, addMovement })}
              label="Registrar también en Finanzas"
              description={`Crea un ${f.kind === 'received' ? 'gasto' : 'ingreso'} con este importe. Déjalo desactivado si ya lo has apuntado.`}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

// =====================================================================
//  Página de facturas
// =====================================================================

type KindFilter = 'all' | InvoiceKind;
type StatusFilter = '' | InvoiceStatus;

export default function Invoices() {
  const { toast, confirm } = useFeedback();
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ invoice: Invoice | null } | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [inPeriod, pending] = await Promise.all([
      api.invoices.list({ gte: ['date', period.from], lt: ['date', period.to], order: ['date', 'desc'] }),
      api.invoices.list({ eq: { status: 'pending' } }),
    ]);
    return { inPeriod, pending };
  }, [period]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.inPeriod ?? [])
      .filter((i) => kind === 'all' || i.kind === kind)
      .filter((i) => !status || i.status === status)
      .filter((i) => !term || `${i.party} ${i.number ?? ''} ${i.category ?? ''} ${i.notes ?? ''} ${i.file_name}`.toLowerCase().includes(term));
  }, [data, kind, status, q]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const received = data.inPeriod.filter((i) => i.kind === 'received');
  const issued = data.inPeriod.filter((i) => i.kind === 'issued');
  const toPay = data.pending.filter((i) => i.kind === 'received');
  const today = isoDate(new Date());

  async function markPaid(inv: Invoice) {
    try {
      await api.invoices.update(inv.id, { status: 'paid' });
      toast.success(inv.kind === 'received' ? 'Marcada como pagada' : 'Marcada como cobrada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(inv: Invoice) {
    const ok = await confirm({
      title: '¿Eliminar esta factura?',
      message: `Se borrará el archivo "${inv.file_name}".${inv.transaction_id ? ' El movimiento de Finanzas se conserva.' : ''}`,
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.invoices.remove(inv.id);
      await files.remove(inv.file_path).catch(() => {});
      toast.success('Factura eliminada');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Facturas"
        subtitle="Guarda las facturas de proveedores y las que emites a clientes"
        actions={
          <Button icon={<Plus />} onClick={() => setModal({ invoice: null })}>
            Subir factura
          </Button>
        }
      />

      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} units={['month', 'year']} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
        <StatCard label="Facturas del periodo" value={data.inPeriod.length} sub={`${received.length} recibidas · ${issued.length} emitidas`} />
        <StatCard label="Gasto en facturas" value={fmtMoney(sumBy(received, (i) => i.amount))} sub="Recibidas del periodo" />
        <StatCard label="Facturado a clientes" value={fmtMoney(sumBy(issued, (i) => i.amount))} sub="Emitidas del periodo" tone="green" />
        <StatCard
          label="Pendiente de pago"
          value={<span className={toPay.length ? 'text-orange' : ''}>{fmtMoney(sumBy(toPay, (i) => i.amount))}</span>}
          sub={`${toPay.length} factura${toPay.length === 1 ? '' : 's'} (todas las fechas)`}
        />
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar proveedor, nº, categoría…" className="sm:w-72" />
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'received', label: 'Recibidas' },
            { value: 'issued', label: 'Emitidas' },
          ]}
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 w-full rounded-[10px] text-[14px] sm:w-auto">
          <option value="">Cualquier estado</option>
          <option value="pending">Pendientes</option>
          <option value="paid">Pagadas / cobradas</option>
        </Select>
      </div>

      {list.length ? (
        <Card className="divide-y divide-line overflow-hidden">
          {list.map((inv) => {
            const overdue = inv.status === 'pending' && inv.due_date && inv.due_date < today;
            return (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                <button
                  type="button"
                  onClick={() => openFile(inv, false, toast.error)}
                  title="Ver factura"
                  className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-xl transition hover:brightness-95', isPdf(inv) ? 'bg-red/10 text-red' : 'bg-accent/15 text-accent')}
                >
                  {isPdf(inv) ? <FileText className="h-5 w-5" /> : <FileImage className="h-5 w-5" />}
                </button>
                <button type="button" onClick={() => setModal({ invoice: inv })} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-[15px] font-semibold">{inv.party}</span>
                    {inv.number && <span className="truncate text-[13px] text-ink-2">nº {inv.number}</span>}
                  </div>
                  <div className="truncate text-[13px] text-ink-2">
                    {fmtDate(inv.date, { day: 'numeric', month: 'short', year: 'numeric' })} · {KIND_LABEL[inv.kind]}
                    {inv.category && ` · ${inv.category}`}
                    {inv.due_date && inv.status === 'pending' && ` · vence ${fmtDate(inv.due_date)}`}
                  </div>
                </button>
                <button type="button" onClick={() => setModal({ invoice: inv })} className="shrink-0 text-right">
                  <div className={cx('tabular text-[15px] font-semibold', inv.kind === 'issued' && 'text-green')}>{fmtMoney(inv.amount)}</div>
                  {inv.status === 'paid' ? (
                    <Badge tone="green" className="mt-0.5">
                      {inv.kind === 'received' ? 'Pagada' : 'Cobrada'}
                    </Badge>
                  ) : (
                    <Badge tone={overdue ? 'red' : 'orange'} className="mt-0.5">
                      {overdue ? 'Vencida' : 'Pendiente'}
                    </Badge>
                  )}
                </button>
                <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
                  <IconButton label="Ver" onClick={() => openFile(inv, false, toast.error)}>
                    <Eye />
                  </IconButton>
                  <IconButton label="Descargar" onClick={() => openFile(inv, true, toast.error)}>
                    <Download />
                  </IconButton>
                  {inv.status === 'pending' && (
                    <IconButton label={inv.kind === 'received' ? 'Marcar como pagada' : 'Marcar como cobrada'} onClick={() => markPaid(inv)} className="hover:text-green">
                      <CheckCircle2 />
                    </IconButton>
                  )}
                  <IconButton label="Editar" onClick={() => setModal({ invoice: inv })}>
                    <Pencil />
                  </IconButton>
                  <IconButton label="Eliminar" onClick={() => remove(inv)} className="hover:text-red">
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<FileText />}
            title={data.inPeriod.length ? 'Sin resultados' : 'No hay facturas en este periodo'}
            message={data.inPeriod.length ? 'Prueba con otra búsqueda o filtro.' : 'Sube la primera: PDF o una foto hecha con el móvil.'}
            action={!data.inPeriod.length && <Button icon={<Upload />} onClick={() => setModal({ invoice: null })}>Subir factura</Button>}
          />
        </Card>
      )}

      <InvoiceForm
        open={!!modal}
        onClose={() => setModal(null)}
        invoice={modal?.invoice}
        onSaved={reload}
        footer={
          modal?.invoice && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button variant="secondary" icon={<Eye />} onClick={() => openFile(modal.invoice!, false, toast.error)}>
                Ver
              </Button>
              <Button variant="secondary" icon={<Download />} onClick={() => openFile(modal.invoice!, true, toast.error)}>
                Descargar
              </Button>
              {modal.invoice.status === 'pending' ? (
                <Button variant="tinted" icon={<CheckCircle2 />} onClick={() => (setModal(null), markPaid(modal.invoice!))}>
                  {modal.invoice.kind === 'received' ? 'Pagada' : 'Cobrada'}
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}
              <Button variant="danger-tinted" icon={<Trash2 />} onClick={() => (setModal(null), remove(modal.invoice!))}>
                Eliminar
              </Button>
            </div>
          )
        }
      />
    </>
  );
}

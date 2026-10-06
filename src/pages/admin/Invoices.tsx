import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { Modal, useFeedback } from '../../components/overlay';
import { PeriodPicker } from '../../components/PeriodPicker';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  PageHeader,
  SearchInput,
  SectionTitle,
  Segmented,
  Select,
  StatCard,
  Switch,
  Textarea,
} from '../../components/ui';
import { useLoad } from '../../hooks';
import { api, errorMessage, files } from '../../lib/api';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../lib/constants';
import { businessToday, isoDate, makePeriod } from '../../lib/dates';
import { fmtDate, fmtMoney } from '../../lib/format';
import type { Invoice, InvoiceKind, InvoiceStatus, Supplier } from '../../lib/types';
import { cx, groupBy, parseAmount, sumBy, uid } from '../../lib/utils';

const MAX_SIZE = 15 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

const NEW_SUPPLIER = '__nuevo__';

const KIND_LABEL: Record<InvoiceKind, string> = { received: 'Recibida', issued: 'Emitida' };
const isPdf = (i: Pick<Invoice, 'mime_type' | 'file_name'>) => i.mime_type === 'application/pdf' || /\.pdf$/i.test(i.file_name);

const fmtSize = (bytes: number | null) =>
  bytes == null
    ? ''
    : bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

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
  suppliers,
  defaultSupplierId,
}: {
  open: boolean;
  onClose: () => void;
  invoice?: Invoice | null;
  onSaved: () => void;
  footer?: ReactNode;
  suppliers: Supplier[];
  /** Proveedor elegido al subir desde su apartado */
  defaultSupplierId?: string;
}) {
  const { toast } = useFeedback();
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const init = () => {
    const pre = suppliers.find((x) => x.id === (invoice ? invoice.supplier_id : defaultSupplierId));
    return {
      kind: (invoice?.kind ?? 'received') as InvoiceKind,
      // Proveedor de la lista: id, NEW_SUPPLIER (escribir uno nuevo) o '' (sin elegir)
      supplier: pre ? pre.id : invoice?.kind === 'received' && invoice.party ? NEW_SUPPLIER : '',
      party: invoice?.party ?? '',
      number: invoice?.number ?? '',
      date: invoice?.date ?? isoDate(businessToday()),
      due_date: invoice?.due_date ?? '',
      amount: invoice ? String(invoice.amount).replace('.', ',') : '',
      tax: invoice?.tax != null ? String(invoice.tax).replace('.', ',') : '',
      category: invoice?.category ?? pre?.category ?? 'Proveedores bebida',
      status: (invoice?.status ?? 'pending') as InvoiceStatus,
      notes: invoice?.notes ?? '',
      addMovement: false,
    };
  };
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
    if (!f.number && !invoice)
      setF((s) => ({
        ...s,
        number: chosen.name
          .replace(/\.[^.]+$/, '')
          .replace(/^factura[\s_-]*/i, '')
          .slice(0, 40),
      }));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  }

  async function submit() {
    if (!invoice && !file) return toast.error('Adjunta el archivo de la factura');
    const chosen = f.kind === 'received' ? suppliers.find((x) => x.id === f.supplier) : undefined;
    const partyName = chosen ? chosen.name : f.party.trim();
    if (!partyName) return toast.error(f.kind === 'received' ? 'Elige el proveedor' : 'Indica el cliente');
    const amount = parseAmount(f.amount);
    if (amount < 0) return toast.error('El importe no es válido');
    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      // Proveedor nuevo escrito a mano: se crea su apartado (o se usa el que ya tenga ese nombre)
      let supplierId: string | null = chosen?.id ?? null;
      if (f.kind === 'received' && !chosen) {
        const same = suppliers.find((x) => x.name.trim().toLowerCase() === partyName.toLowerCase());
        supplierId = same ? same.id : (await api.suppliers.create({ name: partyName, category: f.category || null })).id;
      }
      const values: Partial<Invoice> = {
        kind: f.kind,
        party: partyName,
        supplier_id: f.kind === 'received' ? supplierId : null,
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
    <Modal
      open={open}
      onClose={onClose}
      title={invoice ? 'Editar factura' : 'Subir factura'}
      onSubmit={submit}
      submitLabel="Guardar"
      saving={saving}
      wide
      footer={footer}
    >
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
          <span
            className={cx(
              'grid h-12 w-12 shrink-0 place-items-center rounded-xl',
              currentName ? 'bg-green/15 text-green' : 'bg-accent/15 text-accent',
            )}
          >
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
          {f.kind === 'received' ? (
            <Field label="Proveedor">
              <Select
                value={f.supplier}
                onChange={(e) => {
                  const v = e.target.value;
                  const sup = suppliers.find((x) => x.id === v);
                  setF({ ...f, supplier: v, party: sup ? sup.name : v === NEW_SUPPLIER ? '' : f.party, category: sup?.category ?? f.category });
                }}
              >
                <option value="">Elige el proveedor</option>
                {suppliers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
                <option value={NEW_SUPPLIER}>+ Nuevo proveedor…</option>
              </Select>
              {f.supplier === NEW_SUPPLIER && (
                <Input
                  className="mt-2"
                  value={f.party}
                  onChange={(e) => setF({ ...f, party: e.target.value })}
                  placeholder="Nombre del proveedor"
                  autoFocus={!invoice}
                />
              )}
            </Field>
          ) : (
            <Field label="Cliente">
              <Input value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} placeholder="Ej. Empresa Acme" required />
            </Field>
          )}
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
//  Proveedor (alta / edición)
// =====================================================================

function SupplierForm({
  open,
  onClose,
  supplier,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  supplier?: Supplier | null;
  onSaved: (s: Supplier) => void;
  onDeleted?: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [saving, setSaving] = useState(false);
  const init = () => ({
    name: supplier?.name ?? '',
    category: supplier?.category ?? 'Proveedores bebida',
    tax_id: supplier?.tax_id ?? '',
    contact: supplier?.contact ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    notes: supplier?.notes ?? '',
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier]);

  async function submit() {
    if (!f.name.trim()) return toast.error('Escribe el nombre del proveedor');
    setSaving(true);
    try {
      const values: Partial<Supplier> = {
        name: f.name.trim(),
        category: f.category || null,
        tax_id: f.tax_id.trim() || null,
        contact: f.contact.trim() || null,
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        notes: f.notes.trim() || null,
      };
      const saved = supplier ? await api.suppliers.update(supplier.id, values) : await api.suppliers.create(values);
      toast.success(supplier ? 'Proveedor actualizado' : 'Proveedor creado');
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!supplier) return;
    const ok = await confirm({
      title: `¿Eliminar ${supplier.name}?`,
      message: 'Sus facturas no se borran: quedarán en "Sin proveedor".',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.suppliers.remove(supplier.id);
      toast.success('Proveedor eliminado');
      onClose();
      onDeleted?.();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
      onSubmit={submit}
      submitLabel={supplier ? 'Guardar' : 'Crear'}
      saving={saving}
    >
      <div className="space-y-4">
        <Field label="Nombre">
          <Input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Ej. Distribuidora Martínez"
            autoFocus={!supplier}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Categoría de gasto" hint="Se propone al subir sus facturas">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {(EXPENSE_CATEGORIES.includes(f.category) ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, f.category]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="CIF / NIF">
            <Input value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} placeholder="Opcional" />
          </Field>
          <Field label="Persona de contacto">
            <Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="Opcional" />
          </Field>
          <Field label="Teléfono">
            <Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Opcional" />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Opcional" />
        </Field>
        <Field label="Notas">
          <Textarea
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            placeholder="Condiciones, día de reparto, nº de cliente…"
            className="min-h-[64px]"
          />
        </Field>
        {supplier && (
          <Button variant="danger-tinted" className="w-full" icon={<Trash2 />} onClick={remove}>
            Eliminar proveedor
          </Button>
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
/** Apartado abierto: un proveedor o las facturas recibidas sin proveedor */
type Folder = { type: 'supplier'; id: string } | { type: 'none' };

const NO_SUPPLIER = 'Sin proveedor';

export default function Invoices() {
  const { toast, confirm } = useFeedback();
  const [period, setPeriod] = useState(() => makePeriod('month'));
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ invoice: Invoice | null; supplierId?: string } | null>(null);
  const [supplierModal, setSupplierModal] = useState<{ supplier: Supplier | null } | null>(null);
  const [folder, setFolder] = useState<Folder | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [inPeriod, pending, received, suppliers] = await Promise.all([
      api.invoices.list({ gte: ['date', period.from], lt: ['date', period.to], order: ['date', 'desc'] }),
      api.invoices.list({ eq: { status: 'pending' } }),
      // Todas las recibidas, para los apartados de cada proveedor
      api.invoices.list({ eq: { kind: 'received' }, order: ['date', 'desc'] }),
      api.suppliers.list({ order: ['name', 'asc'] }),
    ]);
    return { inPeriod, pending, received, suppliers };
  }, [period]);

  const folders = useMemo(() => {
    if (!data) return [];
    const bySupplier = groupBy(data.received, (i) => i.supplier_id ?? '');
    const today = isoDate(new Date());
    const stats = (list: Invoice[]) => ({
      count: list.length,
      total: sumBy(list, (i) => i.amount),
      pending: sumBy(
        list.filter((i) => i.status === 'pending'),
        (i) => i.amount,
      ),
      overdue: list.some((i) => i.status === 'pending' && i.due_date && i.due_date < today),
      last: list[0]?.date ?? null,
    });
    return data.suppliers.map((s) => ({ supplier: s, ...stats(bySupplier[s.id] ?? []) }));
  }, [data]);

  const term = q.trim().toLowerCase();
  const matches = (i: Invoice) =>
    (!status || i.status === status) &&
    (!term || `${i.party} ${i.number ?? ''} ${i.category ?? ''} ${i.notes ?? ''} ${i.file_name}`.toLowerCase().includes(term));

  const list = useMemo(() => (data?.inPeriod ?? []).filter((i) => kind === 'all' || i.kind === kind).filter(matches), [data, kind, status, term]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const received = data.inPeriod.filter((i) => i.kind === 'received');
  const issued = data.inPeriod.filter((i) => i.kind === 'issued');
  const toPay = data.pending.filter((i) => i.kind === 'received');
  const today = isoDate(new Date());
  const unassigned = data.received.filter((i) => !i.supplier_id);
  const openSupplier = folder?.type === 'supplier' ? data.suppliers.find((s) => s.id === folder.id) : undefined;

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

  const invoiceList = (items: Invoice[], empty: ReactNode) =>
    items.length ? (
      <Card className="divide-y divide-line overflow-hidden">
        {items.map((inv) => {
          const overdue = inv.status === 'pending' && inv.due_date && inv.due_date < today;
          return (
            <div key={inv.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
              <button
                type="button"
                onClick={() => openFile(inv, false, toast.error)}
                title="Ver factura"
                className={cx(
                  'grid h-11 w-11 shrink-0 place-items-center rounded-xl transition hover:brightness-95',
                  isPdf(inv) ? 'bg-red/10 text-red' : 'bg-accent/15 text-accent',
                )}
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
                  <IconButton
                    label={inv.kind === 'received' ? 'Marcar como pagada' : 'Marcar como cobrada'}
                    onClick={() => markPaid(inv)}
                    className="hover:text-green"
                  >
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
      <Card>{empty}</Card>
    );

  const filters = (withKind: boolean) => (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar proveedor, nº, categoría…" className="sm:w-72" />
      {withKind && (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'received', label: 'Recibidas' },
            { value: 'issued', label: 'Emitidas' },
          ]}
        />
      )}
      <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 w-full rounded-[10px] text-[14px] sm:w-auto">
        <option value="">Cualquier estado</option>
        <option value="pending">Pendientes</option>
        <option value="paid">Pagadas / cobradas</option>
      </Select>
    </div>
  );

  // Formularios compartidos por las dos vistas
  const forms = (
    <>
      <InvoiceForm
        open={!!modal}
        onClose={() => setModal(null)}
        invoice={modal?.invoice}
        defaultSupplierId={modal?.supplierId}
        suppliers={data.suppliers}
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
      <SupplierForm
        open={!!supplierModal}
        onClose={() => setSupplierModal(null)}
        supplier={supplierModal?.supplier}
        onSaved={(s) => {
          reload();
          // Al crear un proveedor se abre su apartado
          if (!supplierModal?.supplier) setFolder({ type: 'supplier', id: s.id });
        }}
        onDeleted={() => {
          setFolder(null);
          reload();
        }}
      />
    </>
  );

  // ---------- Apartado de un proveedor (o de las facturas sin proveedor) ----------
  if (folder && (folder.type === 'none' || openSupplier)) {
    const items = folder.type === 'none' ? unassigned : data.received.filter((i) => i.supplier_id === folder.id);
    const shown = items.filter(matches);
    const pendingItems = items.filter((i) => i.status === 'pending');
    const s = openSupplier;
    return (
      <>
        <PageHeader
          back={
            <button type="button" onClick={() => setFolder(null)} className="mb-2 flex items-center gap-1 text-[15px] text-accent hover:opacity-70">
              <ChevronLeft className="h-4 w-4" /> Facturas
            </button>
          }
          title={s ? s.name : NO_SUPPLIER}
          subtitle={
            s
              ? [s.category, s.tax_id && `CIF ${s.tax_id}`, s.contact, s.phone, s.email].filter(Boolean).join(' · ') || 'Proveedor'
              : 'Facturas recibidas que aún no están en el apartado de ningún proveedor'
          }
          actions={
            <>
              {s && (
                <Button variant="secondary" icon={<Pencil />} onClick={() => setSupplierModal({ supplier: s })}>
                  Editar proveedor
                </Button>
              )}
              <Button icon={<Plus />} onClick={() => setModal({ invoice: null, supplierId: s?.id })}>
                Subir factura
              </Button>
            </>
          }
        />
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 lg:gap-4">
          <StatCard
            label="Facturas"
            value={items.length}
            sub={items[0] ? `Última: ${fmtDate(items[0].date, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Ninguna todavía'}
          />
          <StatCard label="Total facturado" value={fmtMoney(sumBy(items, (i) => i.amount))} sub="Todas las fechas" />
          <StatCard
            label="Este año"
            value={fmtMoney(
              sumBy(
                items.filter((i) => i.date.slice(0, 4) === today.slice(0, 4)),
                (i) => i.amount,
              ),
            )}
          />
          <StatCard
            label="Pendiente de pago"
            value={<span className={pendingItems.length ? 'text-orange' : ''}>{fmtMoney(sumBy(pendingItems, (i) => i.amount))}</span>}
            sub={`${pendingItems.length} factura${pendingItems.length === 1 ? '' : 's'}`}
          />
        </div>
        {s?.notes && <p className="mb-4 whitespace-pre-wrap rounded-xl bg-fill/50 px-4 py-3 text-[14px] text-ink-2">{s.notes}</p>}
        {filters(false)}
        {invoiceList(
          shown,
          <EmptyState
            icon={<FileText />}
            title={items.length ? 'Sin resultados' : 'Aún no hay facturas'}
            message={items.length ? 'Prueba con otra búsqueda o filtro.' : 'Sube la primera factura de este proveedor.'}
            action={
              !items.length && (
                <Button icon={<Upload />} onClick={() => setModal({ invoice: null, supplierId: s?.id })}>
                  Subir factura
                </Button>
              )
            }
          />,
        )}
        {forms}
      </>
    );
  }

  // ---------- Vista general ----------
  return (
    <>
      <PageHeader
        title="Facturas"
        subtitle="Guarda las facturas de cada proveedor y las que emites a clientes"
        actions={
          <>
            <Button variant="secondary" icon={<FolderPlus />} onClick={() => setSupplierModal({ supplier: null })}>
              Nuevo proveedor
            </Button>
            <Button icon={<Plus />} onClick={() => setModal({ invoice: null })}>
              Subir factura
            </Button>
          </>
        }
      />

      {/* Apartados por proveedor */}
      <SectionTitle>Proveedores</SectionTitle>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {folders.map(({ supplier: s, count, total, pending, overdue }) => (
          <button
            key={s.id}
            type="button"
            onClick={() => (setFolder({ type: 'supplier', id: s.id }), setQ(''), setStatus(''))}
            className="card flex items-center gap-3 p-4 text-left transition hover:scale-[1.01] active:scale-[0.99]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
              <Folder className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{s.name}</div>
              <div className="truncate text-[13px] text-ink-2">
                {count} factura{count === 1 ? '' : 's'} · {fmtMoney(total)}
              </div>
            </div>
            {pending > 0 && (
              <Badge tone={overdue ? 'red' : 'orange'} className="shrink-0">
                {fmtMoney(pending)}
              </Badge>
            )}
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
          </button>
        ))}
        {unassigned.length > 0 && (
          <button
            type="button"
            onClick={() => (setFolder({ type: 'none' }), setQ(''), setStatus(''))}
            className="card flex items-center gap-3 p-4 text-left transition hover:scale-[1.01] active:scale-[0.99]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fill text-ink-2">
              <Folder className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{NO_SUPPLIER}</div>
              <div className="truncate text-[13px] text-ink-2">
                {unassigned.length} factura{unassigned.length === 1 ? '' : 's'} · {fmtMoney(sumBy(unassigned, (i) => i.amount))}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setSupplierModal({ supplier: null })}
          className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-line p-4 text-left text-ink-2 transition hover:bg-fill/50 hover:text-ink"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fill">
            <FolderPlus className="h-5 w-5" />
          </span>
          <span className="text-[15px] font-medium">Nuevo proveedor</span>
        </button>
      </div>

      <SectionTitle>Todas las facturas</SectionTitle>
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

      {filters(true)}
      {invoiceList(
        list,
        <EmptyState
          icon={<FileText />}
          title={data.inPeriod.length ? 'Sin resultados' : 'No hay facturas en este periodo'}
          message={data.inPeriod.length ? 'Prueba con otra búsqueda o filtro.' : 'Sube la primera: PDF o una foto hecha con el móvil.'}
          action={
            !data.inPeriod.length && (
              <Button icon={<Upload />} onClick={() => setModal({ invoice: null })}>
                Subir factura
              </Button>
            )
          }
        />,
      )}

      {forms}
    </>
  );
}

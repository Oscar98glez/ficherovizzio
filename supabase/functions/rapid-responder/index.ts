// =====================================================================
//  Conector de Claude (servidor MCP) de Vizzio
//
//  Permite que Claude registre ingresos y gastos en Finanzas, suba facturas
//  (PDF o foto) al apartado Facturas y cree los proveedores que falten.
//
//  · Protocolo: MCP sobre "Streamable HTTP" sin estado (cada POST es una
//    petición JSON-RPC y se responde con JSON).
//  · Acceso: el enlace lleva un código secreto que se genera en la app
//    (Ajustes → Conector de Claude). Sólo se guarda su hash en
//    public.claude_connectors y deja de funcionar si se borra o si quien lo
//    creó ya no es administrador.
//  · Despliegue: lo hace GitHub (.github/workflows/deploy-functions.yml) al
//    cambiar este archivo en main; a mano:
//    `supabase functions deploy rapid-responder --no-verify-jwt`
//    (Claude no envía el token de Supabase, así que la verificación JWT
//    de la pasarela debe estar desactivada para esta función).
//
//  Un solo archivo y sin dependencias locales, para poder pegarlo también
//  en el editor de funciones del panel de Supabase.
// =====================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SERVER = { name: 'vizzio', title: 'Vizzio · Finanzas y facturas', version: '1.0.0' };
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const BUCKET = 'invoices';
const MAX_FILE = 15 * 1024 * 1024;
const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_ROWS = 500;

// Mismas categorías y métodos de pago que la app (src/lib/constants.ts)
const INCOME_CATEGORIES = ['Taquilla', 'Entradas online', 'Barra 1', 'Barra 2', 'Barra 3', 'Reservados VIP', 'Guardarropa', 'Eventos privados', 'Patrocinios', 'Otros ingresos'];
const EXPENSE_CATEGORIES = [
  'Nóminas',
  'Personal',
  'Proveedores bebida',
  'DJ / Artistas',
  'Seguridad externa',
  'Alquiler',
  'Suministros',
  'Marketing',
  'Mantenimiento',
  'Licencias / SGAE',
  'Impuestos',
  'Otros gastos',
];
const METHODS = ['efectivo', 'tarjeta', 'transferencia', 'bizum', 'otro'];

const INSTRUCTIONS = `Conector de la app Vizzio (discoteca): Finanzas, Facturas y Proveedores. Todo en español.

MOVIMIENTOS (Finanzas)
- Cuando el usuario pase un archivo de ingresos o gastos (Excel, CSV, extracto del banco, tickets, PDF…), léelo tú, convierte cada línea en un movimiento y enséñale un resumen (nº de movimientos, total de ingresos y gastos, categorías) antes de guardar, salvo que te haya dicho que lo cargues directamente.
- Usa registrar_movimientos (hasta ${MAX_ROWS} por llamada). Los importes van siempre en positivo; "tipo" indica si es ingreso o gasto (en un extracto, los cargos/negativos son gastos).
- Las categorías deben ser exactamente las de ver_categorias. Si dudas, usa "Otros gastos" u "Otros ingresos" y explica en la descripción.
- Por defecto se omiten los duplicados (misma fecha, tipo, categoría, importe y descripción que uno ya guardado), así que se puede volver a cargar un archivo sin repetir movimientos.

FACTURAS Y PROVEEDORES
- Para cada factura: lee del documento proveedor, CIF/NIF, nº de factura, fecha, vencimiento, total con IVA e IVA.
- Busca antes el proveedor con buscar_proveedores (por nombre y por CIF). Si ya existe con otro nombre parecido (p. ej. "DISTRIBUCIONES MARTINEZ S.L." y "Distribuidora Martínez") usa su proveedor_id. Si no existe, registrar_factura lo crea con los datos que le pases.
- Subir el archivo: si puedes ejecutar comandos (análisis de datos, ejecución de código o terminal), llama a preparar_subida_factura, sube el archivo con el comando curl que te devuelve y después llama a registrar_factura con ruta_archivo. Si no puedes ejecutar comandos y el archivo es pequeño, pásalo en archivo_base64. Si no puedes de ninguna forma, registra la factura sin archivo y avisa al usuario de que lo adjunte desde la app.
- registrar_en_finanzas crea también el gasto (o ingreso) en Finanzas. Ponlo a false si ese pago ya está (o va a estar) en los movimientos, para no contarlo dos veces.
- Las facturas recibidas son de proveedores; las emitidas, a clientes (se indica el cliente en "proveedor").

FICHAJES (hoja de firmas)
- Cuando el usuario pase una hoja de firmas (PDF o foto), léela: por cada persona, nombre, noche, hora de entrada, hora de salida y descanso si lo hay.
- Usa listar_personal para emparejar cada nombre de la hoja con su ficha (pueden venir con apodo, solo nombre o con faltas de ortografía). Si dudas entre dos fichas, pregunta.
- Quien no esté en la app NO se registra en ningún sitio: no se crea su ficha ni sus fichajes. Solo dile al usuario quiénes eran.
- Usa ver_fichajes_noche para ver lo fichado esa noche y compáralo con la hoja. La noche va de 06:00 a 06:00: una salida a las 05:30 es de la noche anterior.
- Enséñale una tabla con las diferencias (persona, app y hoja) antes de cambiar nada, salvo que te haya dicho que corrijas directamente. Por defecto, una diferencia de 10 minutos o menos se da por buena.
- Corrige con corregir_fichajes: modifica la entrada/salida del fichaje que está mal, crea el fichaje si la persona está en la hoja pero no fichó, y solo borra fichajes si el usuario lo pide. Las horas se indican en hora española (HH:MM) junto con la noche (AAAA-MM-DD).

RESERVADOS
- ver_reservados_noche enseña los reservados de una noche en la app y las reservas de Fourvenues (por RRPP) para cotejarlos. Es sólo de lectura y lleva datos de clientes: úsalo sólo cuando el usuario lo pida.

Si te equivocas, puedes deshacer con eliminar_movimientos o eliminar_factura.`;

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------

class UserError extends Error {}

type Args = Record<string, unknown>;
type Ctx = { db: SupabaseClient; userId: string };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...headers } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, x-client-info, apikey',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Nombre de archivo seguro para el almacenamiento (sin tildes ni espacios) */
const safeName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);

/** Fecha de hoy en España (YYYY-MM-DD) */
const todayMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

// ---------- Hora de Madrid y noches (de 06:00 a 06:00) ----------

const HOUR_MS = 3_600_000;
const NIGHT_START_HOUR = 6;
const madridParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Fecha y hora de Madrid de un instante: { date: 'AAAA-MM-DD', time: 'HH:MM' } */
function toMadrid(ms: number) {
  const p = Object.fromEntries(madridParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Minutos que Madrid va por delante de UTC en ese instante (60 en invierno, 120 en verano) */
function madridOffset(ms: number) {
  const { date, time } = toMadrid(ms);
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** Instante (ms) de una fecha y hora de Madrid */
function fromMadrid(date: string, time: string) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  let ms = guess - madridOffset(guess) * 60000;
  ms = guess - madridOffset(ms) * 60000; // cambio de hora
  return ms;
}

const addDaysIso = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 24 * HOUR_MS).toISOString().slice(0, 10);

/** Noche a la que pertenece un instante */
const nightOf = (ms: number) => {
  const { date, time } = toMadrid(ms);
  return Number(time.slice(0, 2)) < NIGHT_START_HOUR ? addDaysIso(date, -1) : date;
};

/** Instante de una hora "HH:MM" dentro de una noche: antes de las 06:00 es ya el día siguiente */
function nightTime(night: string, hhmm: string, key: string): number {
  const m = /^(\d{1,2})[:.h](\d{2})$/.exec(hhmm.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new UserError(`"${key}" debe ser una hora HH:MM (recibido: ${hhmm})`);
  const time = `${m[1].padStart(2, '0')}:${m[2]}`;
  return fromMadrid(+m[1] < NIGHT_START_HOUR ? addDaysIso(night, 1) : night, time);
}

const MAX_SHIFT_HOURS = 16;

/** Salida "HH:MM" de un fichaje: si queda antes de la entrada (p. ej. 06:30 tras entrar a las 00:15), es del día siguiente */
function nightOut(night: string, hhmm: string, inMs: number): number {
  let ms = nightTime(night, hhmm, 'salida');
  if (ms <= inMs) {
    const { date, time } = toMadrid(ms);
    ms = fromMadrid(addDaysIso(date, 1), time);
  }
  if (ms - inMs > MAX_SHIFT_HOURS * HOUR_MS) throw new UserError(`de ${toMadrid(inMs).time} a ${hhmm} salen más de ${MAX_SHIFT_HOURS} horas: revisa la entrada y la salida`);
  return ms;
}

/** Límites [desde, hasta) de una noche en ISO */
const nightRange = (night: string) => [new Date(fromMadrid(night, '06:00')).toISOString(), new Date(fromMadrid(addDaysIso(night, 1), '06:00')).toISOString()];

function str(a: Args, key: string, opts: { required?: boolean; max?: number } = {}): string | null {
  const v = a[key];
  if (v == null || (typeof v === 'string' && !v.trim())) {
    if (opts.required) throw new UserError(`Falta "${key}"`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new UserError(`"${key}" debe ser texto`);
  const s = String(v).trim();
  if (opts.max && s.length > opts.max) throw new UserError(`"${key}" es demasiado largo (máx. ${opts.max} caracteres)`);
  return s;
}

function date(a: Args, key: string, required = false): string | null {
  const s = str(a, key, { required });
  if (s == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new UserError(`"${key}" debe ser una fecha AAAA-MM-DD (recibido: ${s})`);
  return s;
}

/** Importe en euros (acepta 12.5, "12,50" o "1.234,56"); siempre positivo y con 2 decimales */
function money(a: Args, key: string, required = false): number | null {
  const v = a[key];
  if (v == null || v === '') {
    if (required) throw new UserError(`Falta "${key}"`);
    return null;
  }
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const s = v.replace(/[€\s]/g, '');
    n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  } else n = NaN;
  if (!Number.isFinite(n)) throw new UserError(`"${key}" no es un importe válido (recibido: ${String(v)})`);
  if (n < 0) throw new UserError(`"${key}" debe ser positivo; usa "tipo" para indicar si es ingreso o gasto`);
  return Math.round(n * 100) / 100;
}

function oneOf<T extends string>(a: Args, key: string, values: readonly T[], fallback?: T): T {
  const s = str(a, key);
  if (s == null) {
    if (fallback !== undefined) return fallback;
    throw new UserError(`Falta "${key}" (${values.join(', ')})`);
  }
  const found = values.find((v) => norm(v) === norm(s));
  if (!found) throw new UserError(`"${key}" debe ser uno de: ${values.join(', ')} (recibido: ${s})`);
  return found;
}

const TX_KIND = { ingreso: 'income', gasto: 'expense' } as const;
type TxKind = (typeof TX_KIND)[keyof typeof TX_KIND];

function category(value: string | null, kind: TxKind): string {
  const list = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (value == null) return kind === 'income' ? 'Otros ingresos' : 'Otros gastos';
  const found = list.find((c) => norm(c) === norm(value));
  if (!found) throw new UserError(`Categoría de ${kind === 'income' ? 'ingreso' : 'gasto'} no válida: "${value}". Usa una de: ${list.join(', ')}`);
  return found;
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const txOut = (t: Record<string, unknown>) => ({
  id: t.id,
  fecha: t.date,
  tipo: t.kind === 'income' ? 'ingreso' : 'gasto',
  categoria: t.category,
  importe: Number(t.amount),
  metodo: t.method,
  descripcion: t.description,
});

const supplierOut = (s: Record<string, unknown>, invoices?: number) => ({
  id: s.id,
  nombre: s.name,
  cif: s.tax_id,
  contacto: s.contact,
  email: s.email,
  telefono: s.phone,
  categoria: s.category,
  notas: s.notes,
  ...(invoices != null ? { facturas: invoices } : {}),
});

const invoiceOut = (i: Record<string, unknown>) => ({
  id: i.id,
  tipo: i.kind === 'received' ? 'recibida' : 'emitida',
  proveedor: i.party,
  proveedor_id: i.supplier_id,
  numero: i.number,
  fecha: i.date,
  vencimiento: i.due_date,
  importe: Number(i.amount),
  iva: i.tax == null ? null : Number(i.tax),
  categoria: i.category,
  estado: i.status === 'paid' ? 'pagada' : 'pendiente',
  archivo: i.file_name || null,
  movimiento_id: i.transaction_id,
});

// ---------------------------------------------------------------------
//  Proveedores
// ---------------------------------------------------------------------

async function findSupplier(db: SupabaseClient, name: string | null, taxId: string | null) {
  const all = check(await db.from('suppliers').select('*'), 'No se pudieron leer los proveedores') as Record<string, unknown>[];
  const tax = taxId ? taxId.replace(/[\s.-]/g, '').toUpperCase() : null;
  return (
    (tax && all.find((s) => typeof s.tax_id === 'string' && s.tax_id.replace(/[\s.-]/g, '').toUpperCase() === tax)) ||
    (name && all.find((s) => norm(String(s.name)) === norm(name))) ||
    null
  );
}

function supplierValues(a: Args) {
  const values: Record<string, unknown> = {};
  const name = str(a, 'nombre', { max: 200 });
  if (name) values.name = name;
  const fields: [string, string][] = [
    ['cif', 'tax_id'],
    ['contacto', 'contact'],
    ['email', 'email'],
    ['telefono', 'phone'],
    ['notas', 'notes'],
  ];
  for (const [from, to] of fields) {
    const v = str(a, from, { max: 1000 });
    if (v != null) values[to] = from === 'cif' ? v.toUpperCase() : v;
  }
  const cat = str(a, 'categoria');
  if (cat != null) values.category = category(cat, 'expense');
  return values;
}

async function createSupplier(db: SupabaseClient, a: Args) {
  const values = supplierValues(a);
  if (!values.name) throw new UserError('Falta "nombre" del proveedor');
  const existing = await findSupplier(db, values.name as string, (values.tax_id as string) ?? null);
  if (existing) return { proveedor: supplierOut(existing), ya_existia: true };
  const created = check(await db.from('suppliers').insert(values).select().single(), 'No se pudo crear el proveedor');
  return { proveedor: supplierOut(created), ya_existia: false };
}

// ---------------------------------------------------------------------
//  Herramientas
// ---------------------------------------------------------------------

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run: (ctx: Ctx, args: Args) => Promise<unknown>;
};

const DATE = { type: 'string', format: 'date', description: 'AAAA-MM-DD' };
const MONEY = { type: 'number', minimum: 0 };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const TOOLS: Tool[] = [
  {
    name: 'ver_categorias',
    title: 'Ver categorías',
    description: 'Categorías de ingresos y gastos, métodos de pago y fecha de hoy. Consúltalo antes de registrar movimientos o facturas.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ_ONLY,
    run: async () => ({
      hoy: todayMadrid(),
      categorias_ingreso: INCOME_CATEGORIES,
      categorias_gasto: EXPENSE_CATEGORIES,
      metodos_pago: METHODS,
      nota: 'Nóminas y Personal son pagos al personal; Proveedores bebida es la compra de bebida para barra y reservados.',
    }),
  },

  {
    name: 'registrar_movimientos',
    title: 'Registrar movimientos en Finanzas',
    description:
      'Guarda ingresos y/o gastos en Finanzas (hasta 500 por llamada). Importes en positivo; "tipo" indica si es ingreso o gasto. Por defecto omite los que ya existen (misma fecha, tipo, categoría, importe y descripción).',
    inputSchema: {
      type: 'object',
      properties: {
        movimientos: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_ROWS,
          items: {
            type: 'object',
            properties: {
              fecha: DATE,
              tipo: { type: 'string', enum: ['ingreso', 'gasto'] },
              categoria: { type: 'string', description: 'Una de las categorías de ver_categorias para ese tipo' },
              importe: { ...MONEY, description: 'Euros, en positivo' },
              metodo: { type: 'string', enum: METHODS, description: 'Por defecto transferencia' },
              descripcion: { type: 'string', description: 'Concepto (proveedor, nº de factura, detalle…)' },
            },
            required: ['fecha', 'tipo', 'categoria', 'importe'],
          },
        },
        omitir_duplicados: { type: 'boolean', default: true },
      },
      required: ['movimientos'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ db, userId }, a) => {
      const raw = a.movimientos;
      if (!Array.isArray(raw) || !raw.length) throw new UserError('"movimientos" debe ser una lista con al menos un movimiento');
      if (raw.length > MAX_ROWS) throw new UserError(`Máximo ${MAX_ROWS} movimientos por llamada; divide el archivo en varias llamadas`);

      const errors: string[] = [];
      const rows: Record<string, unknown>[] = [];
      raw.forEach((m, i) => {
        try {
          if (!m || typeof m !== 'object') throw new UserError('no es un objeto');
          const r = m as Args;
          const kind = TX_KIND[oneOf(r, 'tipo', ['ingreso', 'gasto'] as const)];
          rows.push({
            date: date(r, 'fecha', true),
            kind,
            category: category(str(r, 'categoria'), kind),
            amount: money(r, 'importe', true),
            method: oneOf(r, 'metodo', METHODS, 'transferencia'),
            description: str(r, 'descripcion', { max: 500 }),
            created_by: userId,
          });
        } catch (e) {
          errors.push(`Movimiento ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      // Si hay algún error no se guarda nada, para que se pueda corregir y repetir la llamada
      if (errors.length) throw new UserError(`No se ha guardado nada. Corrige estos movimientos:\n${errors.join('\n')}`);

      let toInsert = rows;
      const skipped: Record<string, unknown>[] = [];
      if (a.omitir_duplicados !== false) {
        const dates = rows.map((r) => r.date as string).sort();
        const existing = check(
          await db.from('transactions').select('date, kind, category, amount, description').gte('date', dates[0]).lte('date', dates[dates.length - 1]),
          'No se pudieron comprobar los duplicados',
        ) as Record<string, unknown>[];
        const key = (r: Record<string, unknown>) => [r.date, r.kind, r.category, Number(r.amount).toFixed(2), norm(String(r.description ?? ''))].join('|');
        const counts = new Map<string, number>();
        for (const e of existing) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
        toInsert = rows.filter((r) => {
          const n = counts.get(key(r)) ?? 0;
          if (!n) return true;
          counts.set(key(r), n - 1);
          skipped.push(r);
          return false;
        });
      }

      const inserted = toInsert.length ? (check(await db.from('transactions').insert(toInsert).select(), 'No se pudieron guardar los movimientos') as Record<string, unknown>[]) : [];
      const total = (kind: TxKind) => Math.round(inserted.filter((t) => t.kind === kind).reduce((s, t) => s + Number(t.amount), 0) * 100) / 100;
      return {
        guardados: inserted.length,
        omitidos_por_duplicados: skipped.length,
        total_ingresos: total('income'),
        total_gastos: total('expense'),
        movimientos: inserted.map(txOut),
        ...(skipped.length ? { duplicados: skipped.map(txOut) } : {}),
      };
    },
  },

  {
    name: 'listar_movimientos',
    title: 'Listar movimientos de Finanzas',
    description: 'Movimientos de Finanzas entre dos fechas (ambas incluidas), con totales. Útil para comprobar qué hay ya cargado.',
    inputSchema: {
      type: 'object',
      properties: {
        desde: DATE,
        hasta: DATE,
        tipo: { type: 'string', enum: ['ingreso', 'gasto'] },
        categoria: { type: 'string' },
        texto: { type: 'string', description: 'Busca en la descripción' },
      },
      required: ['desde', 'hasta'],
    },
    annotations: READ_ONLY,
    run: async ({ db }, a) => {
      let q = db.from('transactions').select('*').gte('date', date(a, 'desde', true)).lte('date', date(a, 'hasta', true));
      const tipo = str(a, 'tipo');
      if (tipo) q = q.eq('kind', TX_KIND[oneOf(a, 'tipo', ['ingreso', 'gasto'] as const)]);
      const cat = str(a, 'categoria');
      if (cat) q = q.eq('category', cat);
      const text = str(a, 'texto');
      if (text) q = q.ilike('description', `%${text.replace(/[%_]/g, '')}%`);
      const rows = check(await q.order('date').order('created_at').limit(MAX_ROWS + 1), 'No se pudieron leer los movimientos') as Record<string, unknown>[];
      const list = rows.slice(0, MAX_ROWS);
      const total = (kind: TxKind) => Math.round(list.filter((t) => t.kind === kind).reduce((s, t) => s + Number(t.amount), 0) * 100) / 100;
      return {
        cantidad: list.length,
        ...(rows.length > MAX_ROWS ? { aviso: `Hay más de ${MAX_ROWS}; acota las fechas` } : {}),
        total_ingresos: total('income'),
        total_gastos: total('expense'),
        movimientos: list.map(txOut),
      };
    },
  },

  {
    name: 'eliminar_movimientos',
    title: 'Eliminar movimientos',
    description: 'Borra movimientos de Finanzas por su id (para deshacer una carga equivocada). Pide confirmación al usuario antes.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_ROWS } },
      required: ['ids'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async ({ db }, a) => {
      const ids = Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === 'string') : [];
      if (!ids.length) throw new UserError('Indica los "ids" de los movimientos');
      const deleted = check(await db.from('transactions').delete().in('id', ids).select('id'), 'No se pudieron eliminar') as unknown[];
      return { eliminados: deleted.length };
    },
  },

  {
    name: 'buscar_proveedores',
    title: 'Buscar proveedores',
    description: 'Lista los proveedores dados de alta (todos, o los que contienen el texto en el nombre o el CIF), con su nº de facturas.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' } } },
    annotations: READ_ONLY,
    run: async ({ db }, a) => {
      const text = str(a, 'texto');
      const [suppliers, invoices] = await Promise.all([
        db.from('suppliers').select('*').order('name'),
        db.from('invoices').select('supplier_id').not('supplier_id', 'is', null),
      ]);
      const counts = new Map<string, number>();
      for (const i of check(invoices, 'No se pudieron leer las facturas') as { supplier_id: string }[]) counts.set(i.supplier_id, (counts.get(i.supplier_id) ?? 0) + 1);
      const all = check(suppliers, 'No se pudieron leer los proveedores') as Record<string, unknown>[];
      const t = text && norm(text);
      const list = t ? all.filter((s) => norm(`${s.name} ${s.tax_id ?? ''}`).includes(t)) : all;
      return { cantidad: list.length, proveedores: list.map((s) => supplierOut(s, counts.get(s.id as string) ?? 0)) };
    },
  },

  {
    name: 'crear_proveedor',
    title: 'Crear proveedor',
    description: 'Da de alta un proveedor. Si ya existe uno con el mismo nombre o CIF, devuelve ese (ya_existia = true) sin duplicarlo.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        cif: { type: 'string', description: 'CIF / NIF' },
        contacto: { type: 'string', description: 'Persona de contacto' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        categoria: { type: 'string', description: 'Categoría de gasto habitual de sus facturas' },
        notas: { type: 'string' },
      },
      required: ['nombre'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ db }, a) => createSupplier(db, a),
  },

  {
    name: 'actualizar_proveedor',
    title: 'Actualizar proveedor',
    description: 'Cambia los datos de un proveedor (sólo los campos que se indiquen). Al cambiar el nombre, sus facturas muestran el nuevo.',
    inputSchema: {
      type: 'object',
      properties: {
        proveedor_id: { type: 'string' },
        nombre: { type: 'string' },
        cif: { type: 'string' },
        contacto: { type: 'string' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        categoria: { type: 'string' },
        notas: { type: 'string' },
      },
      required: ['proveedor_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ db }, a) => {
      const id = str(a, 'proveedor_id', { required: true })!;
      const values = supplierValues(a);
      if (!Object.keys(values).length) throw new UserError('No has indicado ningún dato que cambiar');
      const updated = check(await db.from('suppliers').update(values).eq('id', id).select().maybeSingle(), 'No se pudo actualizar el proveedor');
      if (!updated) throw new UserError(`No existe ningún proveedor con id ${id}`);
      return { proveedor: supplierOut(updated) };
    },
  },

  {
    name: 'preparar_subida_factura',
    title: 'Preparar subida de factura',
    description:
      'Paso 1 para subir el archivo de una factura: devuelve un enlace de subida (válido 2 horas) y el comando curl para subir el archivo. Después llama a registrar_factura con la "ruta_archivo" que devuelve.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre_archivo: { type: 'string', description: 'Nombre original del archivo, p. ej. factura-123.pdf' },
        tipo_mime: { type: 'string', enum: MIME_TYPES, description: 'Por defecto se deduce de la extensión' },
        fecha: { ...DATE, description: 'Fecha de la factura (para ordenar los archivos por año y mes)' },
      },
      required: ['nombre_archivo'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async ({ db }, a) => {
      const fileName = str(a, 'nombre_archivo', { required: true, max: 200 })!;
      const mime = mimeOf(fileName, str(a, 'tipo_mime'));
      const day = date(a, 'fecha') ?? todayMadrid();
      const path = `${day.slice(0, 4)}/${day.slice(5, 7)}/${crypto.randomUUID()}-${safeName(fileName)}`;
      const res = check(await db.storage.from(BUCKET).createSignedUploadUrl(path), 'No se pudo preparar la subida') as { signedUrl: string };
      return {
        ruta_archivo: path,
        url_subida: res.signedUrl,
        tipo_mime: mime,
        comando_curl: `curl -sS -f -X PUT -H "Content-Type: ${mime}" --data-binary @"${fileName.replace(/"/g, '')}" "${res.signedUrl}"`,
        siguiente_paso: 'Sube el archivo con el comando (cambia la ruta local si hace falta) y llama a registrar_factura con ruta_archivo.',
      };
    },
  },

  {
    name: 'registrar_factura',
    title: 'Registrar factura',
    description:
      'Guarda una factura en el apartado Facturas, enlazada a su proveedor (lo crea si no existe). El archivo se indica con ruta_archivo (de preparar_subida_factura) o, si es pequeño, con archivo_base64. Opcionalmente crea también el gasto/ingreso en Finanzas.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['recibida', 'emitida'], default: 'recibida', description: 'recibida = de un proveedor (gasto) · emitida = a un cliente (ingreso)' },
        proveedor: { type: 'string', description: 'Nombre del proveedor (o del cliente si es emitida)' },
        proveedor_id: { type: 'string', description: 'Id de un proveedor existente (de buscar_proveedores). Tiene prioridad sobre el nombre.' },
        cif: { type: 'string', description: 'CIF/NIF del proveedor; se usa para encontrarlo y al crearlo' },
        email_proveedor: { type: 'string' },
        telefono_proveedor: { type: 'string' },
        numero: { type: 'string', description: 'Nº de factura' },
        fecha: DATE,
        vencimiento: DATE,
        importe: { ...MONEY, description: 'Total con impuestos, en euros' },
        iva: { ...MONEY, description: 'IVA incluido en el total (opcional)' },
        categoria: { type: 'string', description: 'Categoría de gasto (recibida) o ingreso (emitida); por defecto la habitual del proveedor' },
        estado: { type: 'string', enum: ['pendiente', 'pagada'], default: 'pendiente' },
        notas: { type: 'string' },
        ruta_archivo: { type: 'string', description: 'Devuelta por preparar_subida_factura, una vez subido el archivo' },
        archivo_base64: { type: 'string', description: 'Contenido del archivo en base64 (sólo archivos pequeños)' },
        nombre_archivo: { type: 'string', description: 'Nombre original del archivo' },
        tipo_mime: { type: 'string', enum: MIME_TYPES },
        registrar_en_finanzas: { type: 'boolean', default: false, description: 'Crea también el movimiento en Finanzas' },
        metodo_pago: { type: 'string', enum: METHODS, default: 'transferencia', description: 'Para el movimiento de Finanzas' },
        permitir_duplicada: { type: 'boolean', default: false, description: 'Guardarla aunque ya exista una con el mismo proveedor y nº' },
      },
      required: ['importe', 'fecha'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: registerInvoice,
  },

  {
    name: 'listar_facturas',
    title: 'Listar facturas',
    description: 'Facturas guardadas, filtradas por fechas, proveedor y/o estado.',
    inputSchema: {
      type: 'object',
      properties: {
        desde: DATE,
        hasta: DATE,
        proveedor_id: { type: 'string' },
        proveedor: { type: 'string', description: 'Texto que contiene el nombre del proveedor o cliente' },
        estado: { type: 'string', enum: ['pendiente', 'pagada'] },
      },
    },
    annotations: READ_ONLY,
    run: async ({ db }, a) => {
      let q = db.from('invoices').select('*');
      const from = date(a, 'desde');
      const to = date(a, 'hasta');
      if (from) q = q.gte('date', from);
      if (to) q = q.lte('date', to);
      const supplierId = str(a, 'proveedor_id');
      if (supplierId) q = q.eq('supplier_id', supplierId);
      const party = str(a, 'proveedor');
      if (party) q = q.ilike('party', `%${party.replace(/[%_]/g, '')}%`);
      const status = str(a, 'estado');
      if (status) q = q.eq('status', oneOf(a, 'estado', ['pendiente', 'pagada'] as const) === 'pagada' ? 'paid' : 'pending');
      const rows = check(await q.order('date', { ascending: false }).limit(MAX_ROWS), 'No se pudieron leer las facturas') as Record<string, unknown>[];
      return {
        cantidad: rows.length,
        total: Math.round(rows.reduce((s, i) => s + Number(i.amount), 0) * 100) / 100,
        facturas: rows.map(invoiceOut),
      };
    },
  },

  {
    name: 'eliminar_factura',
    title: 'Eliminar factura',
    description: 'Borra una factura y su archivo. Su movimiento de Finanzas se conserva salvo que se indique eliminar_movimiento. Pide confirmación al usuario antes.',
    inputSchema: {
      type: 'object',
      properties: { factura_id: { type: 'string' }, eliminar_movimiento: { type: 'boolean', default: false } },
      required: ['factura_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async ({ db }, a) => {
      const id = str(a, 'factura_id', { required: true })!;
      const inv = check(await db.from('invoices').delete().eq('id', id).select().maybeSingle(), 'No se pudo eliminar la factura') as Record<string, unknown> | null;
      if (!inv) throw new UserError(`No existe ninguna factura con id ${id}`);
      if (inv.file_path) await db.storage.from(BUCKET).remove([inv.file_path as string]);
      let movement = false;
      if (a.eliminar_movimiento === true && inv.transaction_id) {
        check(await db.from('transactions').delete().eq('id', inv.transaction_id), 'Factura eliminada, pero no su movimiento');
        movement = true;
      }
      return { eliminada: invoiceOut(inv), movimiento_eliminado: movement };
    },
  },

  {
    name: 'listar_personal',
    title: 'Listar personal',
    description: 'Trabajadores dados de alta en la app (nombre, puesto, departamento). Úsalo para emparejar los nombres de una hoja de firmas con sus fichas.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre o apellido' },
        incluir_inactivos: { type: 'boolean', default: false },
      },
    },
    annotations: READ_ONLY,
    run: async ({ db }, a) => {
      let q = db.from('employees').select('id, first_name, last_name, position, department, active, email');
      if (a.incluir_inactivos !== true) q = q.eq('active', true);
      const all = check(await q.order('first_name'), 'No se pudo leer el personal') as Record<string, unknown>[];
      const t = str(a, 'texto');
      const list = t ? all.filter((e) => norm(`${e.first_name} ${e.last_name}`).includes(norm(t))) : all;
      return {
        cantidad: list.length,
        personal: list.map((e) => ({
          id: e.id,
          nombre: `${e.first_name} ${e.last_name ?? ''}`.trim(),
          puesto: e.position,
          departamento: e.department,
          activo: e.active,
        })),
      };
    },
  },

  {
    name: 'ver_fichajes_noche',
    title: 'Ver fichajes de una noche',
    description:
      'Fichajes de una noche (de 06:00 a 06:00, hora española) con entrada, salida, descanso y horas de cada persona, y quién tenía turno pero no fichó. Con "hasta" devuelve varias noches.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { ...DATE, description: 'La noche (AAAA-MM-DD): el día en que empieza' },
        hasta: { ...DATE, description: 'Última noche, para ver varias seguidas (máx. 31)' },
        empleado_id: { type: 'string' },
      },
      required: ['fecha'],
    },
    annotations: READ_ONLY,
    run: async ({ db }, a) => {
      const from = date(a, 'fecha', true)!;
      const to = date(a, 'hasta') ?? from;
      if (to < from) throw new UserError('"hasta" debe ser igual o posterior a "fecha"');
      if (Date.parse(to) - Date.parse(from) > 31 * 24 * HOUR_MS) throw new UserError('Como mucho 31 noches por consulta');
      const [start] = nightRange(from);
      const [, end] = nightRange(to);
      const employeeId = str(a, 'empleado_id');
      let te = db.from('time_entries').select('*').gte('clock_in', start).lt('clock_in', end);
      let sh = db.from('shifts').select('employee_id, start_at, status').gte('start_at', start).lt('start_at', end).neq('status', 'cancelled');
      if (employeeId) {
        te = te.eq('employee_id', employeeId);
        sh = sh.eq('employee_id', employeeId);
      }
      const [entriesRes, shiftsRes, employeesRes] = await Promise.all([
        te.order('clock_in'),
        sh,
        db.from('employees').select('id, first_name, last_name'),
      ]);
      const entries = check(entriesRes, 'No se pudieron leer los fichajes') as Record<string, unknown>[];
      const shifts = check(shiftsRes, 'No se pudieron leer los turnos') as Record<string, unknown>[];
      const names = new Map(
        (check(employeesRes, 'No se pudo leer el personal') as Record<string, unknown>[]).map((e) => [e.id, `${e.first_name} ${e.last_name ?? ''}`.trim()]),
      );
      const fichajes = entries.map((e) => {
        const inMs = Date.parse(e.clock_in as string);
        const outMs = e.clock_out ? Date.parse(e.clock_out as string) : null;
        const brk = Number(e.break_minutes ?? 0);
        return {
          id: e.id,
          noche: nightOf(inMs),
          empleado_id: e.employee_id,
          empleado: names.get(e.employee_id) ?? '¿?',
          entrada: toMadrid(inMs).time,
          salida: outMs ? toMadrid(outMs).time : null,
          descanso_min: brk,
          horas: outMs ? Math.round(((outMs - inMs) / HOUR_MS - brk / 60) * 100) / 100 : null,
          origen: e.source === 'manual' ? 'manual' : 'app',
          notas: e.notes ?? null,
          ...(outMs ? {} : { aviso: 'Fichaje abierto (sin salida)' }),
        };
      });
      const fichado = new Set(fichajes.map((f) => `${f.noche}|${f.empleado_id}`));
      const sinFichar = shifts
        .map((s) => ({ noche: nightOf(Date.parse(s.start_at as string)), empleado_id: s.employee_id as string, turno: toMadrid(Date.parse(s.start_at as string)).time }))
        .filter((s) => !fichado.has(`${s.noche}|${s.empleado_id}`))
        .map((s) => ({ ...s, empleado: names.get(s.empleado_id) ?? '¿?' }));
      return { desde: from, hasta: to, cantidad: fichajes.length, fichajes, turno_sin_fichar: sinFichar };
    },
  },

  {
    name: 'ver_reservados_noche',
    title: 'Ver reservados de una noche',
    description:
      'Reservados de una noche en el apartado Reservados de la app (cliente, teléfono, personas, reservado, botellas con las de cortesía, total, estado y RRPP) y las reservas de Fourvenues de esa noche por RRPP (cliente, teléfono, zona, personas y precio), para cotejarlas. Sólo lectura.',
    inputSchema: {
      type: 'object',
      properties: { fecha: { ...DATE, description: 'La noche (AAAA-MM-DD)' } },
      required: ['fecha'],
    },
    annotations: READ_ONLY,
    run: async ({ db }, a) => {
      const night = date(a, 'fecha', true)!;
      const [resRes, tablesRes, eventsRes] = await Promise.all([
        db
          .from('reservations')
          .select('id, customer_name, customer_phone, guests, arrival_time, table_id, bottles, mixers, total_amount, deposit, status, rrpp_name, rrpp_origin, host_rrpp_name, notes')
          .eq('date', night)
          .order('arrival_time'),
        db.from('vip_tables').select('id, name, zone'),
        db.from('events').select('id, name, fourvenues_id').eq('date', night),
      ]);
      const tables = new Map((check(tablesRes, 'No se pudieron leer los reservados') as Record<string, unknown>[]).map((t) => [t.id, [t.name, t.zone].filter(Boolean).join(' · ')]));
      type Item = { name: string; qty: number; courtesy?: boolean; price?: number };
      const app = (check(resRes, 'No se pudieron leer las reservas') as Record<string, unknown>[]).map((r) => {
        const bottles = (r.bottles as Item[] | null) ?? [];
        return {
          cliente: r.customer_name,
          telefono: r.customer_phone,
          personas: r.guests,
          llegada: r.arrival_time,
          reservado: r.table_id ? tables.get(r.table_id) ?? null : null,
          botellas: bottles.map((b) => `${b.qty}× ${b.name}${b.courtesy ? ' (cortesía)' : ''}`).join(', '),
          todas_cortesia: bottles.length > 0 && bottles.every((b) => b.courtesy),
          total: r.total_amount,
          senal: r.deposit,
          estado: r.status,
          rrpp: r.rrpp_name ?? r.rrpp_origin,
          rrpp_que_atiende: r.host_rrpp_name,
          notas: r.notes,
        };
      });
      const events = check(eventsRes, 'No se pudieron leer las noches') as Record<string, unknown>[];
      const ids = events.map((e) => e.id as string);
      const nightsRes = ids.length
        ? await db.from('fourvenues_rrpp_nights').select('fourvenues_user_id, name, bookings, detail').in('event_id', ids)
        : { data: [], error: null };
      const fourvenues = (check(nightsRes, 'No se pudo leer el desglose de Fourvenues') as Record<string, unknown>[]).flatMap((r) => {
        const detail = r.detail as { bookingItems?: Record<string, unknown>[] } | null;
        return (detail?.bookingItems ?? []).map((b) => ({
          rrpp: r.name ?? (r.fourvenues_user_id ? `RRPP ${String(r.fourvenues_user_id).slice(-6)}` : 'Sin RRPP'),
          cliente: b.name,
          telefono: b.phone,
          zona: b.zone,
          personas: b.people,
          precio: b.price,
          cortesia_segun_fourvenues: b.courtesy,
        }));
      });
      return {
        noche: night,
        eventos: events.map((e) => ({ nombre: e.name, de_fourvenues: !!e.fourvenues_id })),
        reservados_app: app,
        reservas_fourvenues: fourvenues,
      };
    },
  },

  {
    name: 'corregir_fichajes',
    title: 'Corregir fichajes',
    description:
      'Modifica, crea o borra fichajes según la hoja de firmas. Con fichaje_id se modifican las horas indicadas (o se borra con eliminar=true); sin fichaje_id se crea un fichaje nuevo para un trabajador que ya existe en la app. Las horas, en hora española HH:MM; las de antes de las 06:00 son del día siguiente. Si algún cambio no es válido, no se aplica ninguno.',
    inputSchema: {
      type: 'object',
      properties: {
        cambios: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              fichaje_id: { type: 'string', description: 'Fichaje a modificar o borrar (de ver_fichajes_noche)' },
              empleado_id: { type: 'string', description: 'Para crear un fichaje: ficha del trabajador (de listar_personal)' },
              noche: { ...DATE, description: 'Noche del fichaje (obligatoria al crear; al modificar, por defecto la del fichaje)' },
              entrada: { type: 'string', description: 'HH:MM' },
              salida: { type: 'string', description: 'HH:MM' },
              descanso_min: { type: 'integer', minimum: 0 },
              eliminar: { type: 'boolean', default: false },
              motivo: { type: 'string', description: 'Se guarda en las notas del fichaje, p. ej. "Hoja de firmas"' },
            },
          },
        },
      },
      required: ['cambios'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async ({ db }, a) => {
      const raw = a.cambios;
      if (!Array.isArray(raw) || !raw.length) throw new UserError('"cambios" debe ser una lista con al menos un cambio');
      if (raw.length > 200) throw new UserError('Máximo 200 cambios por llamada');

      const ids = raw.map((c) => (c && typeof c === 'object' ? (c as Args).fichaje_id : null)).filter((x): x is string => typeof x === 'string' && !!x);
      const [entriesRes, employeesRes] = await Promise.all([
        ids.length ? db.from('time_entries').select('*').in('id', ids) : Promise.resolve({ data: [], error: null }),
        db.from('employees').select('id, first_name, last_name, active'),
      ]);
      const existing = new Map((check(entriesRes, 'No se pudieron leer los fichajes') as Record<string, unknown>[]).map((e) => [e.id as string, e]));
      const employees = new Map((check(employeesRes, 'No se pudo leer el personal') as Record<string, unknown>[]).map((e) => [e.id as string, e]));
      const nameOf = (id: unknown) => {
        const e = employees.get(id as string);
        return e ? `${e.first_name} ${e.last_name ?? ''}`.trim() : '¿?';
      };
      const hhmm = (iso: unknown) => (iso ? toMadrid(Date.parse(iso as string)).time : '—');

      type Op =
        | { kind: 'update'; id: string; patch: Record<string, unknown>; summary: Record<string, unknown> }
        | { kind: 'insert'; row: Record<string, unknown>; summary: Record<string, unknown> }
        | { kind: 'delete'; id: string; summary: Record<string, unknown> };
      const ops: Op[] = [];
      const errors: string[] = [];
      const stamp = (motivo: string | null, before: string) => `${motivo ?? 'Corregido según hoja de firmas'} (antes ${before})`;

      raw.forEach((c, i) => {
        try {
          if (!c || typeof c !== 'object') throw new UserError('no es un objeto');
          const r = c as Args;
          const id = str(r, 'fichaje_id');
          const motivo = str(r, 'motivo', { max: 300 });
          const brk = r.descanso_min == null ? null : Number(r.descanso_min);
          if (brk != null && (!Number.isInteger(brk) || brk < 0 || brk > 600)) throw new UserError('"descanso_min" debe ser un número entero de minutos');

          if (id) {
            const e = existing.get(id);
            if (!e) throw new UserError(`no existe el fichaje ${id}`);
            const who = nameOf(e.employee_id);
            const before = `${hhmm(e.clock_in)}–${hhmm(e.clock_out)}`;
            if (r.eliminar === true) {
              ops.push({ kind: 'delete', id, summary: { accion: 'eliminado', empleado: who, antes: before } });
              return;
            }
            const night = date(r, 'noche') ?? nightOf(Date.parse(e.clock_in as string));
            const inStr = str(r, 'entrada');
            const outStr = str(r, 'salida');
            const inMs = inStr ? nightTime(night, inStr, 'entrada') : Date.parse(e.clock_in as string);
            const outMs = outStr ? nightOut(night, outStr, inMs) : e.clock_out ? Date.parse(e.clock_out as string) : null;
            if (!inStr && !outStr && brk == null) throw new UserError('no indica nada que cambiar (entrada, salida, descanso_min o eliminar)');
            if (outMs != null && outMs <= inMs) throw new UserError(`la salida (${outStr ?? hhmm(e.clock_out)}) debe ser posterior a la entrada (${inStr ?? hhmm(e.clock_in)})`);
            const patch: Record<string, unknown> = {
              clock_in: new Date(inMs).toISOString(),
              clock_out: outMs == null ? null : new Date(outMs).toISOString(),
              notes: [e.notes, stamp(motivo, before)].filter(Boolean).join(' · '),
            };
            if (brk != null) patch.break_minutes = brk;
            ops.push({
              kind: 'update',
              id,
              patch,
              summary: { accion: 'modificado', empleado: who, noche: night, antes: before, ahora: `${toMadrid(inMs).time}–${outMs == null ? '—' : toMadrid(outMs).time}` },
            });
            return;
          }

          // Crear un fichaje: solo para trabajadores que ya están en la app
          const employeeId = str(r, 'empleado_id');
          if (!employeeId) throw new UserError('indica "fichaje_id" para modificar uno, o "empleado_id" para crearlo');
          const emp = employees.get(employeeId);
          if (!emp) throw new UserError(`no existe ningún trabajador con id ${employeeId} (no se crean trabajadores nuevos)`);
          const night = date(r, 'noche', true)!;
          const inMs = nightTime(night, str(r, 'entrada', { required: true })!, 'entrada');
          const outMs = nightOut(night, str(r, 'salida', { required: true })!, inMs);
          ops.push({
            kind: 'insert',
            row: {
              employee_id: employeeId,
              clock_in: new Date(inMs).toISOString(),
              clock_out: new Date(outMs).toISOString(),
              break_minutes: brk ?? 0,
              source: 'manual',
              notes: motivo ?? 'Añadido según hoja de firmas',
            },
            summary: { accion: 'creado', empleado: nameOf(employeeId), noche: night, ahora: `${toMadrid(inMs).time}–${toMadrid(outMs).time}` },
          });
        } catch (e) {
          errors.push(`Cambio ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      if (errors.length) throw new UserError(`No se ha cambiado nada. Corrige estos cambios:\n${errors.join('\n')}`);

      // Un fichaje nuevo no puede pisar otro de la misma persona
      for (const op of ops.filter((o): o is Extract<Op, { kind: 'insert' }> => o.kind === 'insert')) {
        const [start, end] = nightRange(op.summary.noche as string);
        const same = check(
          await db.from('time_entries').select('id, clock_in, clock_out').eq('employee_id', op.row.employee_id).gte('clock_in', start).lt('clock_in', end),
          'No se pudieron comprobar los fichajes',
        ) as Record<string, unknown>[];
        const pending = same.filter((x) => !ops.some((o) => o.kind === 'delete' && o.id === x.id));
        if (pending.length)
          throw new UserError(
            `No se ha cambiado nada: ${op.summary.empleado} ya tiene un fichaje la noche del ${op.summary.noche} (${hhmm(pending[0].clock_in)}–${hhmm(pending[0].clock_out)}, id ${pending[0].id}). Modifícalo con su fichaje_id en lugar de crear otro.`,
          );
      }

      const done: Record<string, unknown>[] = [];
      for (const op of ops) {
        try {
          if (op.kind === 'update') check(await db.from('time_entries').update(op.patch).eq('id', op.id).select('id').single(), 'No se pudo modificar');
          else if (op.kind === 'insert') check(await db.from('time_entries').insert(op.row).select('id').single(), 'No se pudo crear');
          else check(await db.from('time_entries').delete().eq('id', op.id), 'No se pudo eliminar');
          done.push(op.summary);
        } catch (e) {
          throw new Error(
            `${e instanceof Error ? e.message : String(e)} (${op.summary.empleado}). Antes de este error ya se aplicaron ${done.length} cambio(s): ${JSON.stringify(done)}`,
          );
        }
      }
      return { aplicados: done.length, cambios: done };
    },
  },
];

function mimeOf(fileName: string | null, given: string | null): string {
  if (given) {
    if (!MIME_TYPES.includes(given)) throw new UserError(`Tipo de archivo no permitido (${given}). Sólo PDF o imagen (JPG, PNG, WEBP, HEIC).`);
    return given;
  }
  const ext = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const byExt: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
  if (!ext || !byExt[ext]) throw new UserError('Indica tipo_mime o un nombre de archivo con extensión .pdf, .jpg, .png, .webp o .heic');
  return byExt[ext];
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  try {
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    throw new UserError('archivo_base64 no es base64 válido');
  }
}

async function registerInvoice({ db, userId }: Ctx, a: Args) {
  const kind = oneOf(a, 'tipo', ['recibida', 'emitida'] as const, 'recibida') === 'recibida' ? 'received' : 'issued';
  const txKind: TxKind = kind === 'received' ? 'expense' : 'income';
  const invoiceDate = date(a, 'fecha', true)!;
  const dueDate = date(a, 'vencimiento');
  const amount = money(a, 'importe', true)!;
  const tax = money(a, 'iva');
  if (tax != null && tax > amount) throw new UserError('El IVA no puede ser mayor que el importe total');
  const number = str(a, 'numero', { max: 100 });
  const status = oneOf(a, 'estado', ['pendiente', 'pagada'] as const, 'pendiente') === 'pagada' ? 'paid' : 'pending';
  const notes = str(a, 'notas', { max: 2000 });
  const method = oneOf(a, 'metodo_pago', METHODS, 'transferencia');
  const filePathArg = str(a, 'ruta_archivo');
  const base64 = str(a, 'archivo_base64');
  if (filePathArg && base64) throw new UserError('Indica ruta_archivo o archivo_base64, no los dos');

  // --- Proveedor (o cliente) ---
  let supplier: Record<string, unknown> | null = null;
  let supplierCreated = false;
  let party: string;
  const supplierId = str(a, 'proveedor_id');
  const partyName = str(a, 'proveedor', { max: 200 });
  const taxId = str(a, 'cif', { max: 40 });
  if (kind === 'received') {
    if (supplierId) {
      supplier = check(await db.from('suppliers').select('*').eq('id', supplierId).maybeSingle(), 'No se pudo leer el proveedor');
      if (!supplier) throw new UserError(`No existe ningún proveedor con id ${supplierId}. Usa buscar_proveedores.`);
    } else {
      if (!partyName) throw new UserError('Indica "proveedor" (nombre) o "proveedor_id"');
      supplier = await findSupplier(db, partyName, taxId);
    }
    party = (supplier?.name as string) ?? partyName!;
  } else {
    if (!partyName) throw new UserError('Indica el cliente en "proveedor"');
    party = partyName;
  }

  const cat = category(str(a, 'categoria') ?? (supplier?.category as string | null) ?? null, txKind);

  // --- ¿Ya existe? ---
  if (number && a.permitir_duplicada !== true) {
    let q = db.from('invoices').select('*').eq('kind', kind).eq('number', number);
    q = supplier ? q.eq('supplier_id', supplier.id) : q.ilike('party', party.replace(/[%_]/g, ''));
    const dup = check(await q.limit(1), 'No se pudo comprobar si la factura ya existe') as Record<string, unknown>[];
    if (dup.length)
      throw new UserError(
        `Ya existe la factura nº ${number} de ${party} (id ${dup[0].id}, ${dup[0].date}, ${Number(dup[0].amount)} €). No se ha guardado de nuevo; usa permitir_duplicada si de verdad es otra.`,
      );
  }

  // --- Archivo ---
  let file: { file_path: string; file_name: string; file_size: number | null; mime_type: string | null } = { file_path: '', file_name: '', file_size: null, mime_type: null };
  let uploaded: string | null = null;
  const givenName = str(a, 'nombre_archivo', { max: 200 });
  if (filePathArg) {
    const slash = filePathArg.lastIndexOf('/');
    const dir = filePathArg.slice(0, slash);
    const name = filePathArg.slice(slash + 1);
    const listed = check(await db.storage.from(BUCKET).list(dir, { search: name, limit: 10 }), 'No se pudo comprobar el archivo') as {
      name: string;
      metadata?: { size?: number; mimetype?: string } | null;
    }[];
    const obj = listed.find((o) => o.name === name);
    if (slash < 0 || !obj) throw new UserError(`No se encuentra el archivo subido en "${filePathArg}". Comprueba que el comando curl terminó bien (o vuelve a llamar a preparar_subida_factura).`);
    file = {
      file_path: filePathArg,
      file_name: givenName ?? name.replace(/^[0-9a-f-]{36}-/, ''),
      file_size: obj.metadata?.size ?? null,
      mime_type: obj.metadata?.mimetype ?? null,
    };
  } else if (base64) {
    const bytes = decodeBase64(base64);
    if (!bytes.length) throw new UserError('archivo_base64 está vacío');
    if (bytes.length > MAX_FILE) throw new UserError('El archivo es demasiado grande (máximo 15 MB)');
    const fileName = givenName ?? `factura-${number ?? invoiceDate}.pdf`;
    const mime = mimeOf(fileName, str(a, 'tipo_mime'));
    const path = `${invoiceDate.slice(0, 4)}/${invoiceDate.slice(5, 7)}/${crypto.randomUUID()}-${safeName(fileName)}`;
    check(await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false }), 'No se pudo subir el archivo');
    uploaded = path;
    file = { file_path: path, file_name: fileName, file_size: bytes.length, mime_type: mime };
  }

  // --- Guardar ---
  let txId: string | null = null;
  try {
    if (kind === 'received' && !supplier) {
      supplier = check(
        await db
          .from('suppliers')
          .insert({
            name: party,
            tax_id: taxId?.toUpperCase() ?? null,
            email: str(a, 'email_proveedor', { max: 200 }),
            phone: str(a, 'telefono_proveedor', { max: 50 }),
            category: cat,
          })
          .select()
          .single(),
        'No se pudo crear el proveedor',
      );
      supplierCreated = true;
    } else if (supplier && !supplier.category) {
      // Primera factura con categoría: queda como su categoría habitual
      await db.from('suppliers').update({ category: cat }).eq('id', supplier.id);
    }

    if (a.registrar_en_finanzas === true && amount > 0) {
      const tx = check(
        await db
          .from('transactions')
          .insert({
            date: invoiceDate,
            kind: txKind,
            category: cat,
            amount,
            method,
            description: ['Factura', number, '·', party].filter(Boolean).join(' '),
            created_by: userId,
          })
          .select('id')
          .single(),
        'No se pudo crear el movimiento en Finanzas',
      ) as { id: string };
      txId = tx.id;
    }

    const invoice = check(
      await db
        .from('invoices')
        .insert({
          kind,
          party,
          supplier_id: (supplier?.id as string) ?? null,
          number,
          date: invoiceDate,
          due_date: dueDate,
          amount,
          tax,
          category: cat,
          status,
          notes,
          ...file,
          transaction_id: txId,
          created_by: userId,
        })
        .select()
        .single(),
      'No se pudo guardar la factura',
    );

    return {
      factura: invoiceOut(invoice),
      proveedor: supplier ? supplierOut(supplier) : null,
      proveedor_creado: supplierCreated,
      registrada_en_finanzas: !!txId,
      ...(!file.file_path ? { aviso: 'La factura se ha guardado sin archivo: adjúntalo desde la app (Facturas → editar).' } : {}),
    };
  } catch (e) {
    // No dejar el archivo, el movimiento ni el proveedor nuevo huérfanos
    if (uploaded) await db.storage.from(BUCKET).remove([uploaded]);
    if (txId) await db.from('transactions').delete().eq('id', txId);
    if (supplierCreated && supplier) await db.from('suppliers').delete().eq('id', supplier.id);
    throw e;
  }
}

// ---------------------------------------------------------------------
//  JSON-RPC / MCP
// ---------------------------------------------------------------------

type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

const rpcResult = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handleRpc(ctx: Ctx, msg: RpcRequest) {
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS.map(({ run: _run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Herramienta desconocida: ${String(params.name)}`);
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Args;
      try {
        const out = await tool.run(ctx, args);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
      } catch (e) {
        if (!(e instanceof UserError)) console.error(`[mcp] ${tool.name}`, e);
        const message = e instanceof Error ? e.message : String(e);
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
      }
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Método no soportado: ${method}`);
  }
}

/**
 * Código secreto del enlace: …/<función>/<código>, ?token=<código> o "Authorization: Bearer <código>".
 * Vale cualquier nombre de función (en el panel de Supabase se le puede haber puesto otro).
 */
function tokenOf(req: Request): string | null {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts.length > 1 ? decodeURIComponent(parts[parts.length - 1]) : null;
  const fromPath = last && last.length >= 32 ? last : null;
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  // Un JWT de Supabase (si la pasarela lo pide) no es nuestro código
  const fromHeader = bearer && !bearer.startsWith('eyJ') ? bearer : null;
  return fromPath || url.searchParams.get('token') || fromHeader || null;
}

type Auth = { ok: true; userId: string; label: string } | { ok: false; status: number; message: string };

const INVALID_LINK = 'Enlace no válido o desactivado. Genera uno nuevo en Vizzio → Ajustes → Conector de Claude.';

async function authenticate(db: SupabaseClient | null, token: string | null): Promise<Auth> {
  // Un enlace incorrecto responde 403 (no 401): con 401 Claude intenta iniciar sesión con OAuth
  if (!db) return { ok: false, status: 500, message: 'La función no tiene la clave de servicio de Supabase (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS).' };
  if (!token || token.length < 32) return { ok: false, status: 403, message: INVALID_LINK };
  const hash = await sha256(token);
  const { data: link, error } = await db.from('claude_connectors').select('id, label, created_by').eq('token_hash', hash).maybeSingle();
  if (error) return { ok: false, status: 500, message: `No se pudo leer la base de datos: ${error.message}` };
  if (!link?.created_by) return { ok: false, status: 403, message: INVALID_LINK };
  const { data: profile, error: profileError } = await db.from('profiles').select('role').eq('id', link.created_by).maybeSingle();
  if (profileError) return { ok: false, status: 500, message: `No se pudo leer la base de datos: ${profileError.message}` };
  if (profile?.role !== 'admin') return { ok: false, status: 403, message: 'Quien creó este enlace ya no es administrador. Genera uno nuevo en Vizzio → Ajustes → Conector de Claude.' };
  await db.from('claude_connectors').update({ last_used_at: new Date().toISOString() }).eq('id', link.id);
  return { ok: true, userId: link.created_by as string, label: link.label as string };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Página de diagnóstico: al abrir el enlace del conector en el navegador */
async function diagnostics(req: Request, db: SupabaseClient | null): Promise<Response> {
  const auth = await authenticate(db, tokenOf(req));
  const rows: [boolean, string, string][] = [
    [true, 'Función publicada', 'La función responde y la verificación JWT está desactivada.'],
    [!!db, 'Clave de servicio', db ? 'Disponible.' : 'Falta: la función no puede acceder a la base de datos.'],
  ];
  if (auth.ok) rows.push([true, 'Enlace', `Válido ("${auth.label}"). Ya puedes añadirlo en Claude como conector personalizado.`]);
  else rows.push([false, auth.status === 500 ? 'Base de datos' : 'Enlace', auth.message]);
  const ok = rows.every(([good]) => good);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conector Vizzio</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;background:#111;color:#eee}h1{font-size:22px}li{margin:10px 0;list-style:none}b{display:block}.ok{color:#4ade80}.ko{color:#f87171}small{color:#999}</style></head>
<body><h1>${ok ? '✅ Conector de Vizzio listo' : '⚠️ Conector de Vizzio: hay un problema'}</h1><ul>${rows
    .map(([good, title, text]) => `<li><b class="${good ? 'ok' : 'ko'}">${good ? '✔' : '✘'} ${escapeHtml(title)}</b>${escapeHtml(text)}</li>`)
    .join('')}</ul><small>Esta página es solo para comprobar el enlace. Claude se conecta a esta misma dirección.</small></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } });
}

export async function handler(req: Request, db: SupabaseClient | null): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // Abierto desde el navegador: página de diagnóstico
  if (req.method === 'GET' && !(req.headers.get('accept') ?? '').includes('text/event-stream')) return diagnostics(req, db);
  // Sin estado: no hay canal SSE ni sesiones que cerrar
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST', ...CORS } });

  const auth = await authenticate(db, tokenOf(req));
  if (!auth.ok) {
    if (auth.status === 500) console.error('[mcp]', auth.message);
    return json(rpcError(null, -32001, auth.message), auth.status);
  }
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, 'JSON no válido'), 400);
  }

  const ctx: Ctx = { db: db!, userId }; // si hay enlace válido, hay base de datos
  const messages = (Array.isArray(body) ? body : [body]) as RpcRequest[];
  const responses = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
      // Respuestas del cliente a peticiones nuestras: no hacemos ninguna
      if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg)) continue;
      responses.push(rpcError(null, -32600, 'Petición no válida'));
      continue;
    }
    if (msg.id === undefined) continue; // notificación (p. ej. notifications/initialized)
    responses.push(await handleRpc(ctx, msg));
  }

  if (!responses.length) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? responses : responses[0]);
}

/**
 * Clave de servicio: la de VIZZIO_SERVICE_KEY si se ha configurado; si no, la clave
 * secreta nueva de Supabase (SUPABASE_SECRET_KEYS) o la antigua (SUPABASE_SERVICE_ROLE_KEY).
 */
function serviceKey(): string | undefined {
  const custom = Deno.env.get('VIZZIO_SERVICE_KEY');
  if (custom) return custom;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    const key = keys.default ?? Object.values(keys)[0];
    if (key) return key;
  } catch {
    /* sin claves nuevas */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined;
}

if (!Deno.env.get('VIZZIO_MCP_TEST')) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  Deno.serve((req) => handler(req, db));
}

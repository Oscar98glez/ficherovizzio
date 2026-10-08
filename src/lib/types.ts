/** admin = administrador · worker = camarero/trabajador · rrpp = relaciones públicas (ficha y gestiona reservados) · tech = DJ / técnico (como los camareros) */
export type Role = 'admin' | 'worker' | 'rrpp' | 'tech';
export type Department =
  | 'direccion'
  | 'barra'
  | 'sala'
  | 'seguridad'
  | 'cabina'
  | 'relaciones'
  | 'taquilla'
  | 'guardarropa'
  | 'limpieza';
export type ContractType = 'fijo' | 'fijo_discontinuo' | 'temporal' | 'extra' | 'autonomo';
export type EventKind = 'sesion' | 'evento_privado' | 'concierto' | 'especial';
export type TxKind = 'income' | 'expense';
export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'bizum' | 'otro';
export type ShiftStatus = 'planned' | 'confirmed' | 'cancelled';
/** Respuesta del trabajador al turno */
export type ShiftResponse = 'accepted' | 'declined';
export type RequestKind = 'vacaciones' | 'ausencia' | 'cambio_turno' | 'baja' | 'otro';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
}

export interface Employee {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  position: string;
  department: Department;
  contract_type: ContractType;
  hourly_rate: number;
  hire_date: string | null;
  active: boolean;
  color: string;
  notes: string | null;
  /** Foto de perfil (URL pública) */
  photo_url: string | null;
  /** RRPP: comisiones propias (null = se usa la del día de la semana) */
  rrpp_bottle_pct?: number | null;
  rrpp_ticket_pct?: number | null;
  /** RRPP: € por cada persona que entra por su lista */
  rrpp_list_fee?: number | null;
  /** RRPP: su usuario de Fourvenues (las entradas que vende con su enlace) */
  fourvenues_user_id?: string | null;
  created_at: string;
}

export interface ClubEvent {
  id: string;
  name: string;
  date: string;
  kind: EventKind;
  expected_attendance: number | null;
  notes: string | null;
  /** Evento de Fourvenues asociado (la noche se sincroniza con él) */
  fourvenues_id?: string | null;
  /** Fourvenues: personas con entrada y cuántas han entrado ya */
  tickets_sold?: number | null;
  tickets_entered?: number | null;
  fourvenues_synced_at?: string | null;
  created_at: string;
}

export interface TimeEntry {
  id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  hourly_rate: number;
  event_id: string | null;
  source: 'app' | 'manual';
  notes: string | null;
  created_at: string;
}

/** Fichaje propio del trabajador: sin tarifa, con lo ganado (calculado en el servidor; null si sigue abierto) */
export interface MyTimeEntry extends TimeEntry {
  /** undefined si la base de datos aún no tiene la migración que lo calcula */
  earned?: number | null;
}

export interface Shift {
  id: string;
  employee_id: string;
  event_id: string | null;
  start_at: string;
  /** Hora de salida: se rellena sola cuando el empleado ficha la salida */
  end_at: string | null;
  position: string | null;
  status: ShiftStatus;
  notes: string | null;
  /** Lo acepta (asistirá) o lo rechaza; null mientras no responda */
  response?: ShiftResponse | null;
  responded_at?: string | null;
  /** Motivo del rechazo (opcional) */
  response_note?: string | null;
  created_at: string;
}

export type MessageKind = 'message' | 'task';

/** Mensaje o tarea que el administrador envía a uno o varios trabajadores */
export interface Message {
  id: string;
  kind: MessageKind;
  title: string;
  body: string | null;
  /** Fecha límite (sólo tareas, opcional) */
  due_date: string | null;
  created_by: string | null;
  created_at: string;
}

/** Cada trabajador que recibe un mensaje: si lo ha leído y, en las tareas, si la acepta o la rechaza */
export interface MessageRecipient {
  id: string;
  message_id: string;
  employee_id: string;
  read_at: string | null;
  response: ShiftResponse | null;
  responded_at: string | null;
  response_note: string | null;
  created_at: string;
}

/** Respuesta dentro de la conversación de un destinatario con la administración */
export interface MessageReply {
  id: string;
  recipient_id: string;
  author_id: string | null;
  /** true: la escribe la administración; false: el trabajador */
  from_admin: boolean;
  body: string;
  created_at: string;
  /** Cuándo la leyó el otro lado */
  read_at: string | null;
}

export interface Transaction {
  id: string;
  date: string;
  kind: TxKind;
  category: string;
  amount: number;
  method: PaymentMethod;
  description: string | null;
  event_id: string | null;
  employee_id: string | null;
  period: string | null;
  /** Movimiento importado (p. ej. "fourvenues:entradas:<evento>"): se actualiza solo */
  external_id?: string | null;
  created_at: string;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  kind: RequestKind;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: RequestStatus;
  reviewed_at: string | null;
  created_at: string;
}

export interface Availability {
  id: string;
  employee_id: string;
  /** YYYY-MM-DD: la noche de ese día */
  date: string;
  available: boolean;
  /** HH:MM(:SS) o null = toda la noche */
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  updated_at: string;
}

export type InvoiceKind = 'received' | 'issued';
export type InvoiceStatus = 'pending' | 'paid';

export interface Invoice {
  id: string;
  /** received = factura de proveedor (gasto) · issued = factura emitida a un cliente (ingreso) */
  kind: InvoiceKind;
  /** Proveedor o cliente */
  party: string;
  number: string | null;
  date: string;
  due_date: string | null;
  amount: number;
  tax: number | null;
  category: string | null;
  status: InvoiceStatus;
  notes: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  transaction_id: string | null;
  /** Proveedor (facturas recibidas) */
  supplier_id: string | null;
  created_at: string;
}

/** Enlace con el que Claude (conector MCP) accede a Finanzas y Facturas */
export interface ClaudeConnector {
  id: string;
  label: string;
  token_hash: string;
  token_hint: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** Proveedor del local: cada uno tiene su apartado de facturas */
export interface Supplier {
  id: string;
  name: string;
  /** Categoría de gasto por defecto de sus facturas */
  category: string | null;
  /** CIF / NIF */
  tax_id: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
}

export interface VipTable {
  id: string;
  /** "VIP 1", "Palco 2"... */
  name: string;
  zone: string | null;
  capacity: number | null;
  /** Consumo mínimo */
  min_spend: number | null;
  active: boolean;
  sort: number;
  notes: string | null;
  /** Posición en el plano (null = sin ubicar) */
  map_x: number | null;
  map_y: number | null;
  map_w: number | null;
  map_h: number | null;
  created_at: string;
}

/** RRPP que se puede elegir en una reserva */
export interface StaffOption {
  id: string;
  name: string;
}

/** Una línea de la consumición: botella o refresco, cuántas y su precio unitario */
export interface OrderItem {
  name: string;
  qty: number;
  /** Precio por unidad (el de la carta, o el escrito a mano si no está en ella) */
  price?: number;
  /** Cortesía: la regala el local y cuenta 0 € */
  courtesy?: boolean;
}

export type ReservationOrigin = 'otros' | 'empresa';

export type ReservationStatus = 'pending' | 'confirmed' | 'arrived' | 'cancelled' | 'no_show';

export interface Reservation {
  id: string;
  /** YYYY-MM-DD: la noche */
  date: string;
  table_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  guests: number;
  /** HH:MM(:SS) */
  arrival_time: string | null;
  /** Consumo mínimo acordado */
  min_spend: number | null;
  /** Señal cobrada */
  deposit: number;
  /** Botellas pedidas */
  bottles: OrderItem[];
  /** Refrescos pedidos */
  mixers: OrderItem[];
  /** Importe total del reservado */
  total_amount: number | null;
  status: ReservationStatus;
  notes: string | null;
  /** RRPP de la reserva (quien la trae) */
  rrpp_id: string | null;
  rrpp_name: string | null;
  /** La reserva no la trae un RRPP sino "Otros" o "Empresa" */
  rrpp_origin: ReservationOrigin | null;
  /** RRPP que atiende el reservado esa noche */
  host_rrpp_id: string | null;
  host_rrpp_name: string | null;
  /** Usuario que creó la reserva */
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** % de comisión de los RRPP para un día de la semana (0 = domingo … 6 = sábado) */
export interface CommissionRate {
  id: string;
  weekday: number;
  bottle_pct: number;
  ticket_pct: number;
  /** € por persona de lista */
  list_fee: number;
  updated_at: string;
}

/** Entradas vendidas por un RRPP en una noche */
export interface TicketSale {
  id: string;
  /** YYYY-MM-DD: la noche */
  date: string;
  employee_id: string;
  quantity: number;
  /** Precio de venta de cada entrada */
  unit_price: number;
  /** Personas que entran por su lista */
  list_quantity: number;
  notes: string | null;
  /** Entradas traídas de Fourvenues (la lista sigue siendo a mano) */
  fourvenues_synced_at?: string | null;
  created_at: string;
}

/** Resumen de una sincronización con Fourvenues (supabase/functions/fourvenues-sync) */
export interface FourvenuesResult {
  from: string;
  to: string;
  events: number;
  created: number;
  linked: number;
  moved: number;
  tickets: number;
  revenue: number;
  rrpp: number;
  rrppLinked: number;
  /** RRPP de Fourvenues con ventas que no están asociados a ninguna ficha */
  unmatched: { id: string; name: string | null; email: string | null; tickets: number; revenue: number }[];
  warnings: string[];
}

export interface FourvenuesSync {
  running_since: string | null;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_result: FourvenuesResult | null;
}

/** Usuario de Fourvenues (para asociar los RRPP a su ficha) */
export interface FourvenuesUser {
  id: string;
  name: string | null;
  email: string | null;
}

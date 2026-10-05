/** admin = administrador · worker = camarero/trabajador · rrpp = relaciones públicas (ficha y gestiona reservados) */
export type Role = 'admin' | 'worker' | 'rrpp';
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
  created_at: string;
}

export interface ClubEvent {
  id: string;
  name: string;
  date: string;
  kind: EventKind;
  expected_attendance: number | null;
  notes: string | null;
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
  created_at: string;
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

/** Una línea de la consumición: botella o refresco y cuántas */
export interface OrderItem {
  name: string;
  qty: number;
}

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
  /** Empleado RRPP que la gestiona */
  rrpp_id: string | null;
  rrpp_name: string | null;
  created_at: string;
  updated_at: string;
}

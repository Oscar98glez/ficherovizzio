export type Role = 'admin' | 'worker';
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
  end_at: string;
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

import type {
  ContractType,
  Department,
  EventKind,
  PaymentMethod,
  RequestKind,
  RequestStatus,
  ShiftStatus,
} from './types';

export type Tone = 'gray' | 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'teal' | 'pink' | 'indigo';

export const DEPARTMENTS: Record<Department, { label: string; tone: Tone }> = {
  direccion: { label: 'Dirección', tone: 'purple' },
  barra: { label: 'Barra', tone: 'blue' },
  sala: { label: 'Sala', tone: 'teal' },
  seguridad: { label: 'Seguridad', tone: 'gray' },
  cabina: { label: 'Cabina / DJ', tone: 'pink' },
  relaciones: { label: 'Relaciones públicas', tone: 'orange' },
  taquilla: { label: 'Taquilla', tone: 'indigo' },
  guardarropa: { label: 'Guardarropa', tone: 'teal' },
  limpieza: { label: 'Limpieza', tone: 'green' },
};

export const POSITIONS = [
  'Gerente',
  'Encargado/a',
  'Jefe/a de barra',
  'Camarero/a',
  'Barback',
  'Relaciones públicas',
  'Portero/a',
  'Vigilante de seguridad',
  'DJ residente',
  'DJ invitado',
  'Técnico/a de sonido',
  'Técnico/a de iluminación',
  'Taquillero/a',
  'Guardarropa',
  'Host / Hostess',
  'Animación',
  'Limpieza',
];

export const CONTRACTS: Record<ContractType, string> = {
  fijo: 'Indefinido',
  fijo_discontinuo: 'Fijo discontinuo',
  temporal: 'Temporal',
  extra: 'Extra por noche',
  autonomo: 'Autónomo',
};

export const EVENT_KINDS: Record<EventKind, { label: string; tone: Tone }> = {
  sesion: { label: 'Sesión', tone: 'blue' },
  especial: { label: 'Especial', tone: 'purple' },
  concierto: { label: 'Concierto', tone: 'pink' },
  evento_privado: { label: 'Evento privado', tone: 'orange' },
};

export const METHODS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  bizum: 'Bizum',
  otro: 'Otro',
};

export const PAYROLL_CATEGORY = 'Nóminas';

export const INCOME_CATEGORIES = [
  'Taquilla',
  'Barra',
  'Reservados VIP',
  'Guardarropa',
  'Eventos privados',
  'Patrocinios',
  'Otros ingresos',
];

export const EXPENSE_CATEGORIES = [
  PAYROLL_CATEGORY,
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

/** Categorías que se desglosan en el cierre de caja de cada noche */
export const CLOSEOUT_CATEGORIES = ['Taquilla', 'Barra', 'Reservados VIP', 'Guardarropa'];

export const REQUEST_KINDS: Record<RequestKind, string> = {
  vacaciones: 'Vacaciones',
  ausencia: 'Ausencia',
  cambio_turno: 'Cambio de turno',
  baja: 'Baja médica',
  otro: 'Otro',
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pendiente', tone: 'orange' },
  approved: { label: 'Aprobada', tone: 'green' },
  rejected: { label: 'Rechazada', tone: 'red' },
};

export const SHIFT_STATUS: Record<ShiftStatus, { label: string; tone: Tone }> = {
  planned: { label: 'Planificado', tone: 'gray' },
  confirmed: { label: 'Confirmado', tone: 'green' },
  cancelled: { label: 'Cancelado', tone: 'red' },
};

export const EMPLOYEE_COLORS = [
  '#0071e3',
  '#34c759',
  '#ff9500',
  '#ff2d55',
  '#af52de',
  '#5856d6',
  '#30b0c7',
  '#a2845e',
  '#ff3b30',
  '#8e8e93',
];

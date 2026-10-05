import type {
  ContractType,
  Department,
  EventKind,
  PaymentMethod,
  RequestKind,
  RequestStatus,
  ReservationOrigin,
  ReservationStatus,
  Role,
  ShiftStatus,
} from './types';

export type Tone = 'gray' | 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'teal' | 'pink' | 'indigo';

export const ROLES: Record<Role, string> = {
  worker: 'Trabajador',
  rrpp: 'RRPP',
  admin: 'Administrador',
};

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

/** Puestos de una discoteca agrupados por departamento (al elegir uno se asigna su departamento) */
export const POSITION_GROUPS: { department: Department; positions: string[] }[] = [
  { department: 'direccion', positions: ['Gerente', 'Director/a de sala', 'Encargado/a', 'Jefe/a de sala', 'Administrativo/a'] },
  { department: 'barra', positions: ['Jefe/a de barra', 'Bartender / Coctelero/a', 'Camarero/a', 'Barback / Ayudante de barra'] },
  {
    department: 'sala',
    positions: ['Camarero/a de bandeja', 'Camarero/a de reservados VIP', 'Botellero/a', 'Runner', 'Host / Hostess', 'Gogó / Bailarín/a', 'Animador/a', 'Performer'],
  },
  { department: 'seguridad', positions: ['Jefe/a de seguridad', 'Portero/a', 'Vigilante de seguridad', 'Control de acceso', 'Auxiliar de seguridad'] },
  { department: 'cabina', positions: ['DJ residente', 'DJ invitado', 'Técnico/a de sonido', 'Técnico/a de iluminación', 'VJ / Técnico/a de vídeo'] },
  { department: 'relaciones', positions: ['Relaciones públicas', 'Jefe/a de relaciones públicas', 'Promotor/a', 'Fotógrafo/a', 'Community manager'] },
  { department: 'taquilla', positions: ['Taquillero/a', 'Cajero/a'] },
  { department: 'guardarropa', positions: ['Guardarropa'] },
  { department: 'limpieza', positions: ['Limpieza', 'Encargado/a de aseos', 'Mantenimiento'] },
];

export const POSITIONS = POSITION_GROUPS.flatMap((g) => g.positions);

export const departmentOfPosition = (position: string) => POSITION_GROUPS.find((g) => g.positions.includes(position))?.department;

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
export const STAFF_CATEGORY = 'Personal';
/** Coste de los fichajes (horas × tarifa) de cada noche: se suma solo a los gastos de personal */
export const TIMESHEET_CATEGORY = 'Fichajes';

/** Nombres antiguos de categorías que se muestran con su nombre actual */
const LEGACY_CATEGORIES: Record<string, string> = { Camareros: STAFF_CATEGORY };
export const normalizeCategory = (category: string) => LEGACY_CATEGORIES[category] ?? category;

/** Gastos que cuentan como "gastos de personal" (lo pagado al personal) en lugar de gastos operativos. */
export const STAFF_EXPENSE_CATEGORIES = [PAYROLL_CATEGORY, STAFF_CATEGORY];

export const isStaffExpense = (t: { kind: string; category: string }) =>
  t.kind === 'expense' && STAFF_EXPENSE_CATEGORIES.includes(t.category);

export const PRIVATE_EVENT_CATEGORY = 'Eventos privados';

export const BAR_CATEGORIES = ['Barra 1', 'Barra 2', 'Barra 3'];

export const INCOME_CATEGORIES = [
  'Taquilla',
  ...BAR_CATEGORIES,
  'Reservados VIP',
  'Guardarropa',
  PRIVATE_EVENT_CATEGORY,
  'Patrocinios',
  'Otros ingresos',
];

export const EXPENSE_CATEGORIES = [
  PAYROLL_CATEGORY,
  STAFF_CATEGORY,
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
export const CLOSEOUT_CATEGORIES = ['Taquilla', ...BAR_CATEGORIES, 'Reservados VIP', 'Guardarropa'];

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

/** Origen de una reserva que no trae un RRPP */
export const RESERVATION_ORIGINS: Record<ReservationOrigin, string> = {
  otros: 'Otros',
  empresa: 'Empresa',
};

/** Estados de una reserva (las canceladas y "no vino" dejan el reservado libre) */
export const RESERVATION_STATUS: Record<ReservationStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pendiente', tone: 'orange' },
  confirmed: { label: 'Confirmada', tone: 'green' },
  arrived: { label: 'Ha llegado', tone: 'purple' },
  cancelled: { label: 'Cancelada', tone: 'gray' },
  no_show: { label: 'No vino', tone: 'red' },
};

export const isActiveReservation = (r: { status: ReservationStatus }) => r.status !== 'cancelled' && r.status !== 'no_show';

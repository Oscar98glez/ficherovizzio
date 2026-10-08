-- =====================================================================
--  Fourvenues: sólo entradas, sin ingresos
--  La venta de entradas la apunta el administrador a mano en Finanzas, así
--  que la sincronización deja de crear movimientos de "Entradas online" y
--  en cada noche guarda, por separado, las entradas vendidas y los QR gratis.
-- =====================================================================

alter table public.events
  -- Personas con entrada de pago (cualquier canal) y con QR gratis / invitación
  add column if not exists tickets_paid integer check (tickets_paid >= 0),
  add column if not exists tickets_free integer check (tickets_free >= 0);

-- Los movimientos que hubiera creado la sincronización dejan de contar en Finanzas
delete from public.transactions where external_id like 'fourvenues:entradas:%';

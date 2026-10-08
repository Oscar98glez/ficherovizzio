-- =====================================================================
--  Fourvenues: reservados (reservas de mesa) de cada noche y de cada RRPP
--  La sincronización cuenta las reservas de Fourvenues (sin canceladas) de
--  cada noche y las de cada RRPP. null: la clave no tiene acceso a ellas.
-- =====================================================================

alter table public.events
  add column if not exists bookings integer check (bookings >= 0);

alter table public.fourvenues_rrpp_nights
  add column if not exists bookings integer check (bookings >= 0);

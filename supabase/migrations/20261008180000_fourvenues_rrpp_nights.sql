-- =====================================================================
--  Fourvenues: desglose por RRPP de cada noche
--  La sincronización guarda, por cada RRPP de Fourvenues (con el nombre que
--  tiene allí), las entradas de pago y las personas en listas (QR gratis) de
--  cada noche. Lo que no lleva RRPP va en una fila con fourvenues_user_id ''.
--  Se rehace entera en cada sincronización de esa noche.
-- =====================================================================

create table if not exists public.fourvenues_rrpp_nights (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  -- Usuario de Fourvenues que la ha vendido ('' = sin RRPP)
  fourvenues_user_id  text not null,
  -- Nombre en Fourvenues en el momento de sincronizar
  name                text,
  -- Personas con entrada de pago y personas apuntadas en sus listas
  tickets             integer not null default 0 check (tickets >= 0),
  -- null: la clave no tiene acceso a las listas
  lists               integer check (lists >= 0),
  synced_at           timestamptz not null default now(),
  constraint fourvenues_rrpp_nights_unique unique (event_id, fourvenues_user_id)
);

alter table public.fourvenues_rrpp_nights enable row level security;

-- Sólo la consultan los administradores; la escribe la función (con la clave de servicio)
drop policy if exists fourvenues_rrpp_nights_admin_select on public.fourvenues_rrpp_nights;
create policy fourvenues_rrpp_nights_admin_select on public.fourvenues_rrpp_nights
  for select to authenticated using (public.is_admin());

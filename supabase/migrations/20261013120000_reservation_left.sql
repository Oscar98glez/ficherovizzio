-- Reservas: estado "Se ha ido" (left).
-- El cliente ya se ha marchado: la reserva sigue contando (coste total, comisiones de los RRPP),
-- pero el reservado queda libre para sentar a otro cliente esa misma noche.

alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('pending', 'confirmed', 'arrived', 'left', 'cancelled', 'no_show'));

-- Un reservado sólo puede tener una reserva ocupándolo por noche (las de "Se ha ido" ya no lo ocupan)
drop index if exists public.reservations_table_night;
create unique index reservations_table_night
  on public.reservations (table_id, date)
  where table_id is not null and status not in ('cancelled', 'no_show', 'left');

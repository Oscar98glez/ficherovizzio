-- =====================================================================
--  Mapa interactivo de reservados y consumición de cada reserva
--  · Cada reservado guarda su posición en el plano (map_x, map_y, map_w, map_h).
--  · Se crean los 11 reservados del local (Room 1, Room 2 y Zona DJ) si no existen.
--  · Cada reserva guarda las botellas, los refrescos y el importe total.
-- =====================================================================

alter table public.vip_tables
  add column if not exists map_x numeric,
  add column if not exists map_y numeric,
  add column if not exists map_w numeric,
  add column if not exists map_h numeric;

alter table public.reservations
  add column if not exists bottles      jsonb not null default '[]'::jsonb,   -- [{ "name": "Grey Goose", "qty": 1 }]
  add column if not exists mixers       jsonb not null default '[]'::jsonb,   -- [{ "name": "Coca-Cola", "qty": 4 }]
  add column if not exists total_amount numeric(10,2) check (total_amount >= 0);

-- Reservados del local con su posición en el plano
drop table if exists vip_seed;
create temporary table vip_seed (name text, zone text, capacity integer, sort integer, map_x numeric, map_y numeric, map_w numeric, map_h numeric);
insert into vip_seed values
  ('Reservado 1', 'Room 1', null::integer, 1, 32, 673, 72, 56),
  ('Reservado 2', 'Room 1', null::integer, 2, 32, 600, 72, 56),
  ('Reservado 3', 'Room 1', null::integer, 3, 32, 525, 72, 56),
  ('Reservado 4', 'Room 2', null::integer, 4, 400, 442, 64, 52),
  ('Reservado 5', 'Room 2', null::integer, 5, 400, 382, 64, 52),
  ('Reservado 6', 'Room 2', null::integer, 6, 400, 312, 64, 52),
  ('Reservado 7', 'Room 2', null::integer, 7, 400, 247, 64, 52),
  ('Reservado 8', 'Zona DJ', 16, 8, 369, 97, 58, 54),
  ('Reservado 9', 'Zona DJ', 16, 9, 45, 97, 58, 54),
  ('Reservado 10', 'Zona DJ', 8, 10, 357, 10, 58, 56),
  ('Reservado 11', 'Zona DJ', 8, 11, 45, 10, 58, 56);

insert into public.vip_tables (name, zone, capacity, sort, map_x, map_y, map_w, map_h)
select s.name, s.zone, s.capacity, s.sort, s.map_x, s.map_y, s.map_w, s.map_h
from vip_seed s
where not exists (select 1 from public.vip_tables t where lower(t.name) = lower(s.name));

-- Si ya existían con ese nombre pero sin ubicar, se colocan en el plano
update public.vip_tables t
   set map_x = s.map_x, map_y = s.map_y, map_w = s.map_w, map_h = s.map_h,
       zone = coalesce(t.zone, s.zone), capacity = coalesce(t.capacity, s.capacity)
  from vip_seed s
 where lower(t.name) = lower(s.name) and t.map_x is null;

drop table vip_seed;

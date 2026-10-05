-- =====================================================================
--  Usuario RRPP (relaciones públicas) y gestión de reservados
--  · Nuevo rol "rrpp": ficha como un trabajador y además gestiona reservas.
--  · "vip_tables": los reservados del local (los gestiona el administrador).
--  · "reservations": las reservas de cada noche. Los RRPP ven todas (para
--    saber qué reservados están libres) y sólo editan las suyas.
-- =====================================================================

-- ---------- Rol ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'worker', 'rrpp'));

create or replace function public.is_rrpp()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'rrpp');
$$;

-- Administradores y RRPP pueden consultar los reservados y las reservas
create or replace function public.can_reserve()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'rrpp'));
$$;

-- ---------- Reservados ----------
create table if not exists public.vip_tables (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                                   -- "VIP 1", "Palco 2"...
  zone        text,                                            -- zona del local
  capacity    integer check (capacity > 0),                    -- personas
  min_spend   numeric(10,2) check (min_spend >= 0),            -- consumo mínimo
  active      boolean not null default true,
  sort        integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table public.vip_tables enable row level security;

drop policy if exists vip_tables_read on public.vip_tables;
create policy vip_tables_read on public.vip_tables
  for select to authenticated using (public.can_reserve());

drop policy if exists vip_tables_admin_all on public.vip_tables;
create policy vip_tables_admin_all on public.vip_tables
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Reservas ----------
create table if not exists public.reservations (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,                               -- la noche
  table_id        uuid references public.vip_tables (id) on delete set null,
  customer_name   text not null,
  customer_phone  text,
  guests          integer not null default 1 check (guests > 0),
  arrival_time    time,
  min_spend       numeric(10,2) check (min_spend >= 0),        -- consumo mínimo acordado
  deposit         numeric(10,2) not null default 0 check (deposit >= 0),  -- señal cobrada
  status          text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'arrived', 'cancelled', 'no_show')),
  notes           text,
  rrpp_id         uuid references public.employees (id) on delete set null,
  rrpp_name       text,                                        -- nombre del RRPP (visible para el resto)
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists reservations_date_idx on public.reservations (date);

-- Un reservado sólo puede tener una reserva activa por noche
create unique index if not exists reservations_table_night
  on public.reservations (table_id, date)
  where table_id is not null and status not in ('cancelled', 'no_show');

-- El RRPP queda como autor de sus reservas (no puede asignarlas a otro)
create or replace function public.reservation_defaults()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.rrpp_id := public.my_employee_id();
    else
      new.rrpp_id := old.rrpp_id;
      new.created_by := old.created_by;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.rrpp_name := (select trim(first_name || ' ' || last_name) from public.employees where id = new.rrpp_id);
  elsif new.rrpp_id is distinct from old.rrpp_id then
    new.rrpp_name := (select trim(first_name || ' ' || last_name) from public.employees where id = new.rrpp_id);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists reservations_defaults on public.reservations;
create trigger reservations_defaults
  before insert or update on public.reservations
  for each row execute function public.reservation_defaults();

alter table public.reservations enable row level security;

drop policy if exists reservations_read on public.reservations;
create policy reservations_read on public.reservations
  for select to authenticated using (public.can_reserve());

drop policy if exists reservations_admin_all on public.reservations;
create policy reservations_admin_all on public.reservations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists reservations_rrpp_insert on public.reservations;
create policy reservations_rrpp_insert on public.reservations
  for insert to authenticated with check (public.is_rrpp() and rrpp_id = public.my_employee_id());

drop policy if exists reservations_rrpp_update on public.reservations;
create policy reservations_rrpp_update on public.reservations
  for update to authenticated
  using (public.is_rrpp() and rrpp_id = public.my_employee_id())
  with check (public.is_rrpp() and rrpp_id = public.my_employee_id());

drop policy if exists reservations_rrpp_delete on public.reservations;
create policy reservations_rrpp_delete on public.reservations
  for delete to authenticated using (public.is_rrpp() and rrpp_id = public.my_employee_id());

revoke execute on function public.is_rrpp()     from public, anon;
revoke execute on function public.can_reserve() from public, anon;
grant  execute on function public.is_rrpp()     to authenticated;
grant  execute on function public.can_reserve() to authenticated;

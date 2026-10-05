-- =====================================================================
--  Comisiones de los RRPP
--  · rrpp_commission_rates: % que se lleva el RRPP de las botellas y de las
--    entradas, distinto para cada día de la semana (lo fija el administrador).
--    weekday: 0 = domingo, 1 = lunes … 6 = sábado (la noche de la reserva).
--  · rrpp_ticket_sales: entradas vendidas por cada RRPP en cada noche.
--  Las botellas vendidas salen de sus reservas (precio de carta; cortesía = 0 €).
-- =====================================================================

create table if not exists public.rrpp_commission_rates (
  id          uuid primary key default gen_random_uuid(),
  weekday     smallint not null unique check (weekday between 0 and 6),
  bottle_pct  numeric(5,2) not null default 0 check (bottle_pct between 0 and 100),
  ticket_pct  numeric(5,2) not null default 0 check (ticket_pct between 0 and 100),
  updated_at  timestamptz not null default now()
);

insert into public.rrpp_commission_rates (weekday)
select d from generate_series(0, 6) as d
on conflict (weekday) do nothing;

drop trigger if exists rrpp_commission_rates_touch on public.rrpp_commission_rates;
create trigger rrpp_commission_rates_touch
  before update on public.rrpp_commission_rates
  for each row execute function public.touch_updated_at();

alter table public.rrpp_commission_rates enable row level security;

drop policy if exists rrpp_commission_rates_read on public.rrpp_commission_rates;
create policy rrpp_commission_rates_read on public.rrpp_commission_rates
  for select to authenticated using (public.can_reserve());

drop policy if exists rrpp_commission_rates_admin_all on public.rrpp_commission_rates;
create policy rrpp_commission_rates_admin_all on public.rrpp_commission_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Entradas vendidas por cada RRPP en cada noche
create table if not exists public.rrpp_ticket_sales (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,                                   -- la noche
  employee_id  uuid not null references public.employees (id) on delete cascade,
  quantity     integer not null default 0 check (quantity >= 0),
  unit_price   numeric(10,2) not null default 0 check (unit_price >= 0),  -- precio de venta de cada entrada
  notes        text,
  created_at   timestamptz not null default now(),
  constraint rrpp_ticket_sales_one_per_night unique (employee_id, date)
);
create index if not exists rrpp_ticket_sales_date_idx on public.rrpp_ticket_sales (date);

alter table public.rrpp_ticket_sales enable row level security;

drop policy if exists rrpp_ticket_sales_admin_all on public.rrpp_ticket_sales;
create policy rrpp_ticket_sales_admin_all on public.rrpp_ticket_sales
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Cada RRPP puede consultar sus propias entradas
drop policy if exists rrpp_ticket_sales_self_select on public.rrpp_ticket_sales;
create policy rrpp_ticket_sales_self_select on public.rrpp_ticket_sales
  for select to authenticated using (employee_id = public.my_employee_id());

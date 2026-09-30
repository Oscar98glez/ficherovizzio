-- =====================================================================
--  Disponibilidad semanal de los trabajadores
--  Una fila por trabajador y día: disponible / no disponible (+ horario y nota opcionales)
-- =====================================================================

create table if not exists public.availability (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  date         date not null,
  available    boolean not null default true,
  start_time   time,
  end_time     time,
  note         text,
  updated_at   timestamptz not null default now(),
  constraint availability_one_per_day unique (employee_id, date)
);
create index if not exists availability_date_idx on public.availability (date);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists availability_touch on public.availability;
create trigger availability_touch
  before update on public.availability
  for each row execute function public.touch_updated_at();

alter table public.availability enable row level security;

-- El administrador ve y gestiona toda la disponibilidad
drop policy if exists availability_admin_all on public.availability;
create policy availability_admin_all on public.availability
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Cada trabajador gestiona únicamente la suya
drop policy if exists availability_self_select on public.availability;
create policy availability_self_select on public.availability
  for select to authenticated using (employee_id = public.my_employee_id());

drop policy if exists availability_self_insert on public.availability;
create policy availability_self_insert on public.availability
  for insert to authenticated with check (employee_id = public.my_employee_id());

drop policy if exists availability_self_update on public.availability;
create policy availability_self_update on public.availability
  for update to authenticated
  using (employee_id = public.my_employee_id())
  with check (employee_id = public.my_employee_id());

drop policy if exists availability_self_delete on public.availability;
create policy availability_self_delete on public.availability
  for delete to authenticated using (employee_id = public.my_employee_id());

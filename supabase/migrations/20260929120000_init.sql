-- =====================================================================
--  Vizzio · Gestión de personal y finanzas
--  Ejecuta este script COMPLETO en Supabase → SQL Editor → New query
--  Es idempotente: puedes volver a ejecutarlo sin perder datos.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  TABLAS
-- ---------------------------------------------------------------------

-- Perfil de acceso a la app (1:1 con auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'worker' check (role in ('admin', 'worker')),
  created_at  timestamptz not null default now()
);

-- Ficha de empleado (recurso humano). Puede existir sin cuenta de usuario.
create table if not exists public.employees (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references auth.users (id) on delete set null,
  first_name     text not null,
  last_name      text not null default '',
  email          text,
  phone          text,
  position       text not null default 'Camarero/a',
  department     text not null default 'barra' check (department in
                   ('direccion','barra','sala','seguridad','cabina','relaciones','taquilla','guardarropa','limpieza')),
  contract_type  text not null default 'fijo' check (contract_type in
                   ('fijo','fijo_discontinuo','temporal','extra','autonomo')),
  hourly_rate    numeric(10,2) not null default 0 check (hourly_rate >= 0),
  hire_date      date,
  active         boolean not null default true,
  color          text not null default '#0071e3',
  notes          text,
  created_at     timestamptz not null default now()
);
create unique index if not exists employees_email_unique on public.employees (lower(email)) where email is not null;

-- Noches / eventos
create table if not exists public.events (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  date                 date not null,
  kind                 text not null default 'sesion' check (kind in ('sesion','evento_privado','concierto','especial')),
  expected_attendance  integer check (expected_attendance >= 0),
  notes                text,
  created_at           timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (date);

-- Fichajes (entrada / salida)
create table if not exists public.time_entries (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees (id) on delete cascade,
  clock_in       timestamptz not null default now(),
  clock_out      timestamptz,
  break_minutes  integer not null default 0 check (break_minutes >= 0),
  hourly_rate    numeric(10,2) not null default 0,   -- tarifa congelada en el momento del fichaje
  event_id       uuid references public.events (id) on delete set null,
  source         text not null default 'app' check (source in ('app','manual')),
  notes          text,
  created_at     timestamptz not null default now(),
  constraint time_entries_out_after_in check (clock_out is null or clock_out > clock_in)
);
create index if not exists time_entries_clock_in_idx on public.time_entries (clock_in);
create index if not exists time_entries_employee_idx on public.time_entries (employee_id, clock_in desc);
create unique index if not exists time_entries_one_open on public.time_entries (employee_id) where clock_out is null;

-- Turnos planificados
create table if not exists public.shifts (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  event_id     uuid references public.events (id) on delete set null,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  position     text,
  status       text not null default 'planned' check (status in ('planned','confirmed','cancelled')),
  notes        text,
  created_at   timestamptz not null default now(),
  constraint shifts_end_after_start check (end_at > start_at)
);
create index if not exists shifts_start_idx on public.shifts (start_at);
create index if not exists shifts_employee_idx on public.shifts (employee_id, start_at);

-- Movimientos económicos (ingresos y gastos)
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  kind         text not null check (kind in ('income','expense')),
  category     text not null,
  amount       numeric(12,2) not null check (amount >= 0),
  method       text not null default 'efectivo' check (method in ('efectivo','tarjeta','transferencia','bizum','otro')),
  description  text,
  event_id     uuid references public.events (id) on delete set null,
  employee_id  uuid references public.employees (id) on delete set null,
  period       text,   -- 'YYYY-MM' para pagos de nómina
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions (date);
create index if not exists transactions_payroll_idx on public.transactions (category, period);

-- Solicitudes de los trabajadores (vacaciones, ausencias, cambios de turno…)
create table if not exists public.leave_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  kind         text not null default 'vacaciones' check (kind in ('vacaciones','ausencia','cambio_turno','baja','otro')),
  start_date   date not null,
  end_date     date not null,
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint leave_requests_dates check (end_date >= start_date)
);

-- ---------------------------------------------------------------------
--  FUNCIONES AUXILIARES
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.employees where user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------
--  ALTA DE USUARIOS
--  · El PRIMER usuario que se registra es administrador.
--  · El resto sólo pueden registrarse si el admin ha creado antes su
--    ficha de empleado con ese email. Se vinculan automáticamente.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_is_first    boolean;
  v_employee_id uuid;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  select id into v_employee_id
  from public.employees
  where lower(email) = lower(new.email) and user_id is null
  limit 1;

  if not v_is_first and v_employee_id is null then
    raise exception 'EMAIL_NOT_AUTHORIZED';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_is_first then 'admin' else 'worker' end
  );

  if v_employee_id is not null then
    update public.employees set user_id = new.id where id = v_employee_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Si el admin crea una ficha con el email de un usuario ya registrado, se vincula sola
create or replace function public.link_employee_user()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if new.user_id is null and new.email is not null then
    select u.id into new.user_id
    from auth.users u
    where lower(u.email) = lower(new.email)
      and not exists (select 1 from public.employees e where e.user_id = u.id and e.id <> new.id)
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_link_user on public.employees;
create trigger employees_link_user
  before insert or update of email on public.employees
  for each row execute function public.link_employee_user();

-- Tarifa por defecto en fichajes manuales
create or replace function public.time_entry_defaults()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.hourly_rate is null or new.hourly_rate = 0 then
    select hourly_rate into new.hourly_rate from public.employees where id = new.employee_id;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_defaults on public.time_entries;
create trigger time_entries_defaults
  before insert on public.time_entries
  for each row execute function public.time_entry_defaults();

-- ---------------------------------------------------------------------
--  FICHAJE DEL TRABAJADOR (hora del servidor, no manipulable)
-- ---------------------------------------------------------------------

create or replace function public.clock_in(p_notes text default null)
returns public.time_entries
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   public.employees;
  v_entry public.time_entries;
begin
  select * into v_emp from public.employees where user_id = auth.uid() and active;
  if v_emp.id is null then
    raise exception 'NO_EMPLOYEE';
  end if;

  if exists (select 1 from public.time_entries where employee_id = v_emp.id and clock_out is null) then
    raise exception 'ALREADY_CLOCKED_IN';
  end if;

  insert into public.time_entries (employee_id, clock_in, hourly_rate, source, notes, event_id)
  values (
    v_emp.id, now(), v_emp.hourly_rate, 'app', p_notes,
    -- la "noche" empieza a las 06:00: una entrada a las 02:00 cuenta para la noche anterior
    (select id from public.events
      where date = ((now() at time zone 'Europe/Madrid') - interval '6 hours')::date
      order by created_at limit 1)
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

create or replace function public.clock_out(p_notes text default null)
returns public.time_entries
language plpgsql security definer set search_path = public
as $$
declare
  v_entry public.time_entries;
begin
  update public.time_entries
     set clock_out = now(),
         notes = coalesce(p_notes, notes)
   where employee_id = public.my_employee_id()
     and clock_out is null
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'NOT_CLOCKED_IN';
  end if;

  return v_entry;
end;
$$;

revoke execute on function public.clock_in(text)  from anon;
revoke execute on function public.clock_out(text) from anon;

-- ---------------------------------------------------------------------
--  SEGURIDAD (Row Level Security)
-- ---------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.employees       enable row level security;
alter table public.events          enable row level security;
alter table public.time_entries    enable row level security;
alter table public.shifts          enable row level security;
alter table public.transactions    enable row level security;
alter table public.leave_requests  enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- employees
drop policy if exists employees_admin_all on public.employees;
create policy employees_admin_all on public.employees
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists employees_self_select on public.employees;
create policy employees_self_select on public.employees
  for select to authenticated using (user_id = auth.uid());

-- events: todos los usuarios ven las noches; sólo el admin las gestiona
drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select to authenticated using (true);
drop policy if exists events_admin_all on public.events;
create policy events_admin_all on public.events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- time_entries: el trabajador sólo ve los suyos y ficha vía clock_in/clock_out
drop policy if exists time_entries_admin_all on public.time_entries;
create policy time_entries_admin_all on public.time_entries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists time_entries_self_select on public.time_entries;
create policy time_entries_self_select on public.time_entries
  for select to authenticated using (employee_id = public.my_employee_id());

-- shifts
drop policy if exists shifts_admin_all on public.shifts;
create policy shifts_admin_all on public.shifts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists shifts_self_select on public.shifts;
create policy shifts_self_select on public.shifts
  for select to authenticated using (employee_id = public.my_employee_id());

-- transactions: sólo admin
drop policy if exists transactions_admin_all on public.transactions;
create policy transactions_admin_all on public.transactions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- leave_requests
drop policy if exists leave_admin_all on public.leave_requests;
create policy leave_admin_all on public.leave_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists leave_self_select on public.leave_requests;
create policy leave_self_select on public.leave_requests
  for select to authenticated using (employee_id = public.my_employee_id());
drop policy if exists leave_self_insert on public.leave_requests;
create policy leave_self_insert on public.leave_requests
  for insert to authenticated with check (employee_id = public.my_employee_id() and status = 'pending');
drop policy if exists leave_self_delete on public.leave_requests;
create policy leave_self_delete on public.leave_requests
  for delete to authenticated using (employee_id = public.my_employee_id() and status = 'pending');

-- =====================================================================
--  Hoja de caja de Administración (como el Excel "MODELO" de los
--  administrativos): por cada noche, los ingresos (efectivo, banco,
--  plataforma, rappel) y los gastos por columnas (personal, servicios,
--  suministros, reparaciones, mercaderías...), y por mes el arrastre de
--  efectivo y de banco del mes anterior y el ajuste.
--  · Las columnas están en la app (src/lib/ledger.ts); aquí se guarda cada
--    día como { columna: importe } en "data" (y los textos de definición).
--  · La ven y la rellenan los administrativos y el administrador.
-- =====================================================================

create or replace function public.can_manage_ledger()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'office'));
$$;

create table if not exists public.admin_ledger_days (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists public.admin_ledger_months (
  id           uuid primary key default gen_random_uuid(),
  month        date not null unique check (extract(day from month) = 1),  -- día 1 del mes
  cash_carry   numeric(12,2),   -- arrastre de efectivo del mes anterior
  bank_carry   numeric(12,2),   -- arrastre de banco del mes anterior
  cash_adjust  numeric(12,2),   -- ajuste del efectivo
  bank_adjust  numeric(12,2),   -- ajuste del banco
  note         text,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table public.admin_ledger_days enable row level security;
alter table public.admin_ledger_months enable row level security;

drop policy if exists admin_ledger_days_all on public.admin_ledger_days;
create policy admin_ledger_days_all on public.admin_ledger_days
  for all to authenticated using (public.can_manage_ledger()) with check (public.can_manage_ledger());

drop policy if exists admin_ledger_months_all on public.admin_ledger_months;
create policy admin_ledger_months_all on public.admin_ledger_months
  for all to authenticated using (public.can_manage_ledger()) with check (public.can_manage_ledger());

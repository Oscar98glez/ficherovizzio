-- =====================================================================
--  Resumen del año de la hoja de caja de Administración (la hoja INICIO
--  del Excel): el reparto del año (importe que se reparte y su % sobre
--  los ingresos). Los totales de cada mes se calculan en la app.
-- =====================================================================

create table if not exists public.admin_ledger_years (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null unique check (year between 2000 and 2100),
  reparto     numeric(12,2),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.admin_ledger_years enable row level security;

drop policy if exists admin_ledger_years_all on public.admin_ledger_years;
create policy admin_ledger_years_all on public.admin_ledger_years
  for all to authenticated using (public.can_manage_ledger()) with check (public.can_manage_ledger());

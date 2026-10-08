-- =====================================================================
--  Integración con Fourvenues (venta de entradas online)
--  La función supabase/functions/fourvenues-sync trae de Fourvenues:
--  · Noches: cada evento de Fourvenues crea (o se asocia a) su noche.
--  · Ingresos: lo vendido online en cada noche, como un movimiento de
--    "Entradas online" que se actualiza en cada sincronización.
--  · Comisiones RRPP: las entradas que vende cada RRPP con su enlace pasan a
--    rrpp_ticket_sales (el RRPP de Fourvenues se asocia a su ficha de Personal).
--  Lo importado lleva el id de Fourvenues: sincronizar varias veces no duplica.
--  La clave de la API nunca llega al navegador (es un secreto de la función).
-- =====================================================================

-- ---------- Noches ----------
alter table public.events
  add column if not exists fourvenues_id         text unique,
  -- Personas con entrada (sin canceladas ni devueltas) y cuántas han entrado ya
  add column if not exists tickets_sold          integer check (tickets_sold >= 0),
  add column if not exists tickets_entered       integer check (tickets_entered >= 0),
  add column if not exists fourvenues_synced_at  timestamptz;

-- ---------- Movimientos importados ----------
-- "fourvenues:entradas:<id del evento>": uno por noche, se actualiza en cada sincronización
alter table public.transactions
  add column if not exists external_id text unique;

-- ---------- RRPP ----------
-- Usuario de Fourvenues (el "referral" de sus entradas) que corresponde a cada ficha
alter table public.employees
  add column if not exists fourvenues_user_id text unique;

-- Filas de entradas rellenadas por la sincronización (las personas de lista siguen siendo a mano)
alter table public.rrpp_ticket_sales
  add column if not exists fourvenues_synced_at timestamptz;

-- ---------- Estado de la sincronización ----------
create table if not exists public.fourvenues_sync (
  id             smallint primary key default 1 check (id = 1),
  -- Sincronización en curso (evita que se lancen dos a la vez)
  running_since  timestamptz,
  last_run_at    timestamptz,
  last_ok_at     timestamptz,
  last_error     text,
  -- Resumen de la última: noches creadas, ingresos, RRPP sin asociar...
  last_result    jsonb
);

insert into public.fourvenues_sync (id) values (1) on conflict (id) do nothing;

alter table public.fourvenues_sync enable row level security;

-- Sólo la consultan los administradores; la escribe la función (con la clave de servicio)
drop policy if exists fourvenues_sync_admin_select on public.fourvenues_sync;
create policy fourvenues_sync_admin_select on public.fourvenues_sync
  for select to authenticated using (public.is_admin());

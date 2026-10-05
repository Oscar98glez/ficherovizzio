-- =====================================================================
--  Comisiones propias de cada RRPP y entradas de lista
--  · En la ficha del RRPP: % de botellas, % de entradas y € por persona de lista.
--    Si se dejan vacíos, se usa lo fijado para ese día de la semana.
--  · Por día de la semana: además de los %, el € por persona de lista.
--  · Por noche: personas que entran por la lista de cada RRPP.
-- =====================================================================

alter table public.employees
  add column if not exists rrpp_bottle_pct numeric(5,2) check (rrpp_bottle_pct between 0 and 100),
  add column if not exists rrpp_ticket_pct numeric(5,2) check (rrpp_ticket_pct between 0 and 100),
  add column if not exists rrpp_list_fee   numeric(10,2) check (rrpp_list_fee >= 0);

alter table public.rrpp_commission_rates
  add column if not exists list_fee numeric(10,2) not null default 0 check (list_fee >= 0);

alter table public.rrpp_ticket_sales
  add column if not exists list_quantity integer not null default 0 check (list_quantity >= 0);

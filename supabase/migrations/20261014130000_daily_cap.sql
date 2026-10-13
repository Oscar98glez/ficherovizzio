-- =====================================================================
--  Máximo por noche: hay quien cobra por horas pero con un tope por noche trabajada
--  (p. ej. 10 €/h y como mucho 40 € la noche).
--  · employees.daily_cap: el tope de la ficha (null: sin tope).
--  · time_entries.max_amount: el tope de ese fichaje (se copia de la ficha al crearlo, como la tarifa).
--    Lo ganado en el fichaje es min(horas × tarifa, max_amount).
-- =====================================================================

alter table public.employees add column if not exists daily_cap numeric(10,2) check (daily_cap >= 0);
alter table public.time_entries add column if not exists max_amount numeric(10,2) check (max_amount >= 0);

-- Los fichajes nuevos (desde el móvil, manuales o desde la hoja de firmas) toman el tope de la ficha
create or replace function public.time_entry_daily_cap()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.max_amount is null then
    select daily_cap into new.max_amount from public.employees where id = new.employee_id;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_daily_cap on public.time_entries;
create trigger time_entries_daily_cap
  before insert on public.time_entries
  for each row execute function public.time_entry_daily_cap();

-- Lo ganado que ve el propio trabajador, con el tope (sólo cambia la expresión de "earned")
create or replace view public.my_time_entries as
  select id, employee_id, clock_in, clock_out, break_minutes, event_id, source, notes, created_at,
         case
           when clock_out is not null then
             round(
               (case
                  when max_amount is null then
                    greatest(0, extract(epoch from (clock_out - clock_in)) / 3600.0 - coalesce(break_minutes, 0) / 60.0) * coalesce(hourly_rate, 0)
                  else least(
                    greatest(0, extract(epoch from (clock_out - clock_in)) / 3600.0 - coalesce(break_minutes, 0) / 60.0) * coalesce(hourly_rate, 0),
                    max_amount)
                end)::numeric,
               2)
         end as earned
  from public.time_entries
  where employee_id = public.my_employee_id();

revoke all on public.my_time_entries from anon, public;
grant select on public.my_time_entries to authenticated;

-- Guillepo: 10 €/h con un máximo de 40 € por noche (también en sus fichajes ya hechos)
update public.employees set hourly_rate = 10, daily_cap = 40 where id = '03c1062d-3085-4ea2-9189-5f2bfabcc74f';
update public.time_entries set hourly_rate = 10, max_amount = 40 where employee_id = '03c1062d-3085-4ea2-9189-5f2bfabcc74f';

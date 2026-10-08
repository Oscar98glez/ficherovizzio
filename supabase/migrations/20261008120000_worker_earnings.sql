-- =====================================================================
--  Lo ganado por cada fichaje, visible para el propio trabajador
--  El importe (horas × tarifa) se calcula aquí; la tarifa €/h sigue sin
--  salir de la base de datos para los trabajadores.
-- =====================================================================

-- Sólo se añade una columna al final: el resto de la vista no cambia
create or replace view public.my_time_entries as
  select id, employee_id, clock_in, clock_out, break_minutes, event_id, source, notes, created_at,
         -- Fichajes cerrados: horas (menos la pausa) × tarifa aplicada. Abiertos: aún sin importe
         case
           when clock_out is not null then
             round(
               (greatest(0, extract(epoch from (clock_out - clock_in)) / 3600.0 - coalesce(break_minutes, 0) / 60.0)
                 * coalesce(hourly_rate, 0))::numeric,
               2)
         end as earned
  from public.time_entries
  where employee_id = public.my_employee_id();

revoke all on public.my_time_entries from anon, public;
grant select on public.my_time_entries to authenticated;

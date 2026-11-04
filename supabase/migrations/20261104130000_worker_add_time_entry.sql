-- =====================================================================
--  Los camareros (de barra y de bandeja) pueden añadir el fichaje de una
--  noche en la que se les olvidó fichar, desde Mis horas.
--  · Las mismas reglas que al corregir: de los últimos 3 días, no en el
--    futuro, la salida después de la entrada, como mucho 14 h y sin pisarse
--    con otro fichaje suyo.
--  · Se guarda con su tarifa (y su tope por noche) como al fichar, en la
--    noche que toca, y marcado como añadido por el trabajador
--    (added_by_worker), para que el administrador lo vea.
-- =====================================================================

alter table public.time_entries
  add column if not exists added_by_worker boolean not null default false;

create or replace function public.add_my_time_entry(p_clock_in timestamptz, p_clock_out timestamptz)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_emp  public.employees;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('worker', 'tray') then
    raise exception 'CORRECTION_NOT_ALLOWED';
  end if;
  select * into v_emp from public.employees where user_id = auth.uid() and active;
  if v_emp.id is null then
    raise exception 'NO_EMPLOYEE';
  end if;

  if p_clock_in is null or p_clock_out is null then
    raise exception 'CORRECTION_NEEDS_OUT';
  end if;
  if p_clock_in < now() - interval '3 days' then
    raise exception 'CORRECTION_TOO_LATE';
  end if;
  if p_clock_in > now() + interval '5 minutes' or p_clock_out > now() + interval '5 minutes' then
    raise exception 'CORRECTION_FUTURE';
  end if;
  if p_clock_out <= p_clock_in then
    raise exception 'CORRECTION_ORDER';
  end if;
  if p_clock_out - p_clock_in > interval '14 hours' then
    raise exception 'CORRECTION_TOO_LONG';
  end if;
  if exists (
    select 1 from public.time_entries t
     where t.employee_id = v_emp.id
       and tstzrange(t.clock_in, coalesce(t.clock_out, 'infinity')) && tstzrange(p_clock_in, p_clock_out)
  ) then
    raise exception 'CORRECTION_OVERLAP';
  end if;

  insert into public.time_entries (employee_id, clock_in, clock_out, hourly_rate, source, notes, event_id, added_by_worker)
  values (
    v_emp.id, p_clock_in, p_clock_out, v_emp.hourly_rate, 'manual', 'Añadido por el trabajador (se le olvidó fichar)',
    (select id from public.events where date = public.business_date(p_clock_in) order by created_at limit 1),
    true
  );
end;
$$;

revoke execute on function public.add_my_time_entry(timestamptz, timestamptz) from public, anon;
grant execute on function public.add_my_time_entry(timestamptz, timestamptz) to authenticated;

-- El trabajador ve también si el fichaje lo añadió él (la columna nueva va al final)
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
         end as earned,
         original_clock_in, original_clock_out, corrected_at,
         added_by_worker
  from public.time_entries
  where employee_id = public.my_employee_id();

revoke all on public.my_time_entries from anon, public;
grant select on public.my_time_entries to authenticated;

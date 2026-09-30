-- =====================================================================
--  Turnos: sólo se indica la hora de entrada.
--  La hora de salida se rellena sola con el fichaje de salida del empleado.
-- =====================================================================

-- La salida pasa a ser opcional (la restricción end_at > start_at sigue valiendo cuando existe)
alter table public.shifts alter column end_at drop not null;

-- Noche (día de negocio, de 06:00 a 06:00 hora de Madrid) a la que pertenece un instante
create or replace function public.business_date(ts timestamptz)
returns date
language sql stable
as $$
  select ((ts at time zone 'Europe/Madrid') - interval '6 hours')::date;
$$;

-- Al fichar la salida (desde la app o con un fichaje manual) se copia al turno de esa noche
create or replace function public.sync_shift_end_from_entry()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.clock_out is not null
     and (tg_op = 'INSERT' or new.clock_out is distinct from old.clock_out) then
    update public.shifts s
       set end_at = new.clock_out
     where s.employee_id = new.employee_id
       and s.status <> 'cancelled'
       and public.business_date(s.start_at) = public.business_date(new.clock_in)
       and new.clock_out > s.start_at;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_sync_shift_end on public.time_entries;
create trigger time_entries_sync_shift_end
  after insert or update of clock_out on public.time_entries
  for each row execute function public.sync_shift_end_from_entry();

-- Si se crea un turno de una noche que ya se ha fichado, toma la salida del fichaje
create or replace function public.fill_shift_end_from_entry()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.end_at is null then
    select te.clock_out into new.end_at
      from public.time_entries te
     where te.employee_id = new.employee_id
       and te.clock_out is not null
       and public.business_date(te.clock_in) = public.business_date(new.start_at)
       and te.clock_out > new.start_at
     order by te.clock_out desc
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_fill_end on public.shifts;
create trigger shifts_fill_end
  before insert on public.shifts
  for each row execute function public.fill_shift_end_from_entry();

-- Los turnos futuros aún no trabajados se quedan sin salida (se rellenará al fichar)
update public.shifts
   set end_at = null
 where start_at > now();

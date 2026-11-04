-- =====================================================================
--  1) Los camareros (de barra y de bandeja) pueden corregir la hora de
--     entrada y de salida de sus fichajes, por si se les olvida fichar y lo
--     hacen más tarde (o se les olvida fichar la salida).
--     · Sólo sus fichajes de los últimos 3 días, y con horas razonables:
--       no en el futuro, la salida después de la entrada, como mucho 14 h
--       de turno y como mucho 12 h de diferencia con lo que ficharon.
--     · Se guarda lo que ficharon al principio (original_clock_in/out) y
--       cuándo lo corrigieron (corrected_at), para que el administrador lo vea.
--  2) Embajadoras: 10 €/h con un máximo de 20 € por turno.
--     · Sus fichas y sus fichajes (también los ya hechos: estaban a 0 €).
--     · Las fichas nuevas de embajadoras (al registrarse o al crearlas) y
--       los extras de la sección EMBAJADORAS de los sobres, igual.
-- =====================================================================

-- ---------- 1) Correcciones de los camareros ----------
alter table public.time_entries
  add column if not exists original_clock_in  timestamptz,
  add column if not exists original_clock_out timestamptz,
  add column if not exists corrected_at       timestamptz;

create or replace function public.correct_my_time_entry(p_id uuid, p_clock_in timestamptz, p_clock_out timestamptz)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role  text;
  v_entry public.time_entries;
  v_first timestamptz;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('worker', 'tray') then
    raise exception 'CORRECTION_NOT_ALLOWED';
  end if;

  select * into v_entry from public.time_entries where id = p_id and employee_id = public.my_employee_id() for update;
  if v_entry.id is null then
    raise exception 'CORRECTION_NOT_FOUND';
  end if;

  v_first := coalesce(v_entry.original_clock_in, v_entry.clock_in);
  if v_first < now() - interval '3 days' then
    raise exception 'CORRECTION_TOO_LATE';
  end if;
  if p_clock_in is null or p_clock_in > now() + interval '5 minutes' or (p_clock_out is not null and p_clock_out > now() + interval '5 minutes') then
    raise exception 'CORRECTION_FUTURE';
  end if;
  if v_entry.clock_out is not null and p_clock_out is null then
    raise exception 'CORRECTION_NEEDS_OUT';
  end if;
  if p_clock_out is not null and p_clock_out <= p_clock_in then
    raise exception 'CORRECTION_ORDER';
  end if;
  if p_clock_out is not null and p_clock_out - p_clock_in > interval '14 hours' then
    raise exception 'CORRECTION_TOO_LONG';
  end if;
  if abs(extract(epoch from (p_clock_in - v_first))) > 12 * 3600 then
    raise exception 'CORRECTION_TOO_FAR';
  end if;
  if exists (
    select 1 from public.time_entries t
     where t.employee_id = v_entry.employee_id
       and t.id <> v_entry.id
       and tstzrange(t.clock_in, coalesce(t.clock_out, 'infinity')) && tstzrange(p_clock_in, coalesce(p_clock_out, 'infinity'))
  ) then
    raise exception 'CORRECTION_OVERLAP';
  end if;

  update public.time_entries
     set original_clock_in  = coalesce(original_clock_in, clock_in),
         original_clock_out = case when corrected_at is null then clock_out else original_clock_out end,
         clock_in     = p_clock_in,
         clock_out    = p_clock_out,
         corrected_at = now()
   where id = v_entry.id;
end;
$$;

revoke execute on function public.correct_my_time_entry(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.correct_my_time_entry(uuid, timestamptz, timestamptz) to authenticated;

-- El trabajador ve en sus fichajes si los ha corregido (las columnas nuevas van al final)
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
         original_clock_in, original_clock_out, corrected_at
  from public.time_entries
  where employee_id = public.my_employee_id();

revoke all on public.my_time_entries from anon, public;
grant select on public.my_time_entries to authenticated;

-- ---------- 2) Embajadoras: 10 €/h, máximo 20 € por turno ----------
update public.employees e
   set hourly_rate = 10, daily_cap = 20
 where e.department = 'embajadoras'
    or exists (select 1 from public.profiles p where p.id = e.user_id and p.role = 'ambassador');

update public.time_entries t
   set hourly_rate = 10, max_amount = 20
  from public.employees e
 where e.id = t.employee_id
   and e.hourly_rate = 10 and e.daily_cap = 20
   and (e.department = 'embajadoras' or exists (select 1 from public.profiles p where p.id = e.user_id and p.role = 'ambassador'));

-- Fichas nuevas de embajadoras (o que pasan a serlo) sin precio: 10 €/h y 20 € como mucho
create or replace function public.ambassador_default_rate()
returns trigger
language plpgsql
as $$
begin
  if new.department = 'embajadoras'
     and (tg_op = 'INSERT' or old.department is distinct from 'embajadoras')
     and coalesce(new.hourly_rate, 0) = 0 then
    new.hourly_rate := 10;
    new.daily_cap := coalesce(new.daily_cap, 20);
  end if;
  return new;
end;
$$;

drop trigger if exists employees_ambassador_rate on public.employees;
create trigger employees_ambassador_rate
  before insert or update of department on public.employees
  for each row execute function public.ambassador_default_rate();

-- Extras de los sobres en EMBAJADORAS: el mismo precio y el mismo máximo por noche
alter table public.wage_extras
  add column if not exists max_amount numeric(10,2) check (max_amount >= 0);

create or replace function public.wage_extra_ambassador_rate()
returns trigger
language plpgsql
as $$
begin
  if new.section = 'embajadoras' and new.amount is null then
    if coalesce(new.rate, 0) = 0 then
      new.rate := 10;
    end if;
    if tg_op = 'INSERT' and new.max_amount is null then
      new.max_amount := 20;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists wage_extras_ambassador_rate on public.wage_extras;
create trigger wage_extras_ambassador_rate
  before insert on public.wage_extras
  for each row execute function public.wage_extra_ambassador_rate();

update public.wage_extras
   set rate = case when rate = 0 then 10 else rate end,
       max_amount = coalesce(max_amount, 20)
 where section = 'embajadoras' and amount is null;

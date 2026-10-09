-- =====================================================================
--  Ubicación de los fichajes
--  Al fichar desde la app se guarda dónde está el trabajador (GPS del móvil)
--  y a qué distancia del local. Si el administrador lo activa, no se puede
--  fichar la entrada fuera del local. La salida nunca se bloquea (para que
--  nadie se quede con el fichaje abierto), pero queda marcada si es fuera.
-- =====================================================================

-- ---------- Ubicación del local (una sola fila) ----------
create table if not exists public.venue_location (
  id          boolean primary key default true check (id),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  -- Distancia máxima al local para contar como "en el local"
  radius_m    integer not null default 150 check (radius_m between 20 and 5000),
  -- true: no se puede fichar la entrada fuera del local ni sin ubicación
  enforce     boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.venue_location enable row level security;

drop policy if exists venue_location_admin_all on public.venue_location;
create policy venue_location_admin_all on public.venue_location
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Dónde se ha fichado ----------
alter table public.time_entries
  add column if not exists clock_in_lat        double precision,
  add column if not exists clock_in_lng        double precision,
  -- Precisión del GPS en metros
  add column if not exists clock_in_accuracy   real,
  -- Metros hasta el local (null: sin ubicación del local o sin ubicación del fichaje)
  add column if not exists clock_in_distance   integer,
  add column if not exists clock_in_outside    boolean,
  add column if not exists clock_out_lat       double precision,
  add column if not exists clock_out_lng       double precision,
  add column if not exists clock_out_accuracy  real,
  add column if not exists clock_out_distance  integer,
  add column if not exists clock_out_outside   boolean;

-- Distancia en metros entre dos puntos (fórmula del haversine)
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Comprueba una ubicación contra la del local: distancia y si está fuera.
-- Se da margen por la precisión del GPS (hasta 150 m), que dentro de un local suele ser peor.
create or replace function public.check_clock_location(p_lat double precision, p_lng double precision, p_accuracy double precision)
returns table (distance integer, outside boolean, enforce boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_venue public.venue_location;
  v_dist  double precision;
begin
  if (p_lat is null) <> (p_lng is null)
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'BAD_LOCATION';
  end if;

  select * into v_venue from public.venue_location where id;
  if v_venue.id is null or p_lat is null then
    return query select null::integer, null::boolean, coalesce(v_venue.enforce, false);
    return;
  end if;

  v_dist := public.distance_m(v_venue.lat, v_venue.lng, p_lat, p_lng);
  return query select
    round(v_dist)::integer,
    v_dist - least(greatest(coalesce(p_accuracy, 0), 0), 150) > v_venue.radius_m,
    v_venue.enforce;
end;
$$;

revoke execute on function public.check_clock_location(double precision, double precision, double precision) from public, anon, authenticated;

-- ---------- Fichar entrada / salida con la ubicación ----------
drop function if exists public.clock_in(text);
drop function if exists public.clock_in(text, double precision, double precision, double precision);
create function public.clock_in(
  p_notes    text default null,
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   public.employees;
  v_entry public.time_entries;
  v_loc   record;
begin
  select * into v_emp from public.employees where user_id = auth.uid() and active;
  if v_emp.id is null then
    raise exception 'NO_EMPLOYEE';
  end if;

  if exists (select 1 from public.time_entries where employee_id = v_emp.id and clock_out is null) then
    raise exception 'ALREADY_CLOCKED_IN';
  end if;

  select * into v_loc from public.check_clock_location(p_lat, p_lng, p_accuracy);
  if v_loc.enforce then
    if p_lat is null then
      raise exception 'LOCATION_REQUIRED';
    end if;
    if v_loc.outside then
      raise exception 'OUTSIDE_VENUE:%', v_loc.distance;
    end if;
  end if;

  insert into public.time_entries (
    employee_id, clock_in, hourly_rate, source, notes, event_id,
    clock_in_lat, clock_in_lng, clock_in_accuracy, clock_in_distance, clock_in_outside
  )
  values (
    v_emp.id, now(), v_emp.hourly_rate, 'app', p_notes,
    (select id from public.events
      where date = ((now() at time zone 'Europe/Madrid') - interval '6 hours')::date
      order by created_at limit 1),
    p_lat, p_lng, p_accuracy, v_loc.distance, v_loc.outside
  )
  returning * into v_entry;

  return to_jsonb(v_entry) - 'hourly_rate';
end;
$$;

drop function if exists public.clock_out(text);
drop function if exists public.clock_out(text, double precision, double precision, double precision);
create function public.clock_out(
  p_notes    text default null,
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_entry public.time_entries;
  v_loc   record;
begin
  select * into v_loc from public.check_clock_location(p_lat, p_lng, p_accuracy);

  update public.time_entries
     set clock_out = now(),
         notes = coalesce(p_notes, notes),
         clock_out_lat = p_lat,
         clock_out_lng = p_lng,
         clock_out_accuracy = p_accuracy,
         clock_out_distance = v_loc.distance,
         clock_out_outside = v_loc.outside
   where employee_id = public.my_employee_id()
     and clock_out is null
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'NOT_CLOCKED_IN';
  end if;

  return to_jsonb(v_entry) - 'hourly_rate';
end;
$$;

revoke execute on function public.clock_in(text, double precision, double precision, double precision)  from public, anon;
revoke execute on function public.clock_out(text, double precision, double precision, double precision) from public, anon;
grant  execute on function public.clock_in(text, double precision, double precision, double precision)  to authenticated;
grant  execute on function public.clock_out(text, double precision, double precision, double precision) to authenticated;

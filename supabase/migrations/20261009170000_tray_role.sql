-- =====================================================================
--  Camareros de bandeja ('tray')
--  · Los camareros se separan en dos tipos: de barra ('worker') y de
--    bandeja ('tray'). Los de bandeja hacen lo mismo que los de barra
--    (fichar, horas, turnos, disponibilidad...) y además ven los reservados
--    de cada noche (sin poder cambiarlos).
--  · Cuando se apunta un reservado, les llega un aviso al móvil.
--  · Se puede elegir al registrarse; su ficha se crea en Sala.
--  · Los camareros que ya tienen la ficha en Sala pasan a ser de bandeja.
-- =====================================================================

-- ---------- Rol ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'worker', 'rrpp', 'tech', 'tray'));

update public.profiles p
   set role = 'tray'
  from public.employees e
 where e.user_id = p.id
   and p.role = 'worker'
   and e.department = 'sala';

-- ---------- Ver los reservados (los de bandeja, sólo leer) ----------
create or replace function public.can_reserve()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'rrpp', 'tray'));
$$;

-- ---------- Registro ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_is_first    boolean;
  v_employee_id uuid;
  v_name        text;
  v_first       text;
  v_last        text;
  v_role        text;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  select id into v_employee_id
  from public.employees
  where lower(email) = lower(new.email) and user_id is null
  limit 1;

  v_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  v_role := case
    when v_is_first then 'admin'
    when new.raw_user_meta_data ->> 'role' in ('rrpp', 'tech', 'tray') then new.raw_user_meta_data ->> 'role'
    else 'worker'
  end;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, v_name, v_role);

  if v_employee_id is not null then
    update public.employees set user_id = new.id where id = v_employee_id;
  elsif not v_is_first
        and not exists (select 1 from public.employees where lower(email) = lower(new.email)) then
    if v_name = '' then
      v_name := split_part(new.email, '@', 1);
    end if;
    v_first := split_part(v_name, ' ', 1);
    v_last  := trim(substr(v_name, length(v_first) + 1));

    insert into public.employees (user_id, first_name, last_name, email, position, department, contract_type, hourly_rate, active)
    values (
      new.id, v_first, v_last, lower(new.email),
      case v_role when 'rrpp' then 'Relaciones públicas' when 'tech' then 'DJ / Técnico' when 'tray' then 'Camarero/a de bandeja' else 'Camarero/a' end,
      case v_role when 'rrpp' then 'relaciones' when 'tech' then 'cabina' when 'tray' then 'sala' else 'barra' end,
      'extra', 0, true
    );
  end if;

  return new;
end;
$$;

-- Al entrar sin ficha se crea igual que al registrarse (también para los de bandeja)
create or replace function public.link_my_employee()
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
  v_role  text;
  v_name  text;
  v_first text;
  v_last  text;
  v_id    uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  select id into v_id from public.employees where user_id = auth.uid() limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select u.email, p.role, trim(coalesce(p.full_name, ''))
    into v_email, v_role, v_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = auth.uid();
  if v_email is null or v_role is null or v_role = 'admin' then
    return null;
  end if;

  update public.employees
     set user_id = auth.uid()
   where id = (
     select id from public.employees
      where user_id is null and lower(email) = lower(v_email)
      order by active desc, created_at desc
      limit 1
   )
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  if exists (select 1 from public.employees where lower(email) = lower(v_email)) then
    return null;
  end if;

  if v_name = '' then
    v_name := split_part(v_email, '@', 1);
  end if;
  v_first := split_part(v_name, ' ', 1);
  v_last  := trim(substr(v_name, length(v_first) + 1));

  insert into public.employees (user_id, first_name, last_name, email, position, department, contract_type, hourly_rate, active)
  values (
    auth.uid(), v_first, v_last, lower(v_email),
    case v_role when 'rrpp' then 'Relaciones públicas' when 'tech' then 'DJ / Técnico' when 'tray' then 'Camarero/a de bandeja' else 'Camarero/a' end,
    case v_role when 'rrpp' then 'relaciones' when 'tech' then 'cabina' when 'tray' then 'sala' else 'barra' end,
    'extra', 0, true
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- Aviso a los de bandeja al apuntar un reservado ----------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('shift_new', 'shift_changed', 'shift_cancelled', 'message', 'task', 'reply', 'reservation_new'));

create or replace function public.notify_reservation_new()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_table text;
begin
  -- Sólo las de esta noche en adelante y que no se apuntan ya canceladas
  if new.status in ('cancelled', 'no_show')
     or new.date < ((now() at time zone 'Europe/Madrid') - interval '6 hours')::date then
    return new;
  end if;
  select trim(concat_ws(' · ', name, nullif(zone, ''))) into v_table from public.vip_tables where id = new.table_id;

  insert into public.notifications (employee_id, kind, ref_id, data)
  select e.id, 'reservation_new', new.id,
         jsonb_build_object(
           'date', new.date,
           'table', v_table,
           'guests', new.guests,
           'arrival', to_char(new.arrival_time, 'HH24:MI'),
           'customer', new.customer_name
         )
    from public.employees e
    join public.profiles p on p.id = e.user_id
   where p.role = 'tray' and e.active;
  return new;
end;
$$;

drop trigger if exists reservations_notify_tray on public.reservations;
create trigger reservations_notify_tray
  after insert on public.reservations
  for each row execute function public.notify_reservation_new();

-- =====================================================================
--  Embajadoras ('ambassador')
--  · Nuevo tipo de trabajador. Hacen lo mismo que los camareros de barra
--    (fichar, horas, turnos, disponibilidad...).
--  · Se puede elegir al registrarse; su ficha se crea en el departamento
--    nuevo "Embajadoras" con el puesto "Embajador/a".
--  · En los sobres de Sueldos van en la sección EMBAJADORAS.
-- =====================================================================

-- ---------- Rol ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'worker', 'rrpp', 'tech', 'tray', 'ambassador'));

-- ---------- Departamento ----------
alter table public.employees drop constraint if exists employees_department_check;
alter table public.employees add constraint employees_department_check
  check (department in ('direccion', 'barra', 'sala', 'seguridad', 'cabina', 'relaciones', 'embajadoras', 'taquilla', 'guardarropa', 'limpieza'));

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
    when new.raw_user_meta_data ->> 'role' in ('rrpp', 'tech', 'tray', 'ambassador') then new.raw_user_meta_data ->> 'role'
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
      case v_role when 'rrpp' then 'Relaciones públicas' when 'tech' then 'DJ / Técnico' when 'tray' then 'Camarero/a de bandeja' when 'ambassador' then 'Embajador/a' else 'Camarero/a' end,
      case v_role when 'rrpp' then 'relaciones' when 'tech' then 'cabina' when 'tray' then 'sala' when 'ambassador' then 'embajadoras' else 'barra' end,
      'extra', 0, true
    );
  end if;

  return new;
end;
$$;

-- Al entrar sin ficha se crea igual que al registrarse (también para las embajadoras)
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
    case v_role when 'rrpp' then 'Relaciones públicas' when 'tech' then 'DJ / Técnico' when 'tray' then 'Camarero/a de bandeja' when 'ambassador' then 'Embajador/a' else 'Camarero/a' end,
    case v_role when 'rrpp' then 'relaciones' when 'tech' then 'cabina' when 'tray' then 'sala' when 'ambassador' then 'embajadoras' else 'barra' end,
    'extra', 0, true
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- =====================================================================
--  Vincular la cuenta con su ficha al entrar (y crearla si no hay)
--  Como al registrarse: si la cuenta no tiene ficha, se vincula con la ficha
--  sin cuenta que tenga su mismo email; si no hay ninguna ficha con ese email,
--  se le crea una según su rol (Camarero/a, DJ / Técnico o RRPP) con tarifa
--  0 €/h, que en Personal sale como "falta tarifa" para que se complete.
--  Los administradores no se tocan.
-- =====================================================================

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

  -- Una ficha sin cuenta con su email
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

  -- Si ya hay una ficha con ese email (de otra cuenta), no se crea otra
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
    case v_role when 'rrpp' then 'Relaciones públicas' when 'tech' then 'DJ / Técnico' else 'Camarero/a' end,
    case v_role when 'rrpp' then 'relaciones' when 'tech' then 'cabina' else 'barra' end,
    'extra', 0, true
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.link_my_employee() from public, anon;
grant  execute on function public.link_my_employee() to authenticated;

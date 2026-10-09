-- =====================================================================
--  Vincular la cuenta con su ficha al entrar
--  Si un usuario ya registrado se queda sin ficha vinculada (p. ej. la ficha
--  se borró y se volvió a crear, o se le cambió el email después), al entrar
--  en la app se vincula solo con la ficha sin cuenta que tenga su mismo email.
-- =====================================================================

create or replace function public.link_my_employee()
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
  v_id    uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  select id into v_id from public.employees where user_id = auth.uid() limit 1;
  if v_id is not null then
    return v_id;
  end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
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
  return v_id;
end;
$$;

revoke execute on function public.link_my_employee() from public, anon;
grant  execute on function public.link_my_employee() to authenticated;

-- =====================================================================
--  Registro abierto para trabajadores
--  · El primer usuario sigue siendo administrador.
--  · Si el email ya está en una ficha de empleado, se vincula a ella.
--  · Si no, se crea automáticamente una ficha de Camarero/a (tarifa 0 €/h,
--    que el administrador ajusta después) y la cuenta entra como trabajador.
-- =====================================================================

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
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  select id into v_employee_id
  from public.employees
  where lower(email) = lower(new.email) and user_id is null
  limit 1;

  v_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, v_name, case when v_is_first then 'admin' else 'worker' end);

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
    values (new.id, v_first, v_last, lower(new.email), 'Camarero/a', 'barra', 'extra', 0, true);
  end if;

  return new;
end;
$$;

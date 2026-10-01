-- =====================================================================
--  1) La tarifa (€/h) sólo la ven los administradores
--     Los trabajadores dejan de leer las tablas "employees" y "time_entries"
--     directamente y usan dos vistas sin la tarifa, limitadas a sus datos.
--  2) Foto de perfil de cada empleado (almacenamiento "avatars")
-- =====================================================================

-- ---------- 2) Foto ----------
alter table public.employees add column if not exists photo_url text;

-- ---------- 1) Tarifa privada ----------
drop policy if exists employees_self_select on public.employees;
drop policy if exists time_entries_self_select on public.time_entries;

-- Ficha propia del trabajador, sin tarifa ni notas internas del administrador
create or replace view public.my_employee as
  select id, user_id, first_name, last_name, email, phone, position, department,
         contract_type, hire_date, active, color, photo_url, created_at
  from public.employees
  where user_id = auth.uid();

-- Fichajes propios del trabajador, sin la tarifa aplicada
create or replace view public.my_time_entries as
  select id, employee_id, clock_in, clock_out, break_minutes, event_id, source, notes, created_at
  from public.time_entries
  where employee_id = public.my_employee_id();

revoke all on public.my_employee, public.my_time_entries from anon, public;
grant select on public.my_employee, public.my_time_entries to authenticated;

-- Fichar entrada / salida: devuelven el fichaje sin la tarifa
drop function if exists public.clock_in(text);
create function public.clock_in(p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   public.employees;
  v_entry public.time_entries;
begin
  select * into v_emp from public.employees where user_id = auth.uid() and active;
  if v_emp.id is null then
    raise exception 'NO_EMPLOYEE';
  end if;

  if exists (select 1 from public.time_entries where employee_id = v_emp.id and clock_out is null) then
    raise exception 'ALREADY_CLOCKED_IN';
  end if;

  insert into public.time_entries (employee_id, clock_in, hourly_rate, source, notes, event_id)
  values (
    v_emp.id, now(), v_emp.hourly_rate, 'app', p_notes,
    (select id from public.events
      where date = ((now() at time zone 'Europe/Madrid') - interval '6 hours')::date
      order by created_at limit 1)
  )
  returning * into v_entry;

  return to_jsonb(v_entry) - 'hourly_rate';
end;
$$;

drop function if exists public.clock_out(text);
create function public.clock_out(p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_entry public.time_entries;
begin
  update public.time_entries
     set clock_out = now(),
         notes = coalesce(p_notes, notes)
   where employee_id = public.my_employee_id()
     and clock_out is null
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'NOT_CLOCKED_IN';
  end if;

  return to_jsonb(v_entry) - 'hourly_rate';
end;
$$;

revoke execute on function public.clock_in(text)  from public, anon;
revoke execute on function public.clock_out(text) from public, anon;
grant  execute on function public.clock_in(text)  to authenticated;
grant  execute on function public.clock_out(text) to authenticated;

-- ---------- 2) Foto: almacenamiento y permisos ----------
-- Carpeta pública de fotos (los nombres de archivo son aleatorios). Máx. 5 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cada trabajador gestiona su carpeta (avatars/<id de empleado>/...); el administrador, todas
drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects
  for select to authenticated using (bucket_id = 'avatars');

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars'
    and (public.is_admin() or (storage.foldername(name))[1] = public.my_employee_id()::text)
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (public.is_admin() or (storage.foldername(name))[1] = public.my_employee_id()::text))
  with check (bucket_id = 'avatars' and (public.is_admin() or (storage.foldername(name))[1] = public.my_employee_id()::text));

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars'
    and (public.is_admin() or (storage.foldername(name))[1] = public.my_employee_id()::text)
  );

-- El trabajador sólo puede cambiar su propia foto (no el resto de su ficha)
create or replace function public.set_my_photo(p_url text)
returns void
language sql security definer set search_path = public
as $$
  update public.employees set photo_url = p_url where user_id = auth.uid();
$$;

revoke execute on function public.set_my_photo(text) from public, anon;
grant  execute on function public.set_my_photo(text) to authenticated;

-- =====================================================================
--  RRPP que gestiona todos los reservados (el "hoster")
--  · employees.manages_reservations: además de lo que ya hace como RRPP, puede
--    modificar y borrar cualquier reserva, aunque no la haya creado él ni sea
--    suya. El resto de RRPP siguen igual (sólo las que crearon, las suyas y
--    las que atienden).
--  · También le llegan los avisos de reservados y pedidos nuevos.
--  · Se activa desde la ficha (sólo administradores). Se activa ya para Guillepo.
-- =====================================================================

alter table public.employees
  add column if not exists manages_reservations boolean not null default false;

create or replace function public.manages_reservations()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.employees where user_id = auth.uid() and active and manages_reservations);
$$;
revoke execute on function public.manages_reservations() from public, anon;
grant  execute on function public.manages_reservations() to authenticated;

-- Puede verlos y apuntarlos aunque su ficha no sea de RRPP
create or replace function public.can_reserve()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'rrpp', 'tray'))
      or public.manages_reservations();
$$;

drop policy if exists reservations_rrpp_insert on public.reservations;
create policy reservations_rrpp_insert on public.reservations
  for insert to authenticated with check ((public.is_rrpp() or public.manages_reservations()) and created_by = auth.uid());

drop policy if exists reservations_rrpp_update on public.reservations;
create policy reservations_rrpp_update on public.reservations
  for update to authenticated
  using (
    public.manages_reservations()
    or (
      public.is_rrpp()
      and (created_by = auth.uid() or rrpp_id = public.my_employee_id() or host_rrpp_id = public.my_employee_id())
    )
  )
  with check (public.is_rrpp() or public.manages_reservations());

drop policy if exists reservations_rrpp_delete on public.reservations;
create policy reservations_rrpp_delete on public.reservations
  for delete to authenticated using (
    public.manages_reservations()
    or (
      public.is_rrpp()
      and (created_by = auth.uid() or rrpp_id = public.my_employee_id() or host_rrpp_id = public.my_employee_id())
    )
  );

-- Su ficha (sin tarifa) le dice a la app si gestiona los reservados
create or replace view public.my_employee as
  select id, user_id, first_name, last_name, email, phone, position, department,
         contract_type, hire_date, active, color, photo_url, created_at, manages_reservations
  from public.employees
  where user_id = auth.uid();

-- Los avisos de reservados y pedidos nuevos: a los camareros de bandeja y a quien gestiona los reservados
create or replace function public.notify_trays(p_kind text, p_ref uuid, p_data jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (employee_id, kind, ref_id, data)
  select e.id, p_kind, p_ref, p_data
    from public.employees e
    left join public.profiles p on p.id = e.user_id
   where e.active and e.user_id is not null and (p.role = 'tray' or e.manages_reservations);
$$;
revoke execute on function public.notify_trays(text, uuid, jsonb) from public, anon, authenticated;

-- Guillepo, el hoster
update public.employees set manages_reservations = true where id = '03c1062d-3085-4ea2-9189-5f2bfabcc74f';

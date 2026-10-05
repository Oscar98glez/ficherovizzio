-- =====================================================================
--  Reservas: "RRPP" (quien trae la reserva) y "RRPP que atiende"
--  · Cualquier RRPP puede elegir ambos al crear o editar una reserva.
--  · Un RRPP puede editar las reservas que creó, las suyas y las que atiende.
--  · reservation_staff(): lista de RRPP para elegir (sólo nombre, sin más datos).
-- =====================================================================

alter table public.reservations
  add column if not exists host_rrpp_id   uuid references public.employees (id) on delete set null,
  add column if not exists host_rrpp_name text;

-- Nombres visibles para todos los RRPP y autor de la reserva
create or replace function public.reservation_defaults()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.created_by := auth.uid();
      if new.rrpp_id is null then
        new.rrpp_id := public.my_employee_id();
      end if;
    end if;
  elsif not public.is_admin() then
    new.created_by := old.created_by;
  end if;

  new.rrpp_name      := (select trim(first_name || ' ' || last_name) from public.employees where id = new.rrpp_id);
  new.host_rrpp_name := (select trim(first_name || ' ' || last_name) from public.employees where id = new.host_rrpp_id);
  new.updated_at := now();
  return new;
end;
$$;

-- Permisos de los RRPP
drop policy if exists reservations_rrpp_insert on public.reservations;
create policy reservations_rrpp_insert on public.reservations
  for insert to authenticated with check (public.is_rrpp() and created_by = auth.uid());

drop policy if exists reservations_rrpp_update on public.reservations;
create policy reservations_rrpp_update on public.reservations
  for update to authenticated
  using (
    public.is_rrpp()
    and (created_by = auth.uid() or rrpp_id = public.my_employee_id() or host_rrpp_id = public.my_employee_id())
  )
  with check (public.is_rrpp());

drop policy if exists reservations_rrpp_delete on public.reservations;
create policy reservations_rrpp_delete on public.reservations
  for delete to authenticated using (
    public.is_rrpp()
    and (created_by = auth.uid() or rrpp_id = public.my_employee_id() or host_rrpp_id = public.my_employee_id())
  );

-- RRPP que se pueden elegir en una reserva (relaciones públicas, RRPP y administradores con ficha)
create or replace function public.reservation_staff()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select e.id, trim(e.first_name || ' ' || e.last_name) as name
  from public.employees e
  left join public.profiles p on p.id = e.user_id
  where public.can_reserve()
    and e.active
    and (p.role in ('rrpp', 'admin') or e.department = 'relaciones')
  order by 2;
$$;

revoke execute on function public.reservation_staff() from public, anon;
grant  execute on function public.reservation_staff() to authenticated;

-- =====================================================================
--  Los camareros de bandeja aceptan cada pedido de un reservado y van
--  diciendo cómo está: aceptado → en preparación → servido.
--  · Cada pedido por separado: el pedido 1 (el de la reserva, clave "main")
--    y cada pedido añadido después (clave = su id en extra_orders).
--  · reservations.service = { "<pedido>": { status, by, at } }
--  · Lo cambian los camareros de bandeja, quien gestiona los reservados
--    (el hoster) y el administrador, con set_reservation_service. Así no
--    hace falta que los bandejas puedan modificar el resto de la reserva.
-- =====================================================================

alter table public.reservations
  add column if not exists service jsonb not null default '{}'::jsonb;

create or replace function public.set_reservation_service(p_id uuid, p_order text, p_status text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_res  public.reservations;
  v_by   text;
  v_out  jsonb;
begin
  if not (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'tray'))
    or public.manages_reservations()
  ) then
    raise exception 'SERVICE_NOT_ALLOWED';
  end if;
  if p_status is null or p_status not in ('pending', 'accepted', 'preparing', 'served') then
    raise exception 'SERVICE_BAD_STATUS';
  end if;

  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null then
    raise exception 'SERVICE_NOT_FOUND';
  end if;
  if p_order is null or (
    p_order <> 'main'
    and not exists (select 1 from jsonb_array_elements(coalesce(v_res.extra_orders, '[]'::jsonb)) o where o ->> 'id' = p_order)
  ) then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  select coalesce(nullif(trim(concat_ws(' ', e.first_name, e.last_name)), ''), p.full_name)
    into v_by
    from public.profiles p
    left join public.employees e on e.user_id = p.id and e.active
   where p.id = auth.uid()
   limit 1;

  if p_status = 'pending' then
    v_out := coalesce(v_res.service, '{}'::jsonb) - p_order;
  else
    v_out := coalesce(v_res.service, '{}'::jsonb)
             || jsonb_build_object(p_order, jsonb_build_object('status', p_status, 'by', v_by, 'at', now()));
  end if;

  update public.reservations set service = v_out where id = p_id;
  return v_out;
end;
$$;

revoke execute on function public.set_reservation_service(uuid, text, text) from public, anon;
grant execute on function public.set_reservation_service(uuid, text, text) to authenticated;

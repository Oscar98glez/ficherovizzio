-- =====================================================================
--  Avisos de reservados a los camareros de bandeja: siempre, esté el
--  reservado en el estado que esté (Pendiente, Confirmada, Ha llegado...).
--  · Al apuntar un reservado: aviso con el reservado, la hora, las personas,
--    el cliente y sus botellas y refrescos.
--  · Al añadirle un pedido: aviso con ese pedido.
--  · Al marcar "Ha llegado": aviso con todo lo que lleva (como hasta ahora).
--  · No se avisa de los cancelados, de los "No vino" ni de noches pasadas.
--  · Les llega a todos los de bandeja: cuenta de bandeja, o camarero con la
--    ficha en Sala o con el puesto "de bandeja" (antes sólo a las cuentas de
--    bandeja, así que a algunos no les llegaba), y al hoster.
--  · Esos camareros de Sala también ven los reservados y aceptan los pedidos.
-- =====================================================================

-- Camarero de bandeja: cuenta de bandeja, o de barra con la ficha en Sala o el puesto de bandeja
create or replace function public.is_tray()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      left join public.employees e on e.user_id = p.id and e.active
     where p.id = auth.uid()
       and (p.role = 'tray' or (p.role = 'worker' and (e.department = 'sala' or e.position ilike '%bandeja%')))
  );
$$;
revoke execute on function public.is_tray() from public, anon;
grant execute on function public.is_tray() to authenticated;

-- Ven los reservados
create or replace function public.can_reserve()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'rrpp', 'tray'))
      or public.manages_reservations()
      or public.is_tray();
$$;

-- Los avisos: a todos los de bandeja y a quien gestiona los reservados
create or replace function public.notify_trays(p_kind text, p_ref uuid, p_data jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (employee_id, kind, ref_id, data)
  select e.id, p_kind, p_ref, p_data
    from public.employees e
    left join public.profiles p on p.id = e.user_id
   where e.active
     and e.user_id is not null
     and (
       p.role = 'tray'
       or e.manages_reservations
       or (p.role = 'worker' and (e.department = 'sala' or e.position ilike '%bandeja%'))
     );
$$;
revoke execute on function public.notify_trays(text, uuid, jsonb) from public, anon, authenticated;

-- Noche de hoy (las noches van de 06:00 a 06:00, hora de Madrid)
create or replace function public.reservation_is_past(p_date date)
returns boolean
language sql stable
as $$
  select p_date < ((now() at time zone 'Europe/Madrid') - interval '6 hours')::date;
$$;

-- ---------- Reservado nuevo: aviso en cualquier estado ----------
create or replace function public.notify_reservation_new()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_table text;
begin
  -- Si se apunta ya como "Ha llegado", el aviso es el de llegada (no se manda dos veces)
  if new.status in ('cancelled', 'no_show', 'arrived') or public.reservation_is_past(new.date) then
    return new;
  end if;
  select trim(concat_ws(' · ', name, nullif(zone, ''))) into v_table from public.vip_tables where id = new.table_id;
  perform public.notify_trays('reservation_new', new.id, jsonb_build_object(
    'date', new.date,
    'table', v_table,
    'guests', new.guests,
    'arrival', to_char(new.arrival_time, 'HH24:MI'),
    'customer', new.customer_name,
    'bottles', nullif(public.order_items_text(public.reservation_all_items(new.bottles, new.extra_orders, 'bottles')), ''),
    'mixers', nullif(public.order_items_text(public.reservation_all_items(new.mixers, new.extra_orders, 'mixers')), '')
  ));
  return new;
end;
$$;

drop trigger if exists reservations_notify_tray on public.reservations;
create trigger reservations_notify_tray
  after insert on public.reservations
  for each row execute function public.notify_reservation_new();

-- ---------- Ha llegado: aviso con todo lo que lleva ----------
create or replace function public.notify_reservation_arrived()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_table text;
begin
  if new.status <> 'arrived' or (tg_op = 'UPDATE' and old.status = 'arrived') or public.reservation_is_past(new.date) then
    return new;
  end if;
  select trim(concat_ws(' · ', name, nullif(zone, ''))) into v_table from public.vip_tables where id = new.table_id;
  perform public.notify_trays('reservation_arrived', new.id, jsonb_build_object(
    'date', new.date,
    'table', v_table,
    'guests', new.guests,
    'customer', new.customer_name,
    'bottles', nullif(public.order_items_text(public.reservation_all_items(new.bottles, new.extra_orders, 'bottles')), ''),
    'mixers', nullif(public.order_items_text(public.reservation_all_items(new.mixers, new.extra_orders, 'mixers')), '')
  ));
  return new;
end;
$$;

-- ---------- Pedido añadido: aviso en cualquier estado ----------
create or replace function public.notify_reservation_order()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_table text;
  v_old   integer := jsonb_array_length(coalesce(old.extra_orders, '[]'::jsonb));
  v_new   integer := jsonb_array_length(coalesce(new.extra_orders, '[]'::jsonb));
  v_order jsonb;
begin
  if v_new <= v_old or new.status in ('cancelled', 'no_show') or public.reservation_is_past(new.date) then
    return new;
  end if;
  select trim(concat_ws(' · ', name, nullif(zone, ''))) into v_table from public.vip_tables where id = new.table_id;
  for i in v_old .. v_new - 1 loop
    v_order := new.extra_orders -> i;
    perform public.notify_trays('reservation_order', new.id, jsonb_build_object(
      'date', new.date,
      'table', v_table,
      'customer', new.customer_name,
      -- El pedido 1 es el de la reserva; los añadidos empiezan en el 2
      'order', i + 2,
      'bottles', nullif(public.order_items_text(v_order -> 'bottles'), ''),
      'mixers', nullif(public.order_items_text(v_order -> 'mixers'), '')
    ));
  end loop;
  return new;
end;
$$;

-- ---------- Aceptar los pedidos: también los camareros de Sala ----------
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
    or public.is_tray()
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

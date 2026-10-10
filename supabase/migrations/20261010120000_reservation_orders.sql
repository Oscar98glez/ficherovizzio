-- =====================================================================
--  Pedidos de un reservado
--  Lo que se apunta al crear la reserva es el pedido 1 (bottles / mixers).
--  Si después se añaden botellas, van en un pedido nuevo con sus propios
--  refrescos (extra_orders), sin mezclarse con los anteriores:
--    [{ "id", "at", "by", "bottles": [...], "mixers": [...] }, ...]
--  A los camareros de bandeja les llega un aviso con cada pedido nuevo
--  (y el de la reserva nueva lleva ya sus botellas y refrescos).
-- =====================================================================

alter table public.reservations
  add column if not exists extra_orders jsonb not null default '[]'::jsonb;

-- "2× Bowtie, 1× Moët (cortesía)"
create or replace function public.order_items_text(p_items jsonb)
returns text
language sql immutable
as $$
  select coalesce(string_agg(
           format('%s× %s%s', coalesce(i ->> 'qty', '1'), i ->> 'name', case when (i ->> 'courtesy')::boolean then ' (cortesía)' else '' end),
           ', ' order by n),
         '')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, n)
   where coalesce(i ->> 'name', '') <> '';
$$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('shift_new', 'shift_changed', 'shift_cancelled', 'message', 'task', 'reply', 'reservation_new', 'reservation_order'));

-- Aviso a cada camarero de bandeja activo
create or replace function public.notify_trays(p_kind text, p_ref uuid, p_data jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (employee_id, kind, ref_id, data)
  select e.id, p_kind, p_ref, p_data
    from public.employees e
    join public.profiles p on p.id = e.user_id
   where p.role = 'tray' and e.active;
$$;
revoke execute on function public.notify_trays(text, uuid, jsonb) from public, anon, authenticated;

-- Reserva nueva: con sus botellas y refrescos (pedido 1)
create or replace function public.notify_reservation_new()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_table text;
begin
  if new.status in ('cancelled', 'no_show')
     or new.date < ((now() at time zone 'Europe/Madrid') - interval '6 hours')::date then
    return new;
  end if;
  select trim(concat_ws(' · ', name, nullif(zone, ''))) into v_table from public.vip_tables where id = new.table_id;
  perform public.notify_trays('reservation_new', new.id, jsonb_build_object(
    'date', new.date,
    'table', v_table,
    'guests', new.guests,
    'arrival', to_char(new.arrival_time, 'HH24:MI'),
    'customer', new.customer_name,
    'bottles', nullif(public.order_items_text(new.bottles), ''),
    'mixers', nullif(public.order_items_text(new.mixers), '')
  ));
  return new;
end;
$$;

-- Pedido nuevo en una reserva ya apuntada: un aviso por pedido, con sus botellas y sus refrescos
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
  if v_new <= v_old
     or new.status in ('cancelled', 'no_show')
     or new.date < ((now() at time zone 'Europe/Madrid') - interval '6 hours')::date then
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

drop trigger if exists reservations_notify_order on public.reservations;
create trigger reservations_notify_order
  after update of extra_orders on public.reservations
  for each row execute function public.notify_reservation_order();

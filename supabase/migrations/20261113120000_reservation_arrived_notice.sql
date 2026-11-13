-- =====================================================================
--  Avisos de reservados a los camareros de bandeja (y al hoster):
--  llegan cuando se marca que el reservado HA LLEGADO, no al apuntarlo.
--  · Al marcar "Ha llegado": un aviso con el reservado, las personas, el
--    cliente y todo lo que lleva (las botellas y los refrescos de todos
--    sus pedidos hasta ese momento).
--  · Los pedidos que se añadan después, con el reservado ya llegado,
--    siguen avisando cada uno con sus botellas y sus refrescos. Los que se
--    añaden antes de que llegue van dentro del aviso de llegada.
--  · Al apuntar una reserva ya no se avisa.
-- =====================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('shift_new', 'shift_changed', 'shift_cancelled', 'message', 'task', 'reply',
                  'reservation_new', 'reservation_order', 'reservation_arrived'));

-- Al apuntar una reserva ya no se avisa
drop trigger if exists reservations_notify_tray on public.reservations;

-- Botellas (o refrescos) de una reserva: los del pedido 1 y los de los pedidos añadidos
create or replace function public.reservation_all_items(p_first jsonb, p_extra jsonb, p_key text)
returns jsonb
language sql immutable
as $$
  select coalesce(p_first, '[]'::jsonb)
         || coalesce((select jsonb_agg(it.v order by o.n, it.n)
                        from jsonb_array_elements(coalesce(p_extra, '[]'::jsonb)) with ordinality as o(v, n)
                       cross join lateral jsonb_array_elements(coalesce(o.v -> p_key, '[]'::jsonb)) with ordinality as it(v, n)),
                     '[]'::jsonb);
$$;

-- Ha llegado: aviso con todo lo que lleva
create or replace function public.notify_reservation_arrived()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_table text;
begin
  if new.status <> 'arrived' or (tg_op = 'UPDATE' and old.status = 'arrived') then
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

drop trigger if exists reservations_notify_arrived on public.reservations;
create trigger reservations_notify_arrived
  after insert or update of status on public.reservations
  for each row execute function public.notify_reservation_arrived();

-- Pedidos añadidos: sólo con el reservado ya llegado (los de antes van en el aviso de llegada)
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
  if v_new <= v_old or new.status <> 'arrived' or old.status <> 'arrived' then
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

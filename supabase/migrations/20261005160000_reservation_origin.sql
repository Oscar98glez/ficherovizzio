-- =====================================================================
--  Reservas: además de un RRPP, la reserva puede venir de "Otros" o de "Empresa"
--  · rrpp_origin = 'otros' | 'empresa' (sin RRPP asignado); null = la trae un RRPP.
-- =====================================================================

alter table public.reservations
  add column if not exists rrpp_origin text check (rrpp_origin in ('otros', 'empresa'));

create or replace function public.reservation_defaults()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.rrpp_origin is not null then
    new.rrpp_id := null;
  end if;

  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.created_by := auth.uid();
      if new.rrpp_id is null and new.rrpp_origin is null then
        new.rrpp_id := public.my_employee_id();
      end if;
    end if;
  elsif not public.is_admin() then
    new.created_by := old.created_by;
  end if;

  new.rrpp_name := case new.rrpp_origin
    when 'otros'   then 'Otros'
    when 'empresa' then 'Empresa'
    else (select trim(first_name || ' ' || last_name) from public.employees where id = new.rrpp_id)
  end;
  new.host_rrpp_name := (select trim(first_name || ' ' || last_name) from public.employees where id = new.host_rrpp_id);
  new.updated_at := now();
  return new;
end;
$$;

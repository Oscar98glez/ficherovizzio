-- =====================================================================
--  Respuesta del trabajador a cada turno: lo acepta (asistirá) o lo
--  rechaza (con un motivo opcional). Así el administrador sabe quién lo
--  ha visto y quién va a venir.
-- =====================================================================

alter table public.shifts
  add column if not exists response      text check (response in ('accepted', 'declined')),
  add column if not exists responded_at  timestamptz,
  add column if not exists response_note text;

-- Si el administrador cambia la hora o la persona del turno, la respuesta deja de valer
create or replace function public.shifts_reset_response()
returns trigger
language plpgsql
as $$
begin
  if new.start_at is distinct from old.start_at or new.employee_id is distinct from old.employee_id then
    new.response      := null;
    new.responded_at  := null;
    new.response_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_reset_response on public.shifts;
create trigger shifts_reset_response
  before update on public.shifts
  for each row execute function public.shifts_reset_response();

-- El trabajador responde a sus propios turnos (no puede tocar nada más del turno).
-- Se puede cambiar la respuesta mientras el turno no haya empezado ni esté cancelado.
create or replace function public.respond_shift(p_shift uuid, p_response text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_shift public.shifts;
begin
  if p_response is null or p_response not in ('accepted', 'declined') then
    raise exception 'INVALID_RESPONSE';
  end if;

  select * into v_shift from public.shifts
   where id = p_shift and employee_id = public.my_employee_id();
  if v_shift.id is null then
    raise exception 'SHIFT_NOT_FOUND';
  end if;
  if v_shift.status = 'cancelled' or v_shift.start_at <= now() then
    raise exception 'SHIFT_CLOSED';
  end if;

  update public.shifts
     set response      = p_response,
         responded_at  = now(),
         response_note = case when p_response = 'declined' then nullif(btrim(p_note), '') end
   where id = p_shift
  returning * into v_shift;

  return to_jsonb(v_shift);
end;
$$;

revoke execute on function public.respond_shift(uuid, text, text) from public, anon;
grant  execute on function public.respond_shift(uuid, text, text) to authenticated;

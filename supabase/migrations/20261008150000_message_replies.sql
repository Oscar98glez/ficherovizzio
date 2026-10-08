-- =====================================================================
--  Respuestas a los mensajes y tareas
--  Cada destinatario tiene su conversación privada con la administración:
--  el trabajador responde a lo que le han enviado y el administrador le
--  contesta. Cada respuesta avisa al otro lado (notificación al móvil).
-- =====================================================================

create table if not exists public.message_replies (
  id            uuid primary key default gen_random_uuid(),
  -- Conversación: el destinatario del mensaje (trabajador + mensaje)
  recipient_id  uuid not null references public.message_recipients (id) on delete cascade,
  author_id     uuid references auth.users (id) on delete set null,
  -- true: la escribe la administración; false: el trabajador
  from_admin    boolean not null,
  body          text not null check (length(btrim(body)) between 1 and 2000),
  created_at    timestamptz not null default now(),
  -- Cuándo la leyó el otro lado
  read_at       timestamptz
);
create index if not exists message_replies_recipient_idx on public.message_replies (recipient_id, created_at);

alter table public.message_replies enable row level security;

drop policy if exists message_replies_admin_select on public.message_replies;
create policy message_replies_admin_select on public.message_replies
  for select to authenticated using (public.is_admin());
-- El trabajador ve las respuestas de sus conversaciones
drop policy if exists message_replies_self_select on public.message_replies;
create policy message_replies_self_select on public.message_replies
  for select to authenticated using (
    exists (select 1 from public.message_recipients r
             where r.id = message_replies.recipient_id and r.employee_id = public.my_employee_id())
  );

-- Responder: el trabajador en sus conversaciones; el administrador en cualquiera
create or replace function public.reply_message(p_recipient uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_rec   public.message_recipients;
  v_row   public.message_replies;
begin
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'EMPTY_REPLY';
  end if;
  select * into v_rec from public.message_recipients where id = p_recipient;
  if v_rec.id is null or (not v_admin and v_rec.employee_id is distinct from public.my_employee_id()) then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  insert into public.message_replies (recipient_id, author_id, from_admin, body)
  values (p_recipient, auth.uid(), v_admin, left(btrim(p_body), 2000))
  returning * into v_row;

  -- Quien responde ya ha leído el mensaje y lo anterior de la conversación
  if not v_admin then
    update public.message_recipients set read_at = coalesce(read_at, now()) where id = p_recipient;
  end if;
  update public.message_replies set read_at = now()
   where recipient_id = p_recipient and from_admin <> v_admin and read_at is null;

  return to_jsonb(v_row);
end;
$$;

-- Marca como leídas las respuestas del otro lado en una conversación
create or replace function public.mark_replies_read(p_recipient uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
begin
  update public.message_replies m
     set read_at = now()
    from public.message_recipients r
   where m.recipient_id = p_recipient
     and r.id = m.recipient_id
     and m.read_at is null
     and m.from_admin <> v_admin
     and (v_admin or r.employee_id = public.my_employee_id());
end;
$$;

revoke execute on function public.reply_message(uuid, text)  from public, anon;
revoke execute on function public.mark_replies_read(uuid)    from public, anon;
grant  execute on function public.reply_message(uuid, text)  to authenticated;
grant  execute on function public.mark_replies_read(uuid)    to authenticated;

-- ---------- Avisos de las respuestas ----------
-- Las notificaciones pueden ir a un trabajador (employee_id) o directamente a un usuario (user_id),
-- p. ej. a los administradores cuando un trabajador responde.
alter table public.notifications alter column employee_id drop not null;
alter table public.notifications add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('shift_new', 'shift_changed', 'shift_cancelled', 'message', 'task', 'reply'));
alter table public.notifications drop constraint if exists notifications_target_check;
alter table public.notifications add constraint notifications_target_check
  check (employee_id is not null or user_id is not null);

create or replace function public.notify_reply()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_rec  public.message_recipients;
  v_msg  public.messages;
  v_name text;
begin
  select * into v_rec from public.message_recipients where id = new.recipient_id;
  select * into v_msg from public.messages where id = v_rec.message_id;

  if new.from_admin then
    -- Al trabajador
    insert into public.notifications (employee_id, kind, ref_id, data)
    values (v_rec.employee_id, 'reply', new.recipient_id,
            jsonb_build_object('title', v_msg.title, 'body', left(new.body, 200), 'from_admin', true));
  else
    -- A cada administrador
    select btrim(first_name || ' ' || coalesce(last_name, '')) into v_name from public.employees where id = v_rec.employee_id;
    insert into public.notifications (user_id, kind, ref_id, data)
    select p.id, 'reply', new.recipient_id,
           jsonb_build_object('title', v_msg.title, 'body', left(new.body, 200), 'from_admin', false,
                              'from', v_name, 'message_id', v_msg.id)
      from public.profiles p
     where p.role = 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists message_replies_notify on public.message_replies;
create trigger message_replies_notify
  after insert on public.message_replies
  for each row execute function public.notify_reply();

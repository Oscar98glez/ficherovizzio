-- =====================================================================
--  1) Mensajes y tareas del administrador a los trabajadores
--     (las tareas se aceptan o se rechazan)
--  2) Notificaciones al móvil (Web Push)
--     · notifications: bandeja de salida que rellenan los triggers al asignar,
--       cambiar o cancelar un turno y al enviar un mensaje o una tarea.
--     · La función "notify" (supabase/functions/notify) las envía a los
--       dispositivos de cada trabajador (push_subscriptions).
--     · push_keys: claves VAPID; las genera la función la primera vez y sólo
--       ella las lee (sin políticas: nadie más tiene acceso).
-- =====================================================================

-- ---------- 1) Mensajes y tareas ----------

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'message' check (kind in ('message', 'task')),
  title       text not null check (length(btrim(title)) between 1 and 120),
  body        text check (body is null or length(body) <= 4000),
  -- Fecha límite (sólo tareas, opcional)
  due_date    date,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at desc);

create table if not exists public.message_recipients (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.messages (id) on delete cascade,
  employee_id    uuid not null references public.employees (id) on delete cascade,
  read_at        timestamptz,
  -- Sólo tareas: la acepta o la rechaza (con un motivo opcional)
  response       text check (response in ('accepted', 'declined')),
  responded_at   timestamptz,
  response_note  text,
  created_at     timestamptz not null default now(),
  constraint message_recipients_unique unique (message_id, employee_id)
);
create index if not exists message_recipients_employee_idx on public.message_recipients (employee_id, created_at desc);

alter table public.messages           enable row level security;
alter table public.message_recipients enable row level security;

drop policy if exists messages_admin_all on public.messages;
create policy messages_admin_all on public.messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- El trabajador sólo ve los mensajes que le han enviado
drop policy if exists messages_recipient_select on public.messages;
create policy messages_recipient_select on public.messages
  for select to authenticated using (
    exists (select 1 from public.message_recipients r
             where r.message_id = messages.id and r.employee_id = public.my_employee_id())
  );

drop policy if exists message_recipients_admin_all on public.message_recipients;
create policy message_recipients_admin_all on public.message_recipients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists message_recipients_self_select on public.message_recipients;
create policy message_recipients_self_select on public.message_recipients
  for select to authenticated using (employee_id = public.my_employee_id());

-- El trabajador marca como leído un mensaje suyo (no puede tocar nada más)
create or replace function public.mark_message_read(p_recipient uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.message_recipients
     set read_at = coalesce(read_at, now())
   where id = p_recipient and employee_id = public.my_employee_id();
$$;

-- El trabajador acepta o rechaza una tarea suya (puede cambiar de opinión)
create or replace function public.respond_task(p_recipient uuid, p_response text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.message_recipients;
begin
  if p_response is null or p_response not in ('accepted', 'declined') then
    raise exception 'INVALID_RESPONSE';
  end if;

  update public.message_recipients r
     set response      = p_response,
         responded_at  = now(),
         response_note = case when p_response = 'declined' then nullif(btrim(p_note), '') end,
         read_at       = coalesce(r.read_at, now())
    from public.messages m
   where r.id = p_recipient
     and r.employee_id = public.my_employee_id()
     and m.id = r.message_id
     and m.kind = 'task'
  returning r.* into v_row;

  if v_row.id is null then
    raise exception 'TASK_NOT_FOUND';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.mark_message_read(uuid)          from public, anon;
revoke execute on function public.respond_task(uuid, text, text)   from public, anon;
grant  execute on function public.mark_message_read(uuid)          to authenticated;
grant  execute on function public.respond_task(uuid, text, text)   to authenticated;

-- ---------- 2) Notificaciones ----------

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  kind         text not null check (kind in ('shift_new', 'shift_changed', 'shift_cancelled', 'message', 'task')),
  -- Turno o destinatario del mensaje al que se refiere
  ref_id       uuid,
  -- Datos para el texto: hora del turno, título del mensaje...
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  -- Cuándo la recogió la función para enviarla (null = pendiente)
  sent_at      timestamptz
);
create index if not exists notifications_pending_idx on public.notifications (created_at) where sent_at is null;

alter table public.notifications enable row level security;
drop policy if exists notifications_admin_select on public.notifications;
create policy notifications_admin_select on public.notifications
  for select to authenticated using (public.is_admin());

-- Turnos: aviso al asignar, al cambiar la hora o la persona, al cancelar y al borrar (sólo turnos futuros)
create or replace function public.notify_shift_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' and new.start_at > now() then
      insert into public.notifications (employee_id, kind, ref_id, data)
      values (new.employee_id, 'shift_new', new.id, jsonb_build_object('start_at', new.start_at));
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'cancelled' and old.start_at > now() then
      insert into public.notifications (employee_id, kind, ref_id, data)
      values (old.employee_id, 'shift_cancelled', old.id, jsonb_build_object('start_at', old.start_at));
    end if;
    return old;
  end if;

  -- UPDATE
  if new.employee_id is distinct from old.employee_id then
    if old.status <> 'cancelled' and old.start_at > now() then
      insert into public.notifications (employee_id, kind, ref_id, data)
      values (old.employee_id, 'shift_cancelled', old.id, jsonb_build_object('start_at', old.start_at));
    end if;
    if new.status <> 'cancelled' and new.start_at > now() then
      insert into public.notifications (employee_id, kind, ref_id, data)
      values (new.employee_id, 'shift_new', new.id, jsonb_build_object('start_at', new.start_at));
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    if old.start_at > now() then
      insert into public.notifications (employee_id, kind, ref_id, data)
      values (new.employee_id, 'shift_cancelled', new.id, jsonb_build_object('start_at', old.start_at));
    end if;
  elsif new.status <> 'cancelled' and old.status = 'cancelled' then
    if new.start_at > now() then
      insert into public.notifications (employee_id, kind, ref_id, data)
      values (new.employee_id, 'shift_new', new.id, jsonb_build_object('start_at', new.start_at));
    end if;
  elsif new.status <> 'cancelled' and new.start_at is distinct from old.start_at and new.start_at > now() then
    insert into public.notifications (employee_id, kind, ref_id, data)
    values (new.employee_id, 'shift_changed', new.id,
            jsonb_build_object('start_at', new.start_at, 'old_start_at', old.start_at));
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_notify on public.shifts;
create trigger shifts_notify
  after insert or update or delete on public.shifts
  for each row execute function public.notify_shift_change();

-- Mensajes y tareas: aviso a cada destinatario
create or replace function public.notify_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_msg public.messages;
begin
  select * into v_msg from public.messages where id = new.message_id;
  insert into public.notifications (employee_id, kind, ref_id, data)
  values (new.employee_id, v_msg.kind, new.id,
          jsonb_build_object('title', v_msg.title, 'body', left(coalesce(v_msg.body, ''), 200), 'due_date', v_msg.due_date));
  return new;
end;
$$;

drop trigger if exists message_recipients_notify on public.message_recipients;
create trigger message_recipients_notify
  after insert on public.message_recipients
  for each row execute function public.notify_message();

-- ---------- Dispositivos (Web Push) ----------

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_self_select on public.push_subscriptions;
create policy push_subscriptions_self_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- Guarda (o pasa a este usuario) el dispositivo desde el que se activan las notificaciones
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_endpoint !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'INVALID_SUBSCRIPTION';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.delete_push_subscription(text)                 from public, anon;
grant  execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant  execute on function public.delete_push_subscription(text)                 to authenticated;

-- Claves VAPID (una sola fila). Sin políticas: sólo la función "notify" (clave de servicio) las lee.
create table if not exists public.push_keys (
  id           int primary key default 1 check (id = 1),
  public_key   text not null,
  private_key  text not null,
  created_at   timestamptz not null default now()
);
alter table public.push_keys enable row level security;
revoke all on public.push_keys from anon, authenticated;

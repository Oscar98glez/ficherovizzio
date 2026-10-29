-- =====================================================================
--  Lo de Finanzas también en la caja de Administración
--  · Ingresos: lo que entra cada día en Finanzas se suma a su noche
--    (efectivo, banco y plataforma). En admin_ledger_days.finance se guarda
--    la parte que viene de Finanzas, para cambiar sólo esa parte cuando
--    cambien los movimientos (lo que se apunte a mano se respeta).
--      · Entradas online → plataforma
--      · En efectivo → efectivo; con tarjeta, transferencia, Bizum... → banco
--  · Gastos: cada gasto de Finanzas es un pago de la caja
--    (admin_ledger_expenses.transaction_id), en su columna según su
--    categoría y su descripción (Coca Cola → Cocacola, Seguridad externa →
--    Porteros...), en efectivo o por el banco según se pagó.
--  · Se mantiene solo: al apuntar, cambiar o borrar un movimiento en
--    Finanzas cambia también la caja.
--  · Al aplicarla se pasa todo lo que ya hay en Finanzas: en las noches
--    que tengan ingresos en Finanzas, el efectivo, el banco y la plataforma
--    pasan a ser los de Finanzas; un pago ya apuntado a mano el mismo día
--    y por el mismo importe se toma como ese gasto (no se duplica).
-- =====================================================================

alter table public.admin_ledger_days
  add column if not exists finance jsonb not null default '{}'::jsonb;

alter table public.admin_ledger_expenses
  add column if not exists transaction_id uuid unique references public.transactions (id) on delete cascade;

-- ---------- Columna de la caja de un gasto de Finanzas ----------
create or replace function public.ledger_concept(p_category text, p_description text)
returns text
language plpgsql immutable
as $$
declare
  d text := lower(translate(coalesce(p_description, ''), 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouuNn'));
begin
  if d like '%gestoria%' then return 'gestoria'; end if;
  if d like '%numier%' then return 'numier'; end if;
  return case p_category
    when 'Seguridad externa' then 'porteros'
    when 'Personal' then
      case when d like '%limpi%' then 'limpieza'
           when d like '%encargad%' then 'encargado'
           when d like '%porter%' or d like '%segurid%' then 'porteros'
           when d like '%rrpp%' or d like '%relaciones%' then 'rrpp'
           else 'camareros' end
    when 'Nóminas' then
      case when d like '%limpi%' then 'limpieza'
           when d like '%encargad%' then 'encargado'
           when d like '%porter%' then 'porteros'
           else 'camareros' end
    when 'Proveedores bebida' then
      case when d like '%coca%' or d like '%cola%' then 'cocacola'
           when d like '%nosvemos%' then 'nosvemos'
           when d like '%hielo%' then 'hielo'
           when d like '%montanera%' then 'montanera'
           when d like '%dundalk%' then 'dundalk'
           when d like '%albariza%' then 'albariza'
           when d like '%vinafiel%' then 'vinafiel'
           when d like '%merino%' then 'merino'
           else 'otros_proveedores' end
    when 'Suministros' then
      case when d like '%dla%' then 'dla'
           when d like '%butasol%' then 'butasol'
           when d like '%luz%' or d like '%endesa%' or d like '%iberdrola%' or d like '%electric%' then 'luz'
           when d like '%agua%' or d like '%emasesa%' or d like '%aljarafesa%' then 'agua'
           when d like '%telef%' or d like '%movistar%' or d like '%vodafone%' or d like '%orange%' or d like '%internet%' then 'telefonia'
           when d like '%hielo%' then 'hielo'
           else 'gastos_extra' end
    when 'Marketing' then 'marketing'
    when 'Alquiler' then
      case when d like '%comunidad%' then 'comunidad'
           when d like '%sonido%' then 'sonidos'
           else 'alquiler' end
    when 'Impuestos' then
      case when d like '%seguridad social%' or d like '%seguros sociales%' or d like '%tgss%' then 'seguros_sociales'
           else 'impuestos' end
    when 'Mantenimiento' then
      case when d like '%gonzalez%' then 'fco_gonzalez'
           when d like '%tec%luz%' or d like '%iluminacion%' then 'tec_luz'
           else 'gastos_extra' end
    else 'gastos_extra'  -- DJ / Artistas, Licencias / SGAE, Otros gastos
  end;
end;
$$;

-- ---------- Ingresos de un día ----------
create or replace function public.ledger_sync_income(p_date date, p_overwrite boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_new  jsonb;
  v_old  jsonb;
  v_data jsonb;
  v_id   uuid;
  v_n    numeric;
  k      text;
begin
  select jsonb_strip_nulls(jsonb_build_object(
           'efectivo',   nullif(round(coalesce(sum(amount) filter (where category <> 'Entradas online' and method = 'efectivo'), 0), 2), 0),
           'banco',      nullif(round(coalesce(sum(amount) filter (where category <> 'Entradas online' and method <> 'efectivo'), 0), 2), 0),
           'plataforma', nullif(round(coalesce(sum(amount) filter (where category = 'Entradas online'), 0), 2), 0)))
    into v_new
    from public.transactions
   where kind = 'income' and date = p_date;
  v_new := coalesce(v_new, '{}'::jsonb);

  select id, finance, data into v_id, v_old, v_data from public.admin_ledger_days where date = p_date for update;
  if v_id is null then
    if v_new <> '{}'::jsonb then
      insert into public.admin_ledger_days (date, data, finance) values (p_date, v_new, v_new);
    end if;
    return;
  end if;
  if v_old = v_new and not p_overwrite then
    return;
  end if;
  -- Al pasar lo que ya había: lo de Finanzas sustituye a lo apuntado en esas casillas
  if p_overwrite then
    v_old := (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                from jsonb_each(v_data)
               where key in (select jsonb_object_keys(v_new)) and jsonb_typeof(value) = 'number');
  end if;

  -- Se cambia sólo lo que viene de Finanzas (lo apuntado a mano se queda)
  foreach k in array array['efectivo', 'banco', 'plataforma'] loop
    v_n := case when jsonb_typeof(v_data -> k) = 'number' then (v_data ->> k)::numeric else 0 end
           - coalesce((v_old ->> k)::numeric, 0)
           + coalesce((v_new ->> k)::numeric, 0);
    if abs(v_n) < 0.005 then
      v_data := v_data - k;
    else
      v_data := jsonb_set(v_data, array[k], to_jsonb(round(v_n, 2)));
    end if;
  end loop;

  if v_data = '{}'::jsonb then
    delete from public.admin_ledger_days where id = v_id;
  else
    update public.admin_ledger_days set data = v_data, finance = v_new, updated_at = now() where id = v_id;
  end if;
end;
$$;
revoke execute on function public.ledger_sync_income(date, boolean) from public, anon, authenticated;

-- ---------- Un gasto ----------
create or replace function public.ledger_sync_expense(p_tx public.transactions)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- Un pago apuntado a mano ese día y por ese importe es este gasto: se enlaza en vez de duplicarlo
  if not exists (select 1 from public.admin_ledger_expenses where transaction_id = p_tx.id) then
    update public.admin_ledger_expenses
       set transaction_id = p_tx.id,
           method = case when p_tx.method = 'efectivo' then 'cash' else 'bank' end,
           updated_at = now()
     where id = (select id from public.admin_ledger_expenses
                  where transaction_id is null and date = p_tx.date and amount = p_tx.amount
                  order by created_at limit 1);
    if found then
      return;
    end if;
  end if;
  insert into public.admin_ledger_expenses (date, concept, amount, method, note, transaction_id)
  values (
    p_tx.date,
    public.ledger_concept(p_tx.category, p_tx.description),
    p_tx.amount,
    case when p_tx.method = 'efectivo' then 'cash' else 'bank' end,
    coalesce(nullif(trim(p_tx.description), ''), p_tx.category),
    p_tx.id
  )
  on conflict (transaction_id) do update
     set date = excluded.date,
         concept = excluded.concept,
         amount = excluded.amount,
         method = excluded.method,
         note = excluded.note,
         updated_at = now();
end;
$$;
revoke execute on function public.ledger_sync_expense(public.transactions) from public, anon, authenticated;

-- ---------- Al cambiar Finanzas ----------
create or replace function public.ledger_sync_transaction()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.kind = 'income' then
      perform public.ledger_sync_income(old.date);
    end if;
    if old.kind = 'expense' and (tg_op = 'DELETE' or new.kind <> 'expense') then
      delete from public.admin_ledger_expenses where transaction_id = old.id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.kind = 'income' and (tg_op = 'INSERT' or old.kind <> 'income' or old.date <> new.date or old.amount <> new.amount
                                or old.method <> new.method or old.category <> new.category) then
      perform public.ledger_sync_income(new.date);
    end if;
    if new.kind = 'expense' then
      perform public.ledger_sync_expense(new);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists transactions_ledger_sync on public.transactions;
create trigger transactions_ledger_sync
  after insert or update or delete on public.transactions
  for each row execute function public.ledger_sync_transaction();

-- ---------- Lo que ya hay en Finanzas ----------
do $$
declare
  v_date date;
  v_tx   public.transactions;
begin
  for v_date in select distinct date from public.transactions where kind = 'income' order by 1 loop
    perform public.ledger_sync_income(v_date, true);
  end loop;
  for v_tx in select * from public.transactions where kind = 'expense' order by date, created_at loop
    perform public.ledger_sync_expense(v_tx);
  end loop;
end;
$$;

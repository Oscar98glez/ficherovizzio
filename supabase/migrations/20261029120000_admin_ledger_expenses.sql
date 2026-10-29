-- =====================================================================
--  Pagos de la hoja de caja de Administración
--  · Como en el Excel de los administrativos, los gastos se apuntan sobre
--    todo por semanas (sueldos, RRPP, proveedores) y el mismo gasto unas
--    veces se paga en efectivo y otras por el banco. Cada pago es una fila:
--    el día en que se apunta, la columna (concept, de src/lib/ledger.ts),
--    el importe, cómo se pagó y una nota.
--  · Las noches (admin_ledger_days) se quedan sólo con los ingresos.
--  · Los gastos que ya hubiera apuntados en las noches pasan aquí, con la
--    forma de pago que tenía su columna (personal, RRPP y gastos extra en
--    efectivo; lo demás por banco). La definición de los otros gastos pasa
--    a ser la nota del gasto extra.
-- =====================================================================

create table if not exists public.admin_ledger_expenses (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  concept     text not null,
  amount      numeric(12,2) not null,
  method      text not null default 'bank' check (method in ('cash', 'bank')),
  note        text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists admin_ledger_expenses_date_idx on public.admin_ledger_expenses (date);

alter table public.admin_ledger_expenses enable row level security;

drop policy if exists admin_ledger_expenses_all on public.admin_ledger_expenses;
create policy admin_ledger_expenses_all on public.admin_ledger_expenses
  for all to authenticated using (public.can_manage_ledger()) with check (public.can_manage_ledger());

-- Los gastos apuntados en las noches pasan a ser pagos
insert into public.admin_ledger_expenses (date, concept, amount, method, note)
select d.date,
       e.key,
       (e.value #>> '{}')::numeric,
       case when e.key in ('porteros', 'limpieza', 'encargado', 'camareros', 'rrpp', 'gastos_extra') then 'cash' else 'bank' end,
       case when e.key = 'gastos_extra' then nullif(trim(d.data ->> 'otros_def'), '') end
  from public.admin_ledger_days d
 cross join lateral jsonb_each(d.data) e
 where jsonb_typeof(e.value) = 'number'
   and (e.value #>> '{}')::numeric <> 0
   and e.key in (
     'porteros', 'limpieza', 'encargado', 'camareros',
     'rrpp', 'marketing', 'administracion', 'numier', 'gestoria',
     'butasol', 'luz', 'telefonia', 'agua',
     'fco_gonzalez', 'tec_luz',
     'cocacola', 'nosvemos', 'hielo', 'montanera', 'dundalk', 'albariza', 'vinafiel', 'merino',
     'dla',
     'alq_anterior', 'alquiler', 'comunidad', 'sonidos',
     'seguros_sociales', 'impuestos',
     'gastos_extra'
   );

update public.admin_ledger_days
   set data = data - array[
     'porteros', 'limpieza', 'encargado', 'camareros',
     'rrpp', 'marketing', 'administracion', 'numier', 'gestoria',
     'butasol', 'luz', 'telefonia', 'agua',
     'fco_gonzalez', 'tec_luz',
     'cocacola', 'nosvemos', 'hielo', 'montanera', 'dundalk', 'albariza', 'vinafiel', 'merino',
     'dla',
     'alq_anterior', 'alquiler', 'comunidad', 'sonidos',
     'seguros_sociales', 'impuestos',
     'gastos_extra', 'otros_def'
   ],
       updated_at = now()
 where data ?| array[
     'porteros', 'limpieza', 'encargado', 'camareros',
     'rrpp', 'marketing', 'administracion', 'numier', 'gestoria',
     'butasol', 'luz', 'telefonia', 'agua',
     'fco_gonzalez', 'tec_luz',
     'cocacola', 'nosvemos', 'hielo', 'montanera', 'dundalk', 'albariza', 'vinafiel', 'merino',
     'dla',
     'alq_anterior', 'alquiler', 'comunidad', 'sonidos',
     'seguros_sociales', 'impuestos',
     'gastos_extra', 'otros_def'
   ];

-- Noches que se han quedado sin nada
delete from public.admin_ledger_days where data = '{}'::jsonb;

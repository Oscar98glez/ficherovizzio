-- =====================================================================
--  Proveedores: cada uno con su apartado de facturas
--  · suppliers: datos del proveedor (sólo administradores).
--  · invoices.supplier_id: a qué proveedor pertenece cada factura recibida.
--  · Las facturas que ya había se agrupan creando un proveedor por nombre.
-- =====================================================================

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,                     -- categoría de gasto por defecto de sus facturas
  tax_id      text,                     -- CIF / NIF
  contact     text,                     -- persona de contacto
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists suppliers_name_unique on public.suppliers (lower(name));

alter table public.suppliers enable row level security;

drop policy if exists suppliers_admin_all on public.suppliers;
create policy suppliers_admin_all on public.suppliers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.invoices
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
create index if not exists invoices_supplier_idx on public.invoices (supplier_id);

-- Proveedores a partir de las facturas recibidas que ya existen
insert into public.suppliers (name, category)
select distinct on (lower(trim(party))) trim(party), category
from public.invoices
where kind = 'received' and trim(coalesce(party, '')) <> ''
order by lower(trim(party)), date desc
on conflict do nothing;

update public.invoices i
   set supplier_id = s.id
  from public.suppliers s
 where i.kind = 'received' and i.supplier_id is null and lower(trim(i.party)) = lower(s.name);

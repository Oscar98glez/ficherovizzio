-- =====================================================================
--  Facturas de la empresa: datos en la tabla "invoices" y el archivo
--  (PDF o imagen) en el almacenamiento privado "invoices". Sólo administradores.
-- =====================================================================

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'received' check (kind in ('received', 'issued')),  -- recibida (proveedor) / emitida (cliente)
  party           text not null,                       -- proveedor o cliente
  number          text,                                -- nº de factura
  date            date not null default current_date,  -- fecha de la factura
  due_date        date,                                -- vencimiento
  amount          numeric(12,2) not null default 0 check (amount >= 0),  -- total con impuestos
  tax             numeric(12,2) check (tax >= 0),      -- IVA incluido en el total (opcional)
  category        text,
  status          text not null default 'pending' check (status in ('pending', 'paid')),
  notes           text,
  file_path       text not null,
  file_name       text not null,
  file_size       bigint,
  mime_type       text,
  transaction_id  uuid references public.transactions (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists invoices_date_idx on public.invoices (date);
create index if not exists invoices_status_idx on public.invoices (status);

alter table public.invoices enable row level security;

drop policy if exists invoices_admin_all on public.invoices;
create policy invoices_admin_all on public.invoices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Carpeta privada para los archivos (máx. 15 MB; PDF e imágenes)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices', 'invoices', false, 15728640,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists invoices_files_admin_select on storage.objects;
create policy invoices_files_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'invoices' and public.is_admin());

drop policy if exists invoices_files_admin_insert on storage.objects;
create policy invoices_files_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'invoices' and public.is_admin());

drop policy if exists invoices_files_admin_update on storage.objects;
create policy invoices_files_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'invoices' and public.is_admin())
  with check (bucket_id = 'invoices' and public.is_admin());

drop policy if exists invoices_files_admin_delete on storage.objects;
create policy invoices_files_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'invoices' and public.is_admin());

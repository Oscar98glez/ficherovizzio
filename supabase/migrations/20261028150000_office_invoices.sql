-- =====================================================================
--  Los administrativos ('office') también tienen el apartado Facturas:
--  ven, suben, cambian y borran facturas (con su archivo) y proveedores.
--  No tocan Finanzas (no tienen acceso a los movimientos): al guardar una
--  factura la app no les ofrece crear el movimiento.
-- =====================================================================

create or replace function public.is_office()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'office');
$$;

drop policy if exists invoices_office_all on public.invoices;
create policy invoices_office_all on public.invoices
  for all to authenticated using (public.is_office()) with check (public.is_office());

drop policy if exists suppliers_office_all on public.suppliers;
create policy suppliers_office_all on public.suppliers
  for all to authenticated using (public.is_office()) with check (public.is_office());

-- Archivos de las facturas
drop policy if exists invoices_files_office_select on storage.objects;
create policy invoices_files_office_select on storage.objects
  for select to authenticated using (bucket_id = 'invoices' and public.is_office());

drop policy if exists invoices_files_office_insert on storage.objects;
create policy invoices_files_office_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'invoices' and public.is_office());

drop policy if exists invoices_files_office_update on storage.objects;
create policy invoices_files_office_update on storage.objects
  for update to authenticated
  using (bucket_id = 'invoices' and public.is_office())
  with check (bucket_id = 'invoices' and public.is_office());

drop policy if exists invoices_files_office_delete on storage.objects;
create policy invoices_files_office_delete on storage.objects
  for delete to authenticated using (bucket_id = 'invoices' and public.is_office());

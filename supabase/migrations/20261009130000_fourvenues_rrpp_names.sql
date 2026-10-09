-- =====================================================================
--  Fourvenues: nombre de cada RRPP
--  La sincronización guarda aquí el nombre de cada RRPP tal y como está en
--  Fourvenues (de sus usuarios o de las listas), para no perderlo aunque deje
--  de salir. Fourvenues no da el nombre de algunos RRPP que sólo venden
--  entradas: a esos el administrador les pone el nombre a mano (manual).
--  Si más adelante Fourvenues da su nombre, se usa ése.
-- =====================================================================

create table if not exists public.fourvenues_rrpp_names (
  fourvenues_user_id  text primary key,
  name                text not null check (length(trim(name)) > 0),
  manual              boolean not null default false,
  updated_at          timestamptz not null default now()
);

alter table public.fourvenues_rrpp_names enable row level security;

drop policy if exists fourvenues_rrpp_names_admin_all on public.fourvenues_rrpp_names;
create policy fourvenues_rrpp_names_admin_all on public.fourvenues_rrpp_names
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Al poner el nombre a mano, se pone también en el desglose de las noches ya sincronizadas
create or replace function public.fourvenues_rrpp_name_to_nights()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.fourvenues_rrpp_nights
     set name = new.name
   where fourvenues_user_id = new.fourvenues_user_id
     and name is distinct from new.name;
  return new;
end;
$$;

drop trigger if exists fourvenues_rrpp_names_to_nights on public.fourvenues_rrpp_names;
create trigger fourvenues_rrpp_names_to_nights
  after insert or update of name on public.fourvenues_rrpp_names
  for each row execute function public.fourvenues_rrpp_name_to_nights();

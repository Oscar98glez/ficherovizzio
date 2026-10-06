-- =====================================================================
--  Conector de Claude
--  claude_connectors: enlaces secretos con los que Claude (conector MCP,
--  función "mcp") registra movimientos, facturas y proveedores. Sólo se
--  guarda el hash SHA-256 del enlace; borrar la fila lo desactiva.
-- =====================================================================

create table if not exists public.claude_connectors (
  id            uuid primary key default gen_random_uuid(),
  label         text not null default 'Claude',
  token_hash    text not null unique,      -- SHA-256 (hex) del código secreto del enlace
  token_hint    text,                      -- últimos caracteres, para reconocerlo
  created_by    uuid references auth.users (id) on delete cascade default auth.uid(),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

alter table public.claude_connectors enable row level security;

drop policy if exists claude_connectors_admin_all on public.claude_connectors;
create policy claude_connectors_admin_all on public.claude_connectors
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

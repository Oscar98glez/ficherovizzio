-- Las funciones de fichaje sólo pueden llamarlas usuarios autenticados
-- (por defecto Postgres concede EXECUTE a PUBLIC).

revoke execute on function public.clock_in(text)  from public, anon;
revoke execute on function public.clock_out(text) from public, anon;
grant  execute on function public.clock_in(text)  to authenticated;
grant  execute on function public.clock_out(text) to authenticated;

-- Crea el perfil de los usuarios que se registraron antes de instalar el trigger
-- handle_new_user() y asigna el rol de administrador a la cuenta principal.

insert into public.profiles (id, email, full_name, role)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', ''), 'worker'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles
   set role = 'admin'
 where lower(email) = 'oscar98glez@gmail.com';

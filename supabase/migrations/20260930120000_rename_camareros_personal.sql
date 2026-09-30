-- La categoría de gasto "Camareros" pasa a llamarse "Personal"
update public.transactions
   set category = 'Personal'
 where kind = 'expense'
   and category = 'Camareros';

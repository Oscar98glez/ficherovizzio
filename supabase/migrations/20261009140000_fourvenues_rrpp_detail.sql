-- =====================================================================
--  Fourvenues: desglose de cada RRPP en cada noche
--  Al pinchar un RRPP en la noche se ve lo que ha vendido: entradas por tipo
--  y precio, personas en cada lista y reservados de cortesía o pagados.
--  Lo calcula la sincronización:
--  { "tickets":  [{ "rate", "price", "people", "entered", "amount" }],
--    "lists":    [{ "rate", "people", "entered" }] | null,
--    "bookings": [{ "kind": "cortesia" | "pagado", "zone", "count", "people", "amount" }] | null }
-- =====================================================================

alter table public.fourvenues_rrpp_nights
  add column if not exists detail jsonb;

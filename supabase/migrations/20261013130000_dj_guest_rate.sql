-- DJ / técnicos que vienen de invitados: tarifa aparte.
-- Cada DJ tiene su tarifa de residente (hourly_rate) y, si se le pone, la de invitado (guest_rate).
-- En cada fichaje se marca si vino de invitado; la tarifa del fichaje (hourly_rate) pasa a ser la de
-- invitado, así que nóminas, costes y lo ganado se calculan igual que hasta ahora.

alter table public.employees add column if not exists guest_rate numeric(10,2) check (guest_rate >= 0);

alter table public.time_entries add column if not exists guest boolean not null default false;

-- =====================================================================
--  Extras de los sobres: quien trabaja una noche y no tiene ficha ni cuenta en la app
--  (porteros, extras de barra, embajadoras, reparto…). Van en su sección de Sueldos con sus
--  horas; el precio por hora (o un importe fijo) lo pone el administrador.
-- =====================================================================

create table if not exists public.wage_extras (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,                                   -- la noche (día en que empieza)
  section     text not null check (section in ('camareras', 'bandejas', 'dj', 'embajadoras', 'otros', 'porteros')),
  name        text not null check (length(trim(name)) > 0),
  clock_in    text check (clock_in ~ '^\d{2}:\d{2}$'),       -- HH:MM (hora española)
  clock_out   text check (clock_out ~ '^\d{2}:\d{2}$'),
  hours       numeric(5,2) not null default 0 check (hours >= 0),
  rate        numeric(10,2) not null default 0 check (rate >= 0),  -- €/h
  amount      numeric(10,2) check (amount >= 0),                    -- importe fijo (en lugar de horas × precio)
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists wage_extras_date_idx on public.wage_extras (date);

alter table public.wage_extras enable row level security;

drop policy if exists wage_extras_admin_all on public.wage_extras;
create policy wage_extras_admin_all on public.wage_extras
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Semana del 7 al 11 de octubre de 2026, según las hojas de firmas (precio por hora a 0: lo pone el administrador)
insert into public.wage_extras (date, section, name, clock_in, clock_out, hours, amount, notes)
select v.date::date, v.section, v.name, v.clock_in, v.clock_out, v.hours, v.amount, v.notes
from (values
  ('2026-10-07', 'porteros',    'Borja',                       '23:00', '05:00', 6.0, null::numeric, null::text),
  ('2026-10-08', 'porteros',    'Borja',                       '23:00', '05:30', 6.5, null, null),
  ('2026-10-09', 'porteros',    'Borja',                       '00:00', '06:00', 6.0, null, null),
  ('2026-10-10', 'porteros',    'Borja',                       '00:00', '06:30', 6.5, null, null),
  ('2026-10-08', 'porteros',    'Fernando',                    '23:00', '05:30', 6.5, null, null),
  ('2026-10-09', 'porteros',    'Fernando',                    '00:00', '06:00', 6.0, null, null),
  ('2026-10-10', 'porteros',    'Fernando',                    '00:00', '06:30', 6.5, null, null),
  ('2026-10-11', 'porteros',    'Fernando',                    '00:00', '06:00', 6.0, null, null),
  ('2026-10-08', 'porteros',    'Abdou',                       '23:00', '05:30', 6.5, null, null),
  ('2026-10-09', 'porteros',    'Abdou',                       '00:00', '06:00', 6.0, null, null),
  ('2026-10-10', 'porteros',    'Abdou',                       '00:00', '06:30', 6.5, null, null),
  ('2026-10-08', 'porteros',    'Gallego',                     '23:00', '05:30', 6.5, null, null),
  ('2026-10-11', 'porteros',    'Gallego',                     '00:00', '06:00', 6.0, null, null),
  ('2026-10-09', 'porteros',    'Diego',                       '00:00', '06:00', 6.0, null, null),
  ('2026-10-09', 'porteros',    'Ismael',                      '00:00', '06:00', 6.0, null, null),
  ('2026-10-08', 'camareras',   'Alexandra Martínez Roca Rey', '23:00', '05:00', 6.0, null, null),
  ('2026-10-09', 'camareras',   'Rosario Mestre',              '00:00', '05:30', 5.5, null, null),
  ('2026-10-09', 'bandejas',    'Manuel',                      '01:00', '04:00', 3.0, null, null),
  ('2026-10-11', 'bandejas',    'Manuel',                      '01:30', '06:30', 5.0, null, null),
  ('2026-10-11', 'dj',          'Jesús Morón',                 '00:00', '06:00', 6.0, null, null),
  ('2026-10-09', 'dj',          'Keko',                        null,    null,    0.0, 120,  '120 € fijos'),
  ('2026-10-08', 'embajadoras', 'Judit',                       '21:30', '23:30', 2.0, null, null),
  ('2026-10-08', 'embajadoras', 'Lucía',                       '21:30', '23:30', 2.0, null, null),
  ('2026-10-08', 'embajadoras', 'Paola González (vídeos)',     '01:30', '03:30', 2.0, null, null),
  ('2026-10-09', 'embajadoras', 'Teresa',                      '22:30', '00:30', 2.0, null, null),
  ('2026-10-09', 'embajadoras', 'Fati',                        '22:30', '00:30', 2.0, null, null),
  ('2026-10-10', 'embajadoras', 'Malena (reparto)',            null,    null,    2.0, null, 'Reparto: 2 horas'),
  ('2026-10-10', 'embajadoras', 'María García (reparto)',      null,    null,    2.0, null, 'Reparto: 2 horas'),
  ('2026-10-08', 'otros',       'Gonzalo Pérez-Lombard',       '02:00', '04:00', 2.0, null, null)
) as v(date, section, name, clock_in, clock_out, hours, amount, notes)
where not exists (select 1 from public.wage_extras where date between '2026-10-07' and '2026-10-11');

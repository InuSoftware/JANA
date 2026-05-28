-- Copia fechamentos antigos (daily_closes) para shifts, preservando id e snapshot.
-- Rode APOS 003_shifts.sql. Seguro rodar mais de uma vez (ignora ids ja existentes em shifts).

insert into public.shifts (
  id,
  user_id,
  reference_date,
  scheduled_start,
  scheduled_end,
  window_start_at,
  window_end_at,
  started_at,
  ended_at,
  status,
  payload
)
select
  dc.id,
  dc.user_id,
  dc.date_ymd,
  (dc.closed_at at time zone 'America/Sao_Paulo')::time as scheduled_start,
  (dc.closed_at at time zone 'America/Sao_Paulo')::time as scheduled_end,
  coalesce(
    (
      select min((s->>'closedAt')::timestamptz)
      from jsonb_array_elements(coalesce(dc.payload->'sales', '[]'::jsonb)) as s
      where (s->>'closedAt') is not null and (s->>'closedAt') <> ''
    ),
    (dc.date_ymd::timestamp at time zone 'America/Sao_Paulo')
  ) as window_start_at,
  dc.closed_at as window_end_at,
  coalesce(
    (
      select min((s->>'closedAt')::timestamptz)
      from jsonb_array_elements(coalesce(dc.payload->'sales', '[]'::jsonb)) as s
      where (s->>'closedAt') is not null and (s->>'closedAt') <> ''
    ),
    (dc.date_ymd::timestamp at time zone 'America/Sao_Paulo')
  ) as started_at,
  dc.closed_at as ended_at,
  'fechado',
  jsonb_build_object(
    'closeSnapshot',
    dc.payload,
    'migratedFromDailyClose',
    true
  )
from public.daily_closes dc
where not exists (select 1 from public.shifts s where s.id = dc.id);

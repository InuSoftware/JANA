-- Turnos operacionais (ex.: 18h–02h com data de referencia 26/05)

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reference_date date not null,
  scheduled_start time not null,
  scheduled_end time not null,
  window_start_at timestamptz not null,
  window_end_at timestamptz not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists shifts_user_id_idx on public.shifts (user_id);
create index if not exists shifts_user_status_idx on public.shifts (user_id, status);
create index if not exists shifts_user_reference_date_idx on public.shifts (user_id, reference_date desc);

alter table public.shifts enable row level security;

drop policy if exists "shifts_all_own" on public.shifts;
create policy "shifts_all_own"
  on public.shifts for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.commandas
  add column if not exists shift_id uuid references public.shifts (id) on delete set null;

create index if not exists commandas_shift_id_idx on public.commandas (shift_id);

grant select, insert, update, delete on public.shifts to anon, authenticated;

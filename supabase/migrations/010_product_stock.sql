-- Estoque por produto (tabela nova; não altera public.products)

create table if not exists public.product_stock (
  product_id uuid primary key references public.products (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quantity integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists product_stock_user_id_idx on public.product_stock (user_id);

drop trigger if exists product_stock_set_updated_at on public.product_stock;
create trigger product_stock_set_updated_at
  before update on public.product_stock
  for each row execute function public.set_updated_at();

alter table public.product_stock enable row level security;

drop policy if exists "product_stock_all_own" on public.product_stock;
create policy "product_stock_all_own"
  on public.product_stock for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

insert into public.product_stock (product_id, user_id, quantity)
select p.id, p.user_id, 0
from public.products p
on conflict (product_id) do nothing;

create or replace function public.adjust_product_stock(p_product_id uuid, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.user_id = v_uid
  ) then
    raise exception 'product not found';
  end if;
  insert into public.product_stock (product_id, user_id, quantity)
  values (p_product_id, v_uid, coalesce(p_delta, 0))
  on conflict (product_id) do update
  set quantity = product_stock.quantity + excluded.quantity,
      updated_at = now();
end;
$$;

create or replace function public.set_product_stock(p_product_id uuid, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.user_id = v_uid
  ) then
    raise exception 'product not found';
  end if;
  insert into public.product_stock (product_id, user_id, quantity)
  values (p_product_id, v_uid, coalesce(p_quantity, 0))
  on conflict (product_id) do update
  set quantity = excluded.quantity,
      updated_at = now();
end;
$$;

revoke all on function public.adjust_product_stock(uuid, integer) from public;
revoke all on function public.set_product_stock(uuid, integer) from public;
grant execute on function public.adjust_product_stock(uuid, integer) to anon, authenticated;
grant execute on function public.set_product_stock(uuid, integer) to anon, authenticated;

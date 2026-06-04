-- Itens especiais (compostos): debitam estoque de outros produtos; opcionalmente exibem estoque de um insumo na comanda.

alter table public.products
  add column if not exists is_special boolean not null default false,
  add column if not exists stock_component_ids uuid[] not null default '{}',
  add column if not exists stock_display_product_id uuid references public.products (id) on delete set null;

comment on column public.products.is_special is 'Venda debita stock_component_ids em vez do proprio produto.';
comment on column public.products.stock_component_ids is 'Produtos cujo estoque e debitado/restaurado por unidade vendida.';
comment on column public.products.stock_display_product_id is 'Produto cujo saldo aparece no catalogo da comanda (ex.: pao no cachorro-quente).';

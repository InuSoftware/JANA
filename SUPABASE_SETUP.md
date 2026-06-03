# Supabase — setup e GitHub Pages

## 1) Projeto no Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, execute os arquivos nesta ordem:
   - [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql)
   - [supabase/migrations/002_api_grants.sql](supabase/migrations/002_api_grants.sql)
   - [supabase/migrations/003_shifts.sql](supabase/migrations/003_shifts.sql) — sessões de caixa e `commandas.shift_id`
   - (opcional) [supabase/migrations/004_migrate_daily_closes_to_shifts.sql](supabase/migrations/004_migrate_daily_closes_to_shifts.sql) — copia os fechamentos antigos de `daily_closes` para `shifts` (mesmos ids). O app já mostra `daily_closes` no histórico e no relatório **Fechamentos de caixa** mesmo sem rodar o 004.
   - [supabase/migrations/010_product_stock.sql](supabase/migrations/010_product_stock.sql) — estoque por produto (`product_stock` + funções `adjust_product_stock` / `set_product_stock`). Não altera `products`.
3. Se as rotas da API retornarem **403** depois de criar tabelas novas, rode `002_api_grants.sql` novamente.

### Schema Fase A (PK `uuid`)

As tabelas `products`, `commandas` e `daily_closes` usam **`uuid`** como chave primária (`gen_random_uuid()` no Postgres). `commandas` e `daily_closes` têm colunas extras para consulta (`status`, `created_at`, `closed_at`, `date_ymd`, etc.) além do JSON em `payload`.

**Primeira instalação:** cole o SQL inteiro em um projeto novo.

**Se você já tinha rodado uma versão antiga deste migration** (PK `text`), precisa **apagar ou recriar** as tabelas de dados antes — o script atual faz `DROP TABLE IF EXISTS` de `daily_closes`, `commandas` e `products` (os dados nessas tabelas são removidos). `profiles` e `app_config` são preservados quando já existem.

4. Se o trigger der erro de sintaxe (`execute function` / `procedure`), ajuste a última linha do trigger conforme a versão do Postgres do projeto (no editor de SQL do Supabase costuma funcionar com `execute function public.handle_new_user();`).

## 2) Usuário (Auth)

1. **Authentication → Users → Add user** — crie um usuário com **email** e **senha** (uso pessoal: pode desabilitar confirmação de email em *Authentication → Providers → Email* se quiser fluxo simples).
2. O perfil em `profiles` é criado automaticamente pelo trigger (ou na primeira sessão do app). Ajuste `role` em `profiles` se precisar (`Atendente` ou `Gerente`).

## 3) Chaves no app (front)

1. Crie `supabase-config.js` na raiz do projeto (este arquivo está no `.gitignore` e **não** deve ir para o repositório).
2. Preencha `window.__SUPABASE_URL__` e `window.__SUPABASE_ANON_KEY__` (Settings → API — **anon public**, nunca `service_role` no navegador). Use a **Project URL** sem `/rest/v1` no final.

Exemplo:

```js
window.__SUPABASE_URL__ = "https://xxxx.supabase.co";
window.__SUPABASE_ANON_KEY__ = "eyJ...";
```

**GitHub Pages:** o workflow [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) gera `supabase-config.js` no deploy a partir dos secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY` (Settings → Secrets → Actions).

## 4) URLs para login (GitHub Pages e local)

Em **Authentication → URL configuration**:

- **Site URL**: `https://<usuario>.github.io/<repo>/` (ou a URL exata do seu site).
- **Redirect URLs**: inclua a mesma URL e `http://localhost:*` se testar com servidor local.

## 5) JWT

O Supabase Auth guarda a sessão no navegador e envia o **JWT** automaticamente nas chamadas ao PostgREST. Não é necessário (nem seguro) tratar o JWT manualmente no app; o isolamento dos dados vem do **RLS** com `auth.uid()`.

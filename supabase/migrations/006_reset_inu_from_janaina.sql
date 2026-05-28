-- Reseta o ambiente de testes (inu): apaga TUDO do inu e recopia da janaina (produção).
-- A janaina NÃO é alterada. Seguro rodar quantas vezes quiser.
-- Rode no Supabase → SQL Editor.

DO $$
DECLARE
  src uuid := '639e47fd-5cea-44ff-81a8-1bfb488011ee'; -- janaina@mail.com (produção)
  tgt uuid := 'a3b3f06e-a03a-4f78-b618-21d4723461e7'; -- inu@mail.com (testes)
BEGIN
  CREATE TEMP TABLE product_map (
    old_id uuid PRIMARY KEY,
    new_id uuid NOT NULL DEFAULT gen_random_uuid()
  ) ON COMMIT DROP;

  CREATE TEMP TABLE commanda_map (
    old_id uuid PRIMARY KEY,
    new_id uuid NOT NULL DEFAULT gen_random_uuid()
  ) ON COMMIT DROP;

  CREATE TEMP TABLE shift_map (
    old_id uuid PRIMARY KEY,
    new_id uuid NOT NULL DEFAULT gen_random_uuid()
  ) ON COMMIT DROP;

  INSERT INTO product_map (old_id)
  SELECT id FROM public.products WHERE user_id = src;

  INSERT INTO commanda_map (old_id)
  SELECT id FROM public.commandas WHERE user_id = src;

  INSERT INTO shift_map (old_id)
  SELECT id FROM public.shifts WHERE user_id = src;

  -- 1) Limpa tudo do inu (inclui caixa aberto, comandas de teste, etc.)
  DELETE FROM public.commandas WHERE user_id = tgt;
  DELETE FROM public.daily_closes WHERE user_id = tgt;
  DELETE FROM public.shifts WHERE user_id = tgt;
  DELETE FROM public.products WHERE user_id = tgt;
  DELETE FROM public.app_config WHERE user_id = tgt;

  -- 2) Copia produtos da janaina
  INSERT INTO public.products (id, user_id, name, category, price, requires_prep, created_at, updated_at)
  SELECT pm.new_id, tgt, p.name, p.category, p.price, p.requires_prep, p.created_at, p.updated_at
  FROM public.products p
  JOIN product_map pm ON pm.old_id = p.id
  WHERE p.user_id = src;

  -- 3) Copia turnos / fechamentos
  INSERT INTO public.shifts (
    id, user_id, reference_date, scheduled_start, scheduled_end,
    window_start_at, window_end_at, started_at, ended_at, status, payload
  )
  SELECT
    sm.new_id,
    tgt,
    s.reference_date,
    s.scheduled_start,
    s.scheduled_end,
    s.window_start_at,
    s.window_end_at,
    s.started_at,
    s.ended_at,
    s.status,
    CASE
      WHEN s.payload ? 'closeSnapshot' THEN
        jsonb_set(
          jsonb_set(
            s.payload,
            '{closeSnapshot,id}',
            to_jsonb(sm.new_id::text),
            false
          ),
          '{closeSnapshot,sales}',
          COALESCE(
            (
              SELECT jsonb_agg(
                CASE
                  WHEN cm.new_id IS NOT NULL
                    THEN jsonb_set(sale, '{orderId}', to_jsonb(cm.new_id::text), false)
                  ELSE sale
                END
              )
              FROM jsonb_array_elements(s.payload->'closeSnapshot'->'sales') AS sale
              LEFT JOIN commanda_map cm ON cm.old_id = NULLIF(sale->>'orderId', '')::uuid
            ),
            '[]'::jsonb
          ),
          false
        )
      ELSE s.payload
    END
  FROM public.shifts s
  JOIN shift_map sm ON sm.old_id = s.id
  WHERE s.user_id = src;

  -- 4) Copia comandas (lançamentos)
  INSERT INTO public.commandas (
    id, user_id, payload, status, created_at, updated_at, closed_at, shift_id
  )
  SELECT
    cm.new_id,
    tgt,
    CASE
      WHEN o.payload ? 'items' THEN
        jsonb_set(
          o.payload,
          '{items}',
          COALESCE(
            (
              SELECT jsonb_agg(
                CASE
                  WHEN pm.new_id IS NOT NULL
                    THEN jsonb_set(item, '{productId}', to_jsonb(pm.new_id::text), false)
                  ELSE item
                END
              )
              FROM jsonb_array_elements(o.payload->'items') AS item
              LEFT JOIN product_map pm ON pm.old_id = NULLIF(item->>'productId', '')::uuid
            ),
            '[]'::jsonb
          ),
          false
        )
      ELSE o.payload
    END,
    o.status,
    o.created_at,
    o.updated_at,
    o.closed_at,
    CASE WHEN o.shift_id IS NOT NULL THEN sm.new_id ELSE NULL END
  FROM public.commandas o
  JOIN commanda_map cm ON cm.old_id = o.id
  LEFT JOIN shift_map sm ON sm.old_id = o.shift_id
  WHERE o.user_id = src;

  -- 5) Copia fechamentos legados (daily_closes)
  INSERT INTO public.daily_closes (id, user_id, payload, closed_at, date_ymd)
  SELECT
    gen_random_uuid(),
    tgt,
    jsonb_set(
      jsonb_set(
        dc.payload,
        '{id}',
        to_jsonb(gen_random_uuid()::text),
        false
      ),
      '{sales}',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN cm.new_id IS NOT NULL
                THEN jsonb_set(sale, '{orderId}', to_jsonb(cm.new_id::text), false)
              ELSE sale
            END
          )
          FROM jsonb_array_elements(dc.payload->'sales') AS sale
          LEFT JOIN commanda_map cm ON cm.old_id = NULLIF(sale->>'orderId', '')::uuid
        ),
        '[]'::jsonb
      ),
      false
    ),
    dc.closed_at,
    dc.date_ymd
  FROM public.daily_closes dc
  WHERE dc.user_id = src;

  -- 6) Copia configurações do app (opcional — espelha produção)
  INSERT INTO public.app_config (user_id, payload)
  SELECT tgt, payload
  FROM public.app_config
  WHERE user_id = src;
END $$;

-- Conferência (deve bater janaina vs inu):
-- SELECT 'products' AS tbl, user_id, count(*) FROM public.products GROUP BY user_id
-- UNION ALL SELECT 'commandas', user_id, count(*) FROM public.commandas GROUP BY user_id
-- UNION ALL SELECT 'shifts', user_id, count(*) FROM public.shifts GROUP BY user_id
-- ORDER BY tbl, user_id;

-- Fechamentos legados (daily_closes) da janaina — noites 27/05 e madrugada 28/05.
-- NÃO inclui vendas de hoje (28/05 à noite em diante).
-- Seguro rodar de novo: faz backup temp, apaga 27/05 e 28/05, reinsere, remove backup temp.
--
-- janaina@mail.com = 639e47fd-5cea-44ff-81a8-1bfb488011ee

DO $$
DECLARE
  uid uuid := '639e47fd-5cea-44ff-81a8-1bfb488011ee';
  sales27 jsonb;
  sales28 jsonb;
  bruto27 numeric;
  bruto28 numeric;
  fin27 int;
  fin28 int;
  closed27 timestamptz;
  closed28 timestamptz;
  bkp_count int;
BEGIN
  DROP TABLE IF EXISTS pg_temp._bkp_janaina_dc_27_28;

  CREATE TEMP TABLE _bkp_janaina_dc_27_28 (
    LIKE public.daily_closes INCLUDING ALL
  ) ON COMMIT DROP;

  INSERT INTO _bkp_janaina_dc_27_28 (id, user_id, payload, closed_at, date_ymd)
  SELECT id, user_id, payload, closed_at, date_ymd
  FROM public.daily_closes
  WHERE user_id = uid
    AND date_ymd IN (DATE '2026-05-27', DATE '2026-05-28');

  GET DIAGNOSTICS bkp_count = ROW_COUNT;
  RAISE NOTICE 'Backup temp: % fechamento(s) 27/05 ou 28/05 copiado(s)', bkp_count;

  DELETE FROM public.daily_closes
  WHERE user_id = uid AND date_ymd IN (DATE '2026-05-27', DATE '2026-05-28');

  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'orderId', c.id,
        'customer', coalesce(nullif(trim(c.payload->>'customer'), ''), 'Cliente sem nome'),
        'totalPaid', coalesce((c.payload->>'totalPaid')::numeric, 0),
        'paymentMethods', coalesce(c.payload->'paymentMethods', '[]'::jsonb),
        'itemsCount', coalesce((
          SELECT sum(coalesce((item->>'qty')::int, 0))
          FROM jsonb_array_elements(coalesce(c.payload->'items', '[]'::jsonb)) AS item
        ), 0),
        'closedAt', c.closed_at
      )
      ORDER BY c.closed_at
    ), '[]'::jsonb),
    coalesce(sum(coalesce((c.payload->>'totalPaid')::numeric, 0)), 0),
    count(*),
    max(c.closed_at)
  INTO sales27, bruto27, fin27, closed27
  FROM public.commandas c
  WHERE c.user_id = uid
    AND c.status = 'Finalizado'
    AND (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-05-27';

  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'orderId', c.id,
        'customer', coalesce(nullif(trim(c.payload->>'customer'), ''), 'Cliente sem nome'),
        'totalPaid', coalesce((c.payload->>'totalPaid')::numeric, 0),
        'paymentMethods', coalesce(c.payload->'paymentMethods', '[]'::jsonb),
        'itemsCount', coalesce((
          SELECT sum(coalesce((item->>'qty')::int, 0))
          FROM jsonb_array_elements(coalesce(c.payload->'items', '[]'::jsonb)) AS item
        ), 0),
        'closedAt', c.closed_at
      )
      ORDER BY c.closed_at
    ), '[]'::jsonb),
    coalesce(sum(coalesce((c.payload->>'totalPaid')::numeric, 0)), 0),
    count(*),
    max(c.closed_at)
  INTO sales28, bruto28, fin28, closed28
  FROM public.commandas c
  WHERE c.user_id = uid
    AND c.status = 'Finalizado'
    AND (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-05-28'
    AND (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::time < TIME '12:00:00';

  IF fin27 = 0 THEN
    RAISE EXCEPTION 'Nenhuma venda encontrada para fechamento 2026-05-27';
  END IF;

  IF fin28 = 0 THEN
    RAISE EXCEPTION 'Nenhuma venda de madrugada encontrada para fechamento 2026-05-28';
  END IF;

  INSERT INTO public.daily_closes (id, user_id, payload, closed_at, date_ymd)
  VALUES (
    gen_random_uuid(),
    uid,
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'dateYmd', '2026-05-27',
      'closedAt', closed27,
      'totalBruto', bruto27,
      'finalizedOrdersCount', fin27,
      'activeOrdersCount', 0,
      'sales', sales27
    ),
    closed27,
    DATE '2026-05-27'
  );

  INSERT INTO public.daily_closes (id, user_id, payload, closed_at, date_ymd)
  VALUES (
    gen_random_uuid(),
    uid,
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'dateYmd', '2026-05-28',
      'closedAt', closed28,
      'totalBruto', bruto28,
      'finalizedOrdersCount', fin28,
      'activeOrdersCount', 0,
      'sales', sales28
    ),
    closed28,
    DATE '2026-05-28'
  );

  RAISE NOTICE 'Fechamento 27/05: % comandas, R$ %', fin27, bruto27;
  RAISE NOTICE 'Fechamento 28/05 (madrugada): % comandas, R$ %', fin28, bruto28;

  DROP TABLE IF EXISTS _bkp_janaina_dc_27_28;
  RAISE NOTICE 'Backup temp removido.';
END $$;

-- Conferência:
-- SELECT date_ymd, payload->>'finalizedOrdersCount' AS fin, payload->>'totalBruto' AS bruto, closed_at
-- FROM public.daily_closes
-- WHERE user_id = '639e47fd-5cea-44ff-81a8-1bfb488011ee' AND date_ymd IN ('2026-05-27', '2026-05-28');

-- Desfazer (remove só os fechamentos 27/28; comandas intactas):
-- DELETE FROM public.daily_closes
-- WHERE user_id = '639e47fd-5cea-44ff-81a8-1bfb488011ee'
--   AND date_ymd IN ('2026-05-27', '2026-05-28');

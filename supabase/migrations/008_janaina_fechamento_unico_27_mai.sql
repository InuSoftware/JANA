-- Corrige: uma noite única (27→madrugada 28) = UM fechamento só (data ref. 27/05).
-- Remove os dois fechamentos separados (27 + 28) e cria um com 26 vendas / R$ 1194.
-- janaina@mail.com = 639e47fd-5cea-44ff-81a8-1bfb488011ee

DO $$
DECLARE
  uid uuid := '639e47fd-5cea-44ff-81a8-1bfb488011ee';
  sales jsonb;
  bruto numeric;
  fin int;
  closed_at_last timestamptz;
  bkp_count int;
BEGIN
  DROP TABLE IF EXISTS pg_temp._bkp_janaina_dc_27_28_unificado;

  CREATE TEMP TABLE _bkp_janaina_dc_27_28_unificado (
    LIKE public.daily_closes INCLUDING ALL
  ) ON COMMIT DROP;

  INSERT INTO _bkp_janaina_dc_27_28_unificado (id, user_id, payload, closed_at, date_ymd)
  SELECT id, user_id, payload, closed_at, date_ymd
  FROM public.daily_closes
  WHERE user_id = uid
    AND date_ymd IN (DATE '2026-05-27', DATE '2026-05-28');

  GET DIAGNOSTICS bkp_count = ROW_COUNT;
  RAISE NOTICE 'Backup temp: % fechamento(s) copiado(s)', bkp_count;

  DELETE FROM public.daily_closes
  WHERE user_id = uid
    AND date_ymd IN (DATE '2026-05-27', DATE '2026-05-28');

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
  INTO sales, bruto, fin, closed_at_last
  FROM public.commandas c
  WHERE c.user_id = uid
    AND c.status = 'Finalizado'
    AND (
      (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-05-27'
      OR (
        (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-05-28'
        AND (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::time < TIME '12:00:00'
      )
    );

  IF fin = 0 THEN
    RAISE EXCEPTION 'Nenhuma venda encontrada para a noite 27/05';
  END IF;

  INSERT INTO public.daily_closes (id, user_id, payload, closed_at, date_ymd)
  VALUES (
    gen_random_uuid(),
    uid,
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'dateYmd', '2026-05-27',
      'closedAt', closed_at_last,
      'totalBruto', bruto,
      'finalizedOrdersCount', fin,
      'activeOrdersCount', 0,
      'sales', sales
    ),
    closed_at_last,
    DATE '2026-05-27'
  );

  RAISE NOTICE 'Fechamento unico 27/05: % comandas, R$ % (noite 27 + madrugada 28)', fin, bruto;

  DROP TABLE IF EXISTS _bkp_janaina_dc_27_28_unificado;
END $$;

-- Conferência (deve ser 1 linha):
-- SELECT date_ymd, payload->>'finalizedOrdersCount' AS fin, payload->>'totalBruto' AS bruto
-- FROM public.daily_closes
-- WHERE user_id = '639e47fd-5cea-44ff-81a8-1bfb488011ee' AND date_ymd IN ('2026-05-27', '2026-05-28');

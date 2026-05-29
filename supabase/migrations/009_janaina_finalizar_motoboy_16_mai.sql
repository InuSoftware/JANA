-- Finaliza comanda aberta "Motoboy pago" (dia 16/05) alinhada ao fechamento existente.
-- Criada: 16/05/2026 21:21 (BR) | Fechamento original: 16/05/2026 21:41 (BR)
-- janaina@mail.com = 639e47fd-5cea-44ff-81a8-1bfb488011ee

DO $$
DECLARE
  uid uuid := '639e47fd-5cea-44ff-81a8-1bfb488011ee';
  oid uuid := '9f5babad-a2bf-4250-9b65-8266354ec0fc';
  closed timestamptz := '2026-05-17T00:41:11.926+00'; -- 16/05 21:41 BR
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.commandas
    WHERE id = oid AND user_id = uid AND status = 'Aberta'
  ) THEN
    RAISE EXCEPTION 'Comanda Motoboy pago nao encontrada ou ja finalizada';
  END IF;

  UPDATE public.commandas
  SET
    status = 'Finalizado',
    closed_at = closed,
    payload = payload
      || jsonb_build_object(
        'status', 'Finalizado',
        'totalPaid', 24,
        'closedAt', closed,
        'paymentMethods', '["Dinheiro"]'::jsonb
      )
  WHERE id = oid AND user_id = uid;

  RAISE NOTICE 'Motoboy pago finalizada — dia ref. 16/05, fechou 16/05 21:41 (BR), R$ 24';
END $$;

-- Conferência:
-- SELECT status, closed_at, closed_at AT TIME ZONE 'America/Sao_Paulo' AS fechou_br,
--        payload->>'totalPaid' AS total, payload->>'customer' AS customer
-- FROM public.commandas WHERE id = '9f5babad-a2bf-4250-9b65-8266354ec0fc';

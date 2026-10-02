-- INVERSO de supabase/migrations/20261025200000_saldo_picker_rolo_regra_core.sql (achados MEDIOS R15a, B1 do R11).
-- Devolve o texto de ANTES de ocs_disponiveis_variante (OC recebida = COALESCE(recebida,0)) e de ocs_para_rolo
-- (COALESCE(recebida, pedida), sem a excecao da troca).
-- Guarda: so roda se as 2 estao EXATAMENTE com o texto da ida (md5 de depois) e saldo_oc_item_m segue o da R11; outro ->
-- P0001 e nada muda (rodar 2x = a 2a recusa). Nada gravado muda.
-- Ordem geral: LIFO da APLICACAO (roda ANTES do inverso da 20261025100000 e do da R11). Se a R11 for desfeita, este vem antes.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r15b1_acl ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS s, p.proacl::text AS acl FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.ocs_disponiveis_variante(uuid,uuid)'), to_regprocedure('public.ocs_para_rolo()'));

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.ocs_disponiveis_variante(uuid,uuid)', 'a0bcbbe2f7930c946628b583347e2d60'),
      ('public.ocs_para_rolo()',                     '1c3457bdbfab53114e39b78d382e598c'),
      ('public.saldo_oc_item_m(uuid)',               '873789084182322f0b28b315d06b0dbc')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r15a_b1 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r15a_b1 (volta): % nao esta com o texto esperado da 20261025200000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public.ocs_disponiveis_variante(_variante_id uuid, _modelo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recebida DESC, data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.numero_pedido,
      COALESCE(oc.is_rolo, false) AS is_rolo,
      oc.rolo_codigo,
      oc.rolo_origem_item_id,
      oc_org.id AS oc_origem_id,
      oc_org.numero_pedido AS oc_origem_numero,
      oc.data_entrega,
      oc.created_at,
      (oc.status = 'recebido') AS recebida,
      (
        (CASE
           WHEN oc.status = 'recebido' THEN
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_recebida,0) END
           ELSE
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_pedida,0) END
         END)
        - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
        - COALESCE((
            -- reserva o quantidade_m ALOCADO por vínculo (não a necessidade cheia) — senão, quando a
            -- variante é coberta por 2+ OCs, cada item reservava o total → disponibilidade fantasma.
            SELECT SUM(COALESCE(l.quantidade_m, 0))
            FROM public.modelo_tecido_oc_links l
            WHERE l.oc_tecido_item_id = it.id
              AND (_modelo_id IS NULL OR l.modelo_id <> _modelo_id)
              AND NOT EXISTS (
                SELECT 1 FROM public.cad c
                JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
                WHERE c.modelo_id = l.modelo_id
              )
          ),0)
      ) AS disponivel_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.ocs_tecido_itens oit_org ON oit_org.id = oc.rolo_origem_item_id
    LEFT JOIN public.ocs_tecido oc_org ON oc_org.id = oit_org.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND it.variante_tecido_id = _variante_id
      AND COALESCE(it.cancelado, false) = false
      -- só itens cujo artigo do ITEM casa com o artigo REAL da variante (ignora itens legados mal-rotulados
      -- pelo cross-artigo — senão uma OC de outro tecido aparecia no picker desta variante)
      AND it.artigo_id = COALESCE((SELECT v.artigo_id FROM public.variantes_tecido v WHERE v.id = _variante_id), it.artigo_id)
  ) t;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ocs_para_rolo()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(oc_row ORDER BY is_rolo, label), '[]'::jsonb)
  FROM (
    SELECT COALESCE(oc.is_rolo, false) AS is_rolo,
      (CASE WHEN oc.is_rolo THEN COALESCE(oc.rolo_codigo, oc.numero_pedido) ELSE oc.numero_pedido END) AS label,
      jsonb_build_object(
        'oc_id', oc.id,
        'numero_pedido', oc.numero_pedido,
        'is_rolo', COALESCE(oc.is_rolo, false),
        'label', (CASE WHEN oc.is_rolo THEN COALESCE(oc.rolo_codigo, oc.numero_pedido) ELSE oc.numero_pedido END),
        'itens', itens.arr
      ) AS oc_row
    FROM public.ocs_tecido oc
    JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'oc_tecido_item_id', it.id,
               'artigo_id', it.artigo_id,
               'artigo_nome', a.nome,
               'variante_tecido_id', it.variante_tecido_id,
               'variante', COALESCE(
                             NULLIF(concat_ws(' - ', NULLIF(btrim(cb.nome), ''), NULLIF(btrim(ca.nome), '')), ''),
                             vt.nome_variante, vt.codigo_variante, '—'),
               'disponivel_m', disp.m
             ) ORDER BY a.nome, cb.nome, ca.nome, vt.nome_variante) AS arr
      FROM public.ocs_tecido_itens it
      LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
      LEFT JOIN public.cores cb ON cb.id = vt.cor_id
      LEFT JOIN public.cores_apelido ca ON ca.id = vt.cor_apelido_id
      LEFT JOIN public.artigos a ON a.id = it.artigo_id
      CROSS JOIN LATERAL (
        SELECT (CASE WHEN a.unidade_medida = 'kg'
                     THEN COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.rendimento,0)
                     ELSE COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) END)
               - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0) AS m
      ) disp
      WHERE it.oc_tecido_id = oc.id
        AND it.variante_tecido_id IS NOT NULL
        AND COALESCE(it.cancelado, false) = false
        AND disp.m > 0.0001
    ) itens ON itens.arr IS NOT NULL
    WHERE oc.tenant_id = public.get_user_tenant_id()
      AND oc.status = 'recebido'
  ) t;
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.ocs_disponiveis_variante(uuid,uuid)', '9490322586a3408d62eee74fd0aea484'),
      ('public.ocs_para_rolo()',                     'bd666c0ee53370caf3f6873218609ea0')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r15a_b1 (volta): pos-condicao falhou - % nao voltou ao texto de antes', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM _r15b1_acl a JOIN pg_proc p ON p.oid = to_regprocedure(a.s) WHERE p.proacl::text IS DISTINCT FROM a.acl) THEN
    RAISE EXCEPTION 'medios_r15a_b1 (volta): a ACL dos pickers mudou' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.ocs_disponiveis_variante(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r15a_b1 (volta): ocs_disponiveis_variante ficou executavel por anon' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

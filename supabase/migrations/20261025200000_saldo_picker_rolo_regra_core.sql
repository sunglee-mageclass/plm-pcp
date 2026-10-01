-- Achados MEDIOS, release R15a (estoque de tecido; so banco, sem site) - parte 2: B1 do R11 (backlog da G-MIGRATION R11).
-- Os 2 pickers de saldo por item passam a usar a regra do core (inv. #4, R11: saldo_oc_item_m):
--   ocs_disponiveis_variante (picker de VINCULO OC x card - TecidosBomSecao.tsx:640 e ModeloTecidosSection.tsx:620): em OC
--     RECEBIDA usava COALESCE(quantidade_recebida, 0) -> item recebido sem quantidade aparecia com 0 disponivel (Ave Rara:
--     MALHA BEGONIA CHOCOLATE 160,9 kg = 547 m) enquanto o corte ja consome a pedida. Agora, OC recebida = saldo_oc_item_m
--     (recebida, senao a pedida - 0 se troca -, kg->m, menos as baixas do item); OC nao recebida = pedida menos baixas (como
--     antes). Menos os vinculos de outros cards (sem mudanca).
--   ocs_para_rolo (Rolos.tsx:100-148 e :769, criar rolo / "- Metragem"): COALESCE(recebida, pedida) SEM a excecao da troca ->
--     a reposicao de troca ainda nao recebida aparecia com a pedida disponivel (e o _criar_rolo_core / o corte recusam: saldo 0).
--     Agora = saldo_oc_item_m (so OC recebida, como antes).
-- Mesmo formato de resposta (chaves e ordem): o front nao muda. Nada gravado muda.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public.ocs_disponiveis_variante(uuid,uuid)
--     ANTES  9490322586a3408d62eee74fd0aea484  -- PROVISORIO (copia 54422; fora do Passo 0): conferir no Passo 0 do kit R15
--     DEPOIS a0bcbbe2f7930c946628b583347e2d60  (este arquivo; reaplicar = no-op)
--   public.ocs_para_rolo()
--     ANTES  bd666c0ee53370caf3f6873218609ea0  -- PROVISORIO (copia 54422; fora do Passo 0): conferir no Passo 0 do kit R15
--     DEPOIS 1c3457bdbfab53114e39b78d382e598c  (este arquivo; reaplicar = no-op)
--   Sem mudanca (so guarda; e a regra usada):
--     public.saldo_oc_item_m(uuid)  873789084182322f0b28b315d06b0dbc  INTOCADA  -- texto da R11 (20261021100000, "depois"; em producao
--       desde a release 10, 01/out 14:46 - a pos-condicao daquela ida exige este md5)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (objeto funcao). Sem DDL de tabela, sem DROP. ACL mantida (ocs_disponiveis_variante:
-- authenticated/service_role; ocs_para_rolo: PUBLIC/authenticated como hoje - backlog do Reforco de seguranca, nao muda
-- aqui; o PUBLIC so ve a propria loja e anon cai na loja nil = lista vazia). Conferido no fim (anon sem EXECUTE no
-- ocs_disponiveis_variante; ocs_para_rolo com a mesma ACL de antes).
-- Volta: supabase/rollback/20261025200000_saldo_picker_rolo_regra_core_down.sql (devolve os 2 textos de antes).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r15b1_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r15b1_md5_aceitos VALUES
  ('public.ocs_disponiveis_variante(uuid,uuid)', '9490322586a3408d62eee74fd0aea484', 'antes'),     -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R15
  ('public.ocs_disponiveis_variante(uuid,uuid)', 'a0bcbbe2f7930c946628b583347e2d60', 'depois'),
  ('public.ocs_para_rolo()',                     'bd666c0ee53370caf3f6873218609ea0', 'antes'),     -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R15
  ('public.ocs_para_rolo()',                     '1c3457bdbfab53114e39b78d382e598c', 'depois'),
  ('public.saldo_oc_item_m(uuid)',               '873789084182322f0b28b315d06b0dbc', 'usada');     -- R11 "depois" (producao desde a release 10)

CREATE TEMP TABLE _r15b1_acl ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS s, p.proacl::text AS acl FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.ocs_disponiveis_variante(uuid,uuid)'), to_regprocedure('public.ocs_para_rolo()'));

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r15b1_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r15a_b1: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r15b1_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r15a_b1: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
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
        -- [medios R15 B1] OC RECEBIDA = o saldo do item pela regra do core (saldo_oc_item_m, R11: recebida, senao a
        -- pedida - 0 se o item e reposicao de troca -, kg->m, menos as baixas do item). Antes: COALESCE(recebida,0) ->
        -- item recebido sem quantidade aparecia com 0 disponivel (MALHA BEGONIA ~547 m) enquanto o corte o consumia.
        -- OC nao recebida = previsao pela pedida menos as baixas do item (como antes).
        (CASE
           WHEN oc.status = 'recebido' THEN
             COALESCE((SELECT s.saldo_m FROM public.saldo_oc_item_m(it.id) s), 0)
           ELSE
             (CASE WHEN a.unidade_medida='kg'
                   THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
                   ELSE COALESCE(it.quantidade_pedida,0) END)
             - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
         END)
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
        -- [medios R15 B1] saldo do item pela regra do core (saldo_oc_item_m, R11): recebida, senao a pedida - 0 se o
        -- item e reposicao de troca (antes contava a pedida da troca ainda nao recebida) -, kg->m, menos as baixas.
        SELECT COALESCE((SELECT s.saldo_m FROM public.saldo_oc_item_m(it.id) s), 0) AS m
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
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r15b1_md5_aceitos WHERE papel IN ('depois','usada') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r15a_b1: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ACL igual a de antes (CREATE OR REPLACE nao mexe; conferido)
  IF EXISTS (SELECT 1 FROM _r15b1_acl a JOIN pg_proc p ON p.oid = to_regprocedure(a.s) WHERE p.proacl::text IS DISTINCT FROM a.acl) THEN
    RAISE EXCEPTION 'medios_r15a_b1: pos-condicao falhou - a ACL dos pickers mudou' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.ocs_disponiveis_variante(uuid,uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.ocs_disponiveis_variante(uuid,uuid)') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r15a_b1: ocs_disponiveis_variante ficou executavel por PUBLIC/anon' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ocs_disponiveis_variante(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ocs_para_rolo()', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r15a_b1: os pickers perderam o EXECUTE de authenticated (a tela usa)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

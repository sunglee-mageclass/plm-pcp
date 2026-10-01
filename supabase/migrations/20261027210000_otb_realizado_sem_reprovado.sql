-- Achados LEVES, release L4 (Dashboards e OTB; banco ANTES do site) - parte 2: Realizado do OTB sem reprovado.
--   est #15 / P-209 A (dono 01/out): card REPROVADO nao conta no Realizado do OTB; saindo de Reprovado volta a contar
--             (contagem viva, nada gravado). Fix round 1, P-213 A (dono): reprovado = status_desenvolvimento OU
--             status_planejamento 'reprovado' (a mesma regra da Integracao):
--             NOT (lower(COALESCE(status_desenvolvimento,''))='reprovado' OR lower(COALESCE(status_planejamento,''))='reprovado').
--             _otb_colecao_totais: Realizado da COLECAO (lista do OTB, dropdown de colecao, Plan. Tecido, e o
--               sidebar_badges.otb_divergencia, que le esta funcao e passa a seguir a mesma regra sem mudar de texto).
--             _otb_orcamento_core: Realizado da SUBCOLECAO e do NIVEL 3 (linha/categoria); a coluna 'colecoes' ja vem
--               de _otb_colecao_totais. Nada mais muda (total, ordem, shape).
--   Copia 54422 (antes -> depois): Ave Rara "Resort 27 Novo" 242/199 -> 232/199 (saem 7 reprovados no Dev + 3 so no
--   Planejamento; segue divergente, badge 1 -> 1); demais lojas iguais (0 reprovados nas colecoes confirmadas).
-- Funcoes STABLE, so leitura; nada gravado muda.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._otb_orcamento_core(uuid,uuid)
--     ANTES  90459d3b52b7d107b14bc6ab0e7ed6ce  -- PROVISORIO (copia 54422): nao consta do Passo 0 dos MEDIOS; conferir no Passo 0 dos LEVES (plan.md §4)
--     DEPOIS 33137a0e34808d098f084f3891a61913  (este arquivo; reaplicar = no-op)
--   public._otb_colecao_totais(uuid)
--     ANTES  efe66ab77932cfcc7ad5e14d6881a963  -- PROVISORIO (copia 54422): FORA da lista do Passo 0 dos LEVES (plan.md §4) - ACRESCENTAR
--     DEPOIS 4e27b6098b2197ec5239118278341f12  (este arquivo; reaplicar = no-op)
--   Sem mudanca (so guarda):
--     public.otb_orcamento(uuid)  c6084650c6351917c4b2a7e471acc916  chamador  -- PROVISORIO (copia): conferir no Passo 0 dos LEVES
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto da propria funcao; nada em tabela, nada em auth/storage).
-- Sem DDL de tabela, sem DROP, sem funcao nova. ACL: CREATE OR REPLACE mantem a de hoje (os 2 internos so com
-- postgres/service_role - inv. #9); o REVOKE abaixo e idempotente e a pos-condicao confere PUBLIC/anon/authenticated,
-- STABLE e SECURITY DEFINER. O wrapper otb_orcamento tem hoje EXECUTE para PUBLIC/anon (frente Seguranca, fora daqui):
-- esta migration nao mexe nisso; so confere que authenticated segue com EXECUTE.
-- Volta: supabase/rollback/20261027210000_otb_realizado_sem_reprovado_down.sql. LIFO: roda ANTES do inverso
-- 20261027200000_dashboards_funil_dev_down.sql (L4 parte 1), que roda antes do inverso da R12.
-- Site: nenhum consumidor recalcula o Realizado no TS (todos leem otb_orcamento / sidebar_badges); o poder de venda
-- realizado (computeColecaoResumo, otb-resumo.ts) passa a pular o reprovado no site da L4.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l4b_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l4b_md5_aceitos VALUES
  ('public._otb_orcamento_core(uuid,uuid)', '90459d3b52b7d107b14bc6ab0e7ed6ce', 'antes'),  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
  ('public._otb_orcamento_core(uuid,uuid)', '33137a0e34808d098f084f3891a61913', 'depois'),
  ('public._otb_colecao_totais(uuid)', 'efe66ab77932cfcc7ad5e14d6881a963', 'antes'),  -- PROVISORIO (copia 54422): acrescentar ao Passo 0 dos LEVES
  ('public._otb_colecao_totais(uuid)', '4e27b6098b2197ec5239118278341f12', 'depois'),
  ('public.otb_orcamento(uuid)', 'c6084650c6351917c4b2a7e471acc916', 'dep');  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l4b_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'leves_l4: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l4b_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'leves_l4: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._otb_colecao_totais(_tenant uuid)
 RETURNS TABLE(colecao_id uuid, nome text, tipo text, total integer, realizado integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cols AS (
    SELECT c.id, c.nome, COALESCE(c.tipo,'orcamento') AS tipo
    FROM colecoes c WHERE c.tenant_id = _tenant AND c.status = 'confirmada'
  )
  SELECT cols.id, cols.nome, cols.tipo,
    (CASE WHEN cols.tipo = 'poder_venda' THEN
       COALESCE((SELECT sum((e.value)::int)
                 FROM colecao_pv_itens it
                 CROSS JOIN LATERAL jsonb_each_text(it.qtd_semanas) e(key,value)
                 WHERE it.colecao_id = cols.id AND it.tenant_id = _tenant AND e.value ~ '^[0-9]+$'),0)
     ELSE
       COALESCE((SELECT sum(cs.qtd_planejada) FROM colecao_semanas cs WHERE cs.colecao_id = cols.id AND cs.tenant_id = _tenant),0)
     END)::int AS total,
    -- [leves L4, est #15 / P-209 A + P-213 A] card REPROVADO nao conta no Realizado; saindo de Reprovado volta a
    -- contar. Reprovado = status_desenvolvimento OU status_planejamento 'reprovado' (mesma regra da Integracao).
    COALESCE((SELECT count(*) FROM modelos m WHERE m.colecao_id = cols.id AND m.tenant_id = _tenant
              AND NOT (lower(COALESCE(m.status_desenvolvimento,'')) = 'reprovado'
                       OR lower(COALESCE(m.status_planejamento,'')) = 'reprovado')),0)::int AS realizado
  FROM cols;
$function$

;

CREATE OR REPLACE FUNCTION public._otb_orcamento_core(_tenant uuid, _colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_res jsonb;
begin
  WITH cols AS (
    SELECT t.colecao_id, t.nome, t.tipo, t.total, t.realizado
    FROM public._otb_colecao_totais(_tenant) t
    WHERE _colecao_id IS NULL OR t.colecao_id = _colecao_id
  ),
  sc AS (
    SELECT c.colecao_id, c.tipo, s.id AS sub_id, s.nome AS sub_nome, s.ordem AS sub_ordem
    FROM cols c JOIN colecao_subcolecoes s ON s.colecao_id = c.colecao_id
  ),
  sub AS (
    SELECT sc.colecao_id, sc.sub_nome, sc.sub_ordem,
      (CASE WHEN sc.tipo='poder_venda' THEN
         COALESCE((SELECT sum((e.value)::int) FROM colecao_pv_itens it
                   CROSS JOIN LATERAL jsonb_each_text(it.qtd_semanas) e(key,value)
                   WHERE it.subcolecao_id = sc.sub_id AND it.tenant_id = _tenant AND e.value ~ '^[0-9]+$'),0)
       ELSE
         COALESCE((SELECT sum(cs.qtd_planejada) FROM colecao_semanas cs WHERE cs.subcolecao_id = sc.sub_id AND cs.tenant_id = _tenant),0)
       END)::int AS total,
      -- [leves L4, est #15 / P-209 A + P-213 A] reprovado fora do Realizado (mesmo predicado de _otb_colecao_totais).
      COALESCE((SELECT count(*) FROM modelos m WHERE m.colecao_id = sc.colecao_id
                AND m.tenant_id = _tenant AND m.subcolecao = sc.sub_nome
                AND NOT (lower(COALESCE(m.status_desenvolvimento,'')) = 'reprovado'
                         OR lower(COALESCE(m.status_planejamento,'')) = 'reprovado')),0)::int AS realizado
    FROM sc
  ),
  n3 AS (
    SELECT sc.colecao_id, sc.sub_nome, 'linha'::text AS tipo3, it.linha_id AS ref_id, l.nome AS label,
      COALESCE((SELECT sum((e.value)::int) FROM jsonb_each_text(it.qtd_semanas) e(key,value)
                WHERE e.value ~ '^[0-9]+$'),0)::int AS total
    FROM sc JOIN colecao_pv_itens it ON it.subcolecao_id = sc.sub_id AND it.tenant_id = _tenant
    LEFT JOIN linhas l ON l.id = it.linha_id
    WHERE sc.tipo = 'poder_venda'
    UNION ALL
    SELECT sc.colecao_id, sc.sub_nome, 'categoria'::text, csc.categoria_id, cat.nome,
      sum(csc.qtd)::int
    FROM sc JOIN colecao_semana_categorias csc ON csc.subcolecao_id = sc.sub_id AND csc.tenant_id = _tenant
    LEFT JOIN categorias_produto cat ON cat.id = csc.categoria_id
    WHERE sc.tipo <> 'poder_venda'
    GROUP BY sc.colecao_id, sc.sub_nome, csc.categoria_id, cat.nome
  ),
  n3r AS (
    SELECT n3.*, COALESCE((SELECT count(*) FROM modelos m
      WHERE m.colecao_id = n3.colecao_id AND m.tenant_id = _tenant AND m.subcolecao = n3.sub_nome
        AND NOT (lower(COALESCE(m.status_desenvolvimento,'')) = 'reprovado'
                 OR lower(COALESCE(m.status_planejamento,'')) = 'reprovado')  -- [leves L4, P-209 A + P-213 A]
        AND ((n3.tipo3='linha' AND m.linha_id = n3.ref_id)
          OR (n3.tipo3='categoria' AND m.categoria_principal_id = n3.ref_id))),0)::int AS realizado
    FROM n3
  )
  SELECT jsonb_build_object(
    'colecoes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'nome',nome,'tipo',tipo,'total',total,'realizado',realizado)) FROM cols),'[]'::jsonb),
    -- Subcoleções na ORDEM PLANEJADA (colecao_subcolecoes.ordem).
    'subcolecoes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'subcolecao',sub_nome,'total',total,'realizado',realizado)
        ORDER BY colecao_id, sub_ordem NULLS LAST, sub_nome) FROM sub),'[]'::jsonb),
    'niveis3', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'subcolecao',sub_nome,'tipo3',tipo3,'ref_id',ref_id,'label',label,
        'total',total,'realizado',realizado)) FROM n3r),'[]'::jsonb)
  ) INTO v_res;
  return v_res;
end;
$function$

;

-- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated (idempotente; a ACL de hoje ja e essa).
REVOKE EXECUTE ON FUNCTION public._otb_colecao_totais(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._otb_orcamento_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _l4b_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'leves_l4: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) <> 's'
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) THEN
      RAISE EXCEPTION 'leves_l4: % deixou de ser STABLE SECURITY DEFINER', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF r.assinatura LIKE 'public.\_%' THEN
      IF has_function_privilege('anon', r.assinatura, 'EXECUTE') THEN
        RAISE EXCEPTION 'leves_l4: % ficou executavel por anon', r.assinatura USING ERRCODE = 'P0001';
      END IF;
      IF has_function_privilege('authenticated', r.assinatura, 'EXECUTE') THEN
        RAISE EXCEPTION 'leves_l4: % ficou executavel por authenticated (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                  WHERE p.oid = to_regprocedure(r.assinatura) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'leves_l4: % ficou executavel por PUBLIC (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
  -- o wrapper segue executavel por authenticated (a tela chama por ele)
  IF NOT has_function_privilege('authenticated', 'public.otb_orcamento(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.sidebar_badges()', 'EXECUTE') THEN
    RAISE EXCEPTION 'leves_l4: otb_orcamento ou sidebar_badges perdeu o EXECUTE de authenticated' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

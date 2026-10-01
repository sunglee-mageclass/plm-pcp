-- INVERSO de supabase/migrations/20261027210000_otb_realizado_sem_reprovado.sql (achados LEVES L4, est #15 / P-209 A).
-- Devolve o texto de antes de _otb_colecao_totais e _otb_orcamento_core (o Realizado volta a contar o reprovado).
-- Guarda: so roda se as 2 estao EXATAMENTE com o texto da ida (md5 de depois) e o wrapper segue com o texto
-- conferido; outro -> P0001 e nada muda. Nada gravado muda (so leitura).
-- LIFO da aplicacao: este e o PRIMEIRO inverso da L4; depois 20261027200000_dashboards_funil_dev_down.sql; depois o
-- inverso da R12. O site da L4 (otb-resumo.ts pula reprovado no poder de venda) pode ficar: so diverge do Realizado
-- em contagem enquanto este inverso estiver aplicado.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._otb_orcamento_core(uuid,uuid)', 'af6bfa201af761ffe6a155c866acf81e'),
      ('public._otb_colecao_totais(uuid)', 'fd5414a318f3f16c3236eb421d9d48aa'),
      ('public.otb_orcamento(uuid)', 'c6084650c6351917c4b2a7e471acc916')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l4 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l4 (volta): % nao esta com o texto esperado da 20261027210000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
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
    COALESCE((SELECT count(*) FROM modelos m WHERE m.colecao_id = cols.id AND m.tenant_id = _tenant),0)::int AS realizado
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
      COALESCE((SELECT count(*) FROM modelos m WHERE m.colecao_id = sc.colecao_id
                AND m.tenant_id = _tenant AND m.subcolecao = sc.sub_nome),0)::int AS realizado
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

REVOKE EXECUTE ON FUNCTION public._otb_colecao_totais(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._otb_orcamento_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._otb_orcamento_core(uuid,uuid)', '90459d3b52b7d107b14bc6ab0e7ed6ce'),
      ('public._otb_colecao_totais(uuid)', 'efe66ab77932cfcc7ad5e14d6881a963')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l4 (volta): pos-condicao falhou - % nao voltou ao texto de antes', r.s USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.s, 'EXECUTE') OR has_function_privilege('authenticated', r.s, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l4 (volta): % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(r.s)) <> 's'
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.s)) THEN
      RAISE EXCEPTION 'leves_l4 (volta): % deixou de ser STABLE SECURITY DEFINER', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

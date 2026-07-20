-- Na lista de cards do OTB, a descrição mostra as subcoleções (de otb_orcamento). O jsonb_agg
-- das subcoleções não tinha ORDER BY → ordem indefinida. Agora ordena pela ORDEM PLANEJADA
-- (colecao_subcolecoes.ordem), pra bater com o plano.
BEGIN;

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
$function$;

COMMIT;

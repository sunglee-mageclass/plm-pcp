-- 20260721120000_otb_orcamento.sql
-- Total (plano fixo) × realizado (contagem de cards) por coleção/subcoleção/nível-3.
CREATE OR REPLACE FUNCTION public._otb_colecao_totais(_tenant uuid)
 RETURNS TABLE(colecao_id uuid, nome text, tipo text, total int, realizado int)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
$function$;

CREATE OR REPLACE FUNCTION public._otb_orcamento_core(_tenant uuid, _colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_res jsonb;
begin
  WITH cols AS (
    SELECT t.colecao_id, t.nome, t.tipo, t.total, t.realizado
    FROM public._otb_colecao_totais(_tenant) t
    WHERE _colecao_id IS NULL OR t.colecao_id = _colecao_id
  ),
  sc AS (
    SELECT c.colecao_id, c.tipo, s.id AS sub_id, s.nome AS sub_nome
    FROM cols c JOIN colecao_subcolecoes s ON s.colecao_id = c.colecao_id
  ),
  sub AS (
    SELECT sc.colecao_id, sc.sub_nome,
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
    -- PV: nível 3 = linha
    SELECT sc.colecao_id, sc.sub_nome, 'linha'::text AS tipo3, it.linha_id AS ref_id, l.nome AS label,
      COALESCE((SELECT sum((e.value)::int) FROM jsonb_each_text(it.qtd_semanas) e(key,value)
                WHERE e.value ~ '^[0-9]+$'),0)::int AS total
    FROM sc JOIN colecao_pv_itens it ON it.subcolecao_id = sc.sub_id AND it.tenant_id = _tenant
    LEFT JOIN linhas l ON l.id = it.linha_id
    WHERE sc.tipo = 'poder_venda'
    UNION ALL
    -- Orçamento: nível 3 = categoria
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
    'subcolecoes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'subcolecao',sub_nome,'total',total,'realizado',realizado)) FROM sub),'[]'::jsonb),
    'niveis3', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'colecao_id',colecao_id,'subcolecao',sub_nome,'tipo3',tipo3,'ref_id',ref_id,'label',label,
        'total',total,'realizado',realizado)) FROM n3r),'[]'::jsonb)
  ) INTO v_res;
  return v_res;
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_orcamento(_colecao_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    return jsonb_build_object('colecoes','[]'::jsonb,'subcolecoes','[]'::jsonb,'niveis3','[]'::jsonb);
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  return public._otb_orcamento_core(v_tenant, _colecao_id);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public._otb_colecao_totais(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._otb_orcamento_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Fase B — custo do tecido CONGELADO pela OC vinculada no Desenvolvimento.
-- A mudança de preço do artigo/variante (uma OC futura) NÃO deve mexer no custo de um
-- produto já desenvolvido; o custo segue o preço da OC que foi VINCULADA ao modelo
-- (modelo_tecido_oc_links → ocs_tecido_itens.preco). Quando não há vínculo, cai no preço
-- atual do artigo (comportamento anterior — vincular a OC É a ação que congela).
--
-- Regras (por precedente do sistema):
--   • MAX das OCs vinculadas para o tecido (tipo,numero) — espelha "modelo = maior".
--   • Normaliza para preço POR METRO (kg → preço/rendimento), igual ao trigger do artigo.
--   • O custo REAL já é gravado em cad_tecidos.custo_cad no salvar do CAD; o front passa a
--     computá-lo com o preço da OC (ver mudanças de front). Estas funções cobrem o ramo de
--     FALLBACK das RPCs (quando custo_cad não estiver setado) — mantém back e front coerentes.

BEGIN;

-- Helper interno: preço POR METRO do tecido de um modelo — OC vinculada (MAX) se houver,
-- senão o preço atual do artigo. Revogado de todo mundo (só as funções DEFINER o chamam).
CREATE OR REPLACE FUNCTION public._preco_tecido_por_metro(
  _modelo_id uuid, _tipo text, _numero int, _artigo_id uuid
) RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- Fase B: preço da OC vinculada (MAX), já normalizado p/ metro.
    (SELECT CASE WHEN a.unidade_medida = 'kg' AND COALESCE(a.rendimento,0) > 0
                 THEN mx.preco / a.rendimento ELSE mx.preco END
       FROM public.artigos a
       CROSS JOIN LATERAL (
         SELECT MAX(oti.preco) AS preco
         FROM public.modelo_tecido_oc_links l
         JOIN public.ocs_tecido_itens oti ON oti.id = l.oc_tecido_item_id
         WHERE l.modelo_id = _modelo_id AND l.tipo = _tipo AND l.numero = _numero
           AND oti.preco IS NOT NULL AND COALESCE(oti.cancelado,false) = false
       ) mx
       WHERE a.id = _artigo_id AND mx.preco IS NOT NULL),
    -- Fallback: preço atual do artigo (por metro).
    (SELECT COALESCE(a.preco_por_metro,0) FROM public.artigos a WHERE a.id = _artigo_id),
    0
  );
$function$;

REVOKE EXECUTE ON FUNCTION public._preco_tecido_por_metro(uuid, text, int, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._preco_tecido_por_metro(uuid, text, int, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._preco_tecido_por_metro(uuid, text, int, uuid) FROM authenticated;

-- RPC p/ o FRONT: mapa "tipo|numero" → preço por metro congelado (só posições COM vínculo
-- de OC com preço). O front usa o congelado quando existir, senão o preço do artigo.
CREATE OR REPLACE FUNCTION public.precos_tecido_congelado(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_object_agg(s.k, s.ppm), '{}'::jsonb)
  FROM (
    SELECT l.tipo || '|' || l.numero AS k,
           MAX(CASE WHEN a.unidade_medida = 'kg' AND COALESCE(a.rendimento,0) > 0
                    THEN oti.preco / a.rendimento ELSE oti.preco END) AS ppm
    FROM public.modelo_tecido_oc_links l
    JOIN public.ocs_tecido_itens oti ON oti.id = l.oc_tecido_item_id
    JOIN public.variantes_tecido vt ON vt.id = l.variante_tecido_id
    JOIN public.artigos a ON a.id = vt.artigo_id
    WHERE l.modelo_id = _modelo_id
      AND l.tenant_id = public.get_user_tenant_id()
      AND oti.preco IS NOT NULL AND COALESCE(oti.cancelado,false) = false
    GROUP BY l.tipo, l.numero
  ) s;
$function$;

REVOKE EXECUTE ON FUNCTION public.precos_tecido_congelado(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.precos_tecido_congelado(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.precos_tecido_congelado(uuid) TO authenticated;

-- custo_unitario_modelos: ramo de fallback do tecido passa a usar o preço congelado.
CREATE OR REPLACE FUNCTION public.custo_unitario_modelos(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  with cad_conf as (
    select distinct on (c.modelo_id) c.modelo_id, c.id as cad_id
    from cad c
    where c.tenant_id = v_tenant and c.enviado_corte
    order by c.modelo_id, c.data_enviado_corte desc nulls last
  ),
  mat as (
    select cc.modelo_id,
      coalesce((select sum(case when ct.custo_cad is not null then ct.custo_cad
          else coalesce(ct.consumo_cad,0) * (1 + coalesce(ct.loss_percent_cad,0)/100.0)
               * public._preco_tecido_por_metro(cc.modelo_id, ct.tipo, ct.numero, ct.artigo_id) end)
        from cad_tecidos ct where ct.cad_id = cc.cad_id), 0)
      + coalesce((select sum(coalesce(ca.consumo,0) * coalesce(av.preco,0))
        from cad_aviamentos ca left join aviamentos av on av.id = ca.aviamento_id where ca.cad_id = cc.cad_id), 0) as materials,
      coalesce((select sum(coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0)
            - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0))
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade
    from cad_conf cc
  )
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'previsto', coalesce(m.custo_peca_previsto,0),
    'real', case when exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
              then coalesce((select materials + case when grade > 0 then servico_total / grade else 0 end
                             from mat where mat.modelo_id = m.id), 0)
                   + coalesce((select sum((c->>'valor')::numeric)
                              from jsonb_array_elements(coalesce(m.custos_adicionais,'[]'::jsonb)) c), 0)
              else coalesce(m.custo_peca_previsto,0)
            end,
    'confirmado', exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
  )), '{}'::jsonb)
  into v_result
  from modelos m
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;

-- _dashboard_custos_core: mesmo ajuste no ramo de fallback do tecido.
CREATE OR REPLACE FUNCTION public._dashboard_custos_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_categoria uuid DEFAULT NULL::uuid, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rows jsonb; v_chart jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH cad_conf AS (
    SELECT DISTINCT ON (c.modelo_id) c.modelo_id, c.id AS cad_id
    FROM cad c
    WHERE c.tenant_id = v_tenant AND c.enviado_corte
    ORDER BY c.modelo_id, c.data_enviado_corte DESC NULLS LAST
  ),
  mat AS (
    SELECT cc.modelo_id,
      COALESCE((SELECT SUM(CASE WHEN ct.custo_cad IS NOT NULL THEN ct.custo_cad
          ELSE COALESCE(ct.consumo_cad,0) * (1 + COALESCE(ct.loss_percent_cad,0)/100.0)
               * public._preco_tecido_por_metro(cc.modelo_id, ct.tipo, ct.numero, ct.artigo_id) END)
        FROM cad_tecidos ct WHERE ct.cad_id = cc.cad_id), 0)
      + COALESCE((SELECT SUM(COALESCE(ca.consumo,0) * COALESCE(av.preco,0))
        FROM cad_aviamentos ca LEFT JOIN aviamentos av ON av.id = ca.aviamento_id WHERE ca.cad_id = cc.cad_id), 0) AS materials,
      COALESCE((SELECT SUM(COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)
            - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0))
        FROM producao_terceirizados pt WHERE pt.cad_id = cc.cad_id AND COALESCE(pt.interno,false) = false), 0) AS servico_total,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = cc.cad_id), 0) AS grade
    FROM cad_conf cc
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, m.colecao, m.versao,
      EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id) AS confirmado,
      COALESCE(m.custo_peca_previsto, 0) AS previsto,
      CASE WHEN EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id)
        THEN COALESCE((SELECT materials + CASE WHEN grade > 0 THEN servico_total / grade ELSE 0 END
                       FROM mat WHERE mat.modelo_id = m.id), 0)
             + COALESCE((SELECT SUM((c->>'valor')::numeric)
                        FROM jsonb_array_elements(COALESCE(m.custos_adicionais,'[]'::jsonb)) c), 0)
        ELSE COALESCE(m.custo_peca_previsto, 0)
      END AS real
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'ref', ref, 'nome', nome, 'colecao', colecao, 'versao', versao, 'confirmado', confirmado,
        'previsto', previsto, 'real', real, 'diff', (real - previsto),
        'pct', CASE WHEN previsto > 0 THEN ((real - previsto)/previsto)*100 ELSE 0 END
      ) ORDER BY ref) FROM base), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('colecao', colecao, 'medio', medio, 'nConf', n_conf, 'nTotal', n_total))
              FROM (SELECT colecao, AVG(NULLIF(real,0)) FILTER (WHERE confirmado) AS medio,
                           COUNT(*) FILTER (WHERE confirmado) AS n_conf, COUNT(*) AS n_total
                    FROM base WHERE colecao IS NOT NULL GROUP BY colecao
                    HAVING COUNT(*) FILTER (WHERE confirmado) > 0) c), '[]'::jsonb)
  INTO v_rows, v_chart;

  RETURN jsonb_build_object(
    'rows', v_rows, 'chartData', v_chart,
    'filtros', jsonb_build_object(
      'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM categorias_produto WHERE tenant_id=v_tenant), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id=v_tenant AND colecao IS NOT NULL AND colecao <> ''), '[]'::jsonb)
    )
  );
END;
$function$;

COMMIT;

select pg_notify('pgrst','reload schema');

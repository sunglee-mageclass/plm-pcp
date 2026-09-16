-- Plan. Tecido: a árvore devolve o `variante_artigo_id` de cada variante (set/2026, substitutos).
--
-- Para reconstruir os SUBSTITUTOS de um material ao carregar (mesmo padrão do Desenvolvimento — o
-- `artigo_ids_extra` é DERIVADO das variantes cujo artigo ≠ principal), a árvore precisa expor o
-- artigo da variante real. Adiciona SÓ a chave `variante_artigo_id` (= vt.artigo_id, o join `vt` já
-- existe) ao jsonb de cada variante. Aditivo: quem não usa ignora; nenhum campo removido/alterado.
--
-- Corpo COPIADO byte-a-byte do pg_get_functiondef vigente; só a chave nova muda. Mesma assinatura
-- (uuid) → CREATE OR REPLACE substitui, sem overload. Diff-validar: só a linha do variante_artigo_id.

CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p.id is null then null else jsonb_build_object(
    'plan_id', p.id, 'colecao_id', p.colecao_id,
    'subcolecoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'subcolecao_id', s.subcolecao_id, 'ordem', s.ordem,
        'categorias_tecido', coalesce((select jsonb_agg(sc.categoria_id order by sc.ordem, sc.created_at)
          from plan_tecido_subcolecao_categorias sc where sc.subcolecao_id = s.id), '[]'::jsonb),
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
            'slots', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sl.id, 'modelo_id', sl.modelo_id, 'ref', m.ref, 'nome', coalesce(m.nome, sl.nome),
                'thumb_path', coalesce((m.fotos_modelo)[1], m.desenho_tecnico_url, m.croqui_url),
                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id, 'mix_id', case when sl.modelo_id is not null then m.mix_id else sl.mix_id end,
                'usar_estoque', sl.usar_estoque,
                'proporcoes', coalesce(sl.proporcoes, m.proporcoes),
                'custo_simulado', sl.custo_simulado,
                'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
                'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
                'referencia_paths', to_jsonb(coalesce(sl.referencia_paths,'{}'::text[])),
                'materiais', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', mt.id, 'artigo_id', mt.artigo_id, 'artigo_nome', a.nome,
                    'unidade_medida', a.unidade_medida, 'rendimento', a.rendimento,
                    'preco_por_metro', a.preco_por_metro,
                    'tipo', mt.tipo, 'numero', mt.numero, 'consumo', mt.consumo,
                    'loss_percent', mt.loss_percent, 'ordem', mt.ordem,
                    'variantes', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'id', vv.id, 'variante_tecido_id', vv.variante_tecido_id,
                        'variante_artigo_id', vt.artigo_id,
                        'cor_id', vv.cor_id, 'cor_apelido_id', vv.cor_apelido_id,
                        'label', concat_ws(' - ', coalesce(cor.nome, pcor.nome), coalesce(ap.nome, pap.nome)),
                        'cor_nome', coalesce(cor.nome, pcor.nome),
                        'ordem', vv.ordem, 'multiplicador', vv.multiplicador,
                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)
                      from plan_tecido_variantes vv
                      left join variantes_tecido vt on vt.id = vv.variante_tecido_id
                      left join cores cor on cor.id = vt.cor_id
                      left join cores_apelido ap on ap.id = vt.cor_apelido_id
                      left join cores pcor on pcor.id = vv.cor_id
                      left join cores_apelido pap on pap.id = vv.cor_apelido_id
                      where vv.material_id = mt.id), '[]'::jsonb)) order by mt.ordem)
                  from plan_tecido_materiais mt
                  left join artigos a on a.id = mt.artigo_id
                  where mt.slot_id = sl.id), '[]'::jsonb)) order by sl.slot_index)
              from plan_tecido_slots sl
              left join modelos m on m.id = sl.modelo_id
              where sl.linha_ref_id = l.id), '[]'::jsonb)) order by l.ordem)
          from plan_tecido_linhas l where l.sub_id = s.id), '[]'::jsonb)) order by s.ordem)
      from plan_tecido_subcolecoes s where s.plan_id = p.id), '[]'::jsonb)
  ) end
  from (select id, colecao_id from plan_tecido where colecao_id = _colecao_id) p;
$function$;

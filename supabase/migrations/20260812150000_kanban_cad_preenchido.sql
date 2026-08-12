-- Kanban: `cad_confirmado` (semântica "enviado ao corte") APOSENTADA — o dono decidiu que o
-- marco correto é a seção "4. CAD" do card de Desenvolvimento (ModeloDetailPanel, accordion
-- `s-cad`, componente CadTecidosSection) estar PREENCHIDA, não o envio ao corte (isso já é o
-- gate downstream de Serviços/CQ). Semântica NOVA = KEY NOVA (`cad_preenchido`); a antiga
-- é removida do catálogo E da RPC (nenhum tenant tinha `cad_confirmado` configurado em
-- `kanban_requisitos` — verificado no banco, migração de config desnecessária).
--
-- INVESTIGAÇÃO do predicado (por que NÃO é "cad_grades.grades_planejadas não-vazia", a
-- proposta inicial): `enviar_modelo_para_cad` (botão "Enviar à Explosão" do card, RPC
-- `_enviar_modelo_para_cad_core`) copia a grade do BOM pra `cad_grades.grades_planejadas` NO
-- MESMO INSTANTE que seta `modelos.enviado_cad = true` — ou seja, checar `grades_planejadas`
-- ficaria PRATICAMENTE REDUNDANTE com a condição `enviado_cad` já existente (grade preenchida
-- no Dev quase sempre acompanha o envio). Só há UM conjunto de campos que a mesma RPC deixa
-- ZERADOS de propósito, exigindo entrada manual DEPOIS (na tela PCP > CAD, seção "4. CAD"):
-- `cad_tecidos.tamanho_folha` e `cad_tecido_variantes.quantidade_folhas`/`metragem_planejada`
-- (todos INSERT ... 0 no `_enviar_modelo_para_cad_core`) — exatamente os 3 campos que
-- `CadTecidosSection.tsx` deixa o usuário editar ("Tamanho da folha", "Qtd Folhas",
-- "Metr. Planejada"). Esse é o marcador DEFENSÁVEL de "a seção 4. CAD foi preenchida" (não só
-- copiada do BOM automaticamente) — ajustado da proposta inicial após a investigação, como
-- autorizado.
--
-- Predicado: existe ao menos 1 variante do CAD do modelo com tamanho_folha (do tecido) OU
-- quantidade_folhas OU metragem_planejada > 0.
--
-- IMPORTANTE: as chaves aqui DEVEM casar 1:1 com CONDICAO_KEYS (src/lib/kanban-condicoes.ts) —
-- há teste anti-drift (tests/integration/kanban-condicoes.test.ts).
CREATE OR REPLACE FUNCTION public.avaliar_condicoes_kanban(_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    -- Planejamento
    'categoria_definida', m.categoria_principal_id is not null,
    'subcategoria1_definida', m.subcategoria1_id is not null,
    'subcategoria2_definida', m.subcategoria2_id is not null,
    'estilista_definido', m.estilista_id is not null,
    'linha_definida', m.linha_id is not null,
    'colecao_preenchida', coalesce(btrim(m.colecao),'') <> '',
    'tecido_planejado', coalesce(array_length(m.tecidos_planejados, 1), 0) > 0,
    'ordem_criacao_enviada', coalesce(m.ordem_criacao_enviada, false),
    'preco_venda_preenchido', coalesce(m.preco_venda, 0) > 0,
    'data_lancamento_preenchida', m.data_lancamento is not null,
    'lancado', coalesce(m.lancado, false),
    -- Desenvolvimento
    'modelista_definido', m.modelista_id is not null,
    'piloteiro_definido', (m.piloteiro1_id is not null or m.piloteiro2_id is not null or m.piloteiro3_id is not null),
    'data_desenho_tecnico', m.data_desenho_tecnico is not null,
    'data_piloto1', m.data_piloto1 is not null,
    'data_piloto2', m.data_piloto2 is not null,
    'data_piloto3', m.data_piloto3 is not null,
    'data_aprovacao', m.data_aprovacao is not null,
    'grade_preenchida', coalesce((select sum(g.grade_total) from modelo_grades g where g.modelo_id = m.id), 0) > 0,
    'grade_todas_variantes', (
      with vc as (
        select count(*) as n
        from modelo_tecidos mt
        join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
        where mt.modelo_id = m.id and mt.tipo = 'tecido' and mt.numero = 1
          and mtv.variante_tecido_id is not null
      )
      select vc.n > 0 and vc.n = (
        select count(distinct g.variante_numero)
        from modelo_grades g
        where g.modelo_id = m.id and coalesce(g.grade_total,0) > 0
          and g.variante_numero between 1 and vc.n
      )
      from vc),
    'tecido_com_variante', exists (
      select 1 from modelo_tecidos mt
      join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
      where mt.modelo_id = m.id and mt.tipo = 'tecido'),
    'aviamento_definido', exists (select 1 from modelo_aviamentos ma where ma.modelo_id = m.id and ma.aviamento_id is not null),
    'anexo_croqui', coalesce(m.croqui_url, '') <> '',
    'desenho_tecnico_anexado', coalesce(m.desenho_tecnico_url, '') <> '',
    'anexo_modelo', coalesce(array_length(m.fotos_modelo, 1), 0) > 0,
    'ficha_medida_anexada', coalesce(m.ficha_medida_url, '') <> '',
    'enviado_cad', coalesce(m.enviado_cad, false),
    -- CAD
    'cad_preenchido', exists (
      select 1
      from cad c
      join cad_tecidos ct on ct.cad_id = c.id
      join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
      where c.modelo_id = m.id
        and (coalesce(ct.tamanho_folha, 0) > 0
             or coalesce(ctv.quantidade_folhas, 0) > 0
             or coalesce(ctv.metragem_planejada, 0) > 0)
    ),
    -- Produção / Serviços
    'servico_aprovado', coalesce(m.custo_terceirizados_aprovado, false),
    'servico_finalizado', (
      select count(*) filter (where coalesce(pt.ativo, true)) > 0
         and count(*) filter (where coalesce(pt.ativo, true) and not (
              pt.data_entregue is not null and coalesce(pt.quantidade_enviada, 0) > 0
              and (coalesce(pt.quantidade_recebida, 0) > 0 or coalesce(pt.quantidade_defeito, 0) > 0)
            )) = 0
      from producao_terceirizados pt join cad c on c.id = pt.cad_id
      where c.modelo_id = m.id),
    'grade_cortada_lancada', exists (
      select 1
      from cad c
      join producao_terceirizados pt on pt.id = public._resolver_fonte_confeccao(c.id)
      join lateral jsonb_path_query(coalesce(pt.grade_detalhe, '{}'::jsonb), '$.*.*') cell on true
      where c.modelo_id = m.id
        and coalesce((cell->>'cortada')::numeric, 0) > 0
    ),
    'direcionamento_feito', exists (select 1 from cad c where c.modelo_id = m.id and c.direcionamento_confirmado_at is not null),
    -- CQ
    'cq_confirmado', exists (select 1 from cad c join controle_qualidade cq on cq.cad_id = c.id where c.modelo_id = m.id and cq.status = 'confirmado'),
    'cq_pos_confirmado', exists (select 1 from cad c join controle_qualidade cq on cq.cad_id = c.id where c.modelo_id = m.id and cq.status_pos = 'confirmado'),
    'cq_liberado', coalesce((select public._cq_liberado(c.id) from cad c where c.modelo_id = m.id), false)
  )), '{}'::jsonb)
  from modelos m
  where m.tenant_id = public.get_user_tenant_id() and m.id = any(_ids);
$function$;

-- Auditoria do motor de regras do kanban (Desenvolvimento) — 2 condições novas no catálogo:
--
-- 1) `cq_liberado` (módulo CQ): espelha o predicado ÚNICO `_cq_liberado`/`cqLiberado()`
--    (src/lib/cq-status.ts, já usado por Direcionamento/Lançar/Lançamentos) — Pré confirmado
--    E (se há serviço pós-costura ATIVO) Pós confirmado. As condições `cq_confirmado`/
--    `cq_pos_confirmado` (pré-existentes) continuam vivas como sinais crus separados, mas
--    configurar só `cq_pos_confirmado` como requisito bloquearia PARA SEMPRE qualquer modelo
--    sem serviço pós-costura (status_pos nunca sai de 'pendente' nesse caso) — `cq_liberado`
--    é o predicado correto p/ gate de kanban e evita essa pegadinha. Reusa o helper
--    `_cq_liberado(uuid)` já existente (20260718300000) — zero duplicação de lógica.
--
-- 2) `grade_cortada_lancada` (módulo Serviços): o bloco-fonte de confecção (PL/Oficina,
--    destrinchado+ativo, resolvido por `_resolver_fonte_confeccao` — feature Grade Cortada,
--    20260806180000) tem CORTADA > 0 em alguma célula do `grade_detalhe`. Sinal de que o corte
--    já foi lançado pela confecção, distinto de "enviada"/"recebida"/"defeito". Só faz sentido
--    p/ tenants que usam a quantidade detalhada por tamanho×variante (`detalhado=true`); modelo
--    sem bloco-fonte destrinchado nunca satisfaz (mesma classe de opt-in de `anexo_croqui` etc.).
--
-- Candidatas AVALIADAS e NÃO adicionadas (ver relatório da auditoria):
--  - `mao_obra_aprovada_por_servico`: já coberta por `servico_aprovado` (repontada jul/2026 p/
--    `custo_terceirizados_aprovado`, hoje DERIVADO de `modelo_servico_mo` por trigger — mesma key).
--  - `preco_venda` > 0: já existe como `preco_venda_preenchido`.
--  - "produto acabado vinculado" (revenda): modelos `origem='revenda'` NUNCA setam
--    `ordem_criacao_enviada=true` (verificado: 0 linhas no banco) — não entram no kanban de
--    Desenvolvimento, então a condição não teria onde se aplicar.
--
-- Nenhuma remoção: todas as condições do catálogo atual seguem lendo coluna/tabela viva com
-- semântica válida (auditoria completa no relatório). Nenhum tenant tem `cq_confirmado`/
-- `cq_pos_confirmado`/qualquer key nova em `kanban_requisitos` hoje (checado no banco) — não há
-- config de tenant a migrar.
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
    -- Produção / Serviços
    'cad_confirmado', exists (select 1 from cad c where c.modelo_id = m.id and c.enviado_corte),
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

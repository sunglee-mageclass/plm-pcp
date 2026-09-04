-- Kanban Fase 3 (Parte B) — VARIANTES DE GATILHO de "Aprovação de custo"
-- ============================================================================
-- Hoje só existe `servico_aprovado` (= toda a MO por serviço aprovada; modelo sem linha
-- conta como liberado — `modelos.custo_terceirizados_aprovado`, derivado de modelo_servico_mo).
-- O dono quer 3 rigores diferentes para a loja escolher como requisito de coluna:
--   • servico_aprovado          → toda MO APROVADA (o de hoje; nenhuma pendente/reprovada).
--   • servico_mo_decidido (NOVO)→ toda linha DECIDIDA (aprovada OU reprovada; nenhuma pendente).
--                                 Uma linha reprovada JÁ conta como decidida (diferente de aprovada).
--   • servico_mo_preenchido(NOVO)→ existe ≥1 linha com VALOR (> 0), independentemente de aprovação.
--
-- Convenção de "sem linha" (paridade com servico_aprovado, que trata modelo sem linha como
-- liberado): `servico_mo_decidido` é vacuosamente true sem linhas (nada pendente); já
-- `servico_mo_preenchido` exige ≥1 linha com valor → false sem linhas.
--
-- Redefine `_avaliar_condicoes_kanban_core` (SSOT das ~32 condições) adicionando as 2 chaves
-- logo após `servico_aprovado`. Corpo das demais condições PRESERVADO byte-a-byte (diff-validado).
-- O wrapper público `avaliar_condicoes_kanban` (delega ao core) não muda. Anti-drift TS↔RPC:
-- o catálogo `CONDICOES` (kanban-condicoes.ts) já traz as 2 keys; o teste
-- tests/integration/kanban-condicoes.test.ts falha se RPC ≠ catálogo.

BEGIN;

CREATE OR REPLACE FUNCTION public._avaliar_condicoes_kanban_core(_tenant uuid, _ids uuid[])
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
    -- Variantes de gatilho de "Aprovação de custo" (Fase 3B): olham DIRETO modelo_servico_mo.
    -- DECIDIDO: nenhuma linha pendente (aprovado IS NULL). Vacuosamente true sem linhas
    -- (paridade com servico_aprovado). PREENCHIDO: ≥1 linha com valor > 0 (false sem linhas).
    'servico_mo_decidido', not exists (
      select 1 from modelo_servico_mo mm where mm.modelo_id = m.id and mm.aprovado is null),
    'servico_mo_preenchido', exists (
      select 1 from modelo_servico_mo mm where mm.modelo_id = m.id and coalesce(mm.valor, 0) > 0),
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
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$;

-- ACL inalterada (core segue revogado dos três; wrapper só authenticated) — reafirma por garantia.
REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_kanban_core(uuid, uuid[]) FROM public, anon, authenticated;

COMMIT;

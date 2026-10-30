-- Inverso NEUTRO de supabase/migrations/20261103194000_urg_r9_kanban_peca_teste.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 3 / R9c; Rulings 13, 14, 27) + spec-r9.md (Requisito do kanban) + revisao T1 (achado 1).
-- NEUTRO: _avaliar_condicoes_kanban_core volta ao texto de ANTES (394578c1, sem a chave). RECUSA se alguma loja exigir
-- peca_teste_aprovada (tenant_config.kanban_requisitos / revenda_kanban_requisitos / kanban_requisitos_excecoes): sem a chave
-- no mapa o card ficaria travado para sempre. Idempotente (2a vez = no-op).
-- Trava (MEDIDA, mesma receita): ~6-9 ms, so catalogo (CREATE OR REPLACE) + leitura de tenant_config/tenants (guarda) e as
-- tabelas do corpo (AccessShareLock): nenhuma trava de escrita; nada em auth/storage/realtime. Qualquer hora.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._avaliar_condicoes_kanban_core(uuid,uuid[])
--     ANTES  394578c15aecc303224356a554380de1
--     DEPOIS a95b92f0020667c4e1d38cc771d49212
--   dependencias FIXADAS (nao redefinidas):
--     public._peca_teste_aprovada(uuid,uuid,uuid) 417fa9850a5a52204f62476818dc408c
--     public.avaliar_condicoes_kanban(uuid[]) 855db089af9e12d6d16201d7ed490cc6
--     public._kanban_cond_modulos() e8196983de17cc5b8cf52c1810e53af2
-- ====================================================================================
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._avaliar_condicoes_kanban_core(uuid,uuid[])', '394578c15aecc303224356a554380de1', 'a95b92f0020667c4e1d38cc771d49212')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r9c_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- a chave peca_teste_aprovada sai do mapa: loja que a exige (requisitos, revenda ou excecoes, qualquer nivel do jsonb) teria o
  -- card travado para sempre -> RECUSA (Passo 0-V do roteiro: tirar o requisito na Config da Loja antes)
  SELECT string_agg(coalesce(t.nome, '?') || ' (' || tc.tenant_id::text || ')', ', ' ORDER BY tc.tenant_id) INTO v
    FROM public.tenant_config tc LEFT JOIN public.tenants t ON t.id = tc.tenant_id
   WHERE coalesce(tc.kanban_requisitos::text, '') LIKE '%"peca_teste_aprovada"%'
      OR coalesce(tc.revenda_kanban_requisitos::text, '') LIKE '%"peca_teste_aprovada"%'
      OR coalesce(tc.kanban_requisitos_excecoes::text, '') LIKE '%"peca_teste_aprovada"%';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r9c_down: peca_teste_aprovada em uso em %; tire o requisito na Config da Loja antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- 1) funcoes EXISTENTES de volta ao texto de ANTES
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
    'colecao_preenchida', (coalesce(btrim(m.colecao),'') <> '' OR m.colecao_id IS NOT NULL),  -- [modularidade P12] texto OU colecao do OTB
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
    -- Enviado para PCP = saiu da Explosão (cad.enviado_corte). Revenda satisfaz ao Enviar para PCP.
    'enviado_para_pcp', exists (select 1 from cad c where c.modelo_id = m.id and coalesce(c.enviado_corte, false)),
    -- Separar/Enviar preenchido: metragem (tecido) OU qtd a separar (aviamento) OU qtd a enviar
    -- (etiqueta/insumo) > 0 na Explosão. Revenda tem etiqueta (cad_etiquetas) → satisfaz por ela.
    'separar_enviar_preenchido', (
      exists (
        select 1 from cad c
        join cad_tecidos ct on ct.cad_id = c.id
        join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
        where c.modelo_id = m.id and coalesce(ctv.metragem_enviada, 0) > 0)
      or exists (
        select 1 from cad c
        join cad_aviamentos ca on ca.cad_id = c.id
        where c.modelo_id = m.id and coalesce(ca.quantidade_separar, 0) > 0)
      or exists (
        select 1 from cad c
        join cad_etiquetas ce on ce.cad_id = c.id
        where c.modelo_id = m.id and coalesce(ce.quantidade_enviar, 0) > 0)
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
    -- leves L3 kanban #11: bool_or (agregado) - modelo com 2+ CADs (legado) nao derruba mais o lote inteiro.
    'cq_liberado', coalesce((select bool_or(public._cq_liberado(c.id)) from cad c where c.modelo_id = m.id), false)
  ) || z.na), '{}'::jsonb)
  from modelos m
  -- [modularidade P-254 A] condicao cujo modulo a LOJA nao tem "nao se aplica" = satisfeita (derivacao, cascata, guarda,
  -- previa e a tela leem este mapa). Mapa: _kanban_cond_modulos() (espelho de `requer` no catalogo TS).
  cross join (select public._kanban_cond_na(_tenant) as na) z
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._avaliar_condicoes_kanban_core(uuid,uuid[])', '394578c15aecc303224356a554380de1', '{postgres=X/postgres,service_role=X/postgres}', false, true)
    ) AS x(f, m, acl, w, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9c_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.w
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9c_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;

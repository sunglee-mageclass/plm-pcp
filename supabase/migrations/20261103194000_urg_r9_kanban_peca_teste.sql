-- Urgentes R9c - condicao do kanban 'Peca teste aprovada' (chave peca_teste_aprovada no mapa de avaliar_condicoes_kanban). GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 3 / R9c; Rulings 13, 14, 27) + spec-r9.md (Requisito do kanban) + revisao T1 (achado 1).
-- O que muda (so catalogo: CREATE OR REPLACE FUNCTION; nenhum dado; nenhuma loja exige a chave nova -> nenhum card muda de coluna):
--   1) funcao EXISTENTE _avaliar_condicoes_kanban_core (Mod T3 20261103120000, ANTES 394578c1) ganha a chave 'peca_teste_aprovada'
--      no mapa (logo depois de servico_mo_preenchido; 40 pares no jsonb_build_object = 80 argumentos < 100): TODA linha de M.O.
--      cujo tipo exige peca teste tem a M.O. aprovada E a peca teste aprovada pelo predicado unico _peca_teste_aprovada (193000).
--      Sem linha exigindo = cumprido. _kanban_cond_modulos NAO muda (a condicao nao exige modulo; vale tambem para revenda).
-- Recalculo: o kanban automatico ja enfileira por tentativa (192000), por linha de M.O. (gatilhos existentes) e pela loja inteira
-- ao mudar o switch exige_peca_teste (WHEN da 192000); a regressao do kanban manual vem do gatilho da 192000.
-- Trava (MEDIDA na copia local, supautils carregado, diferenca de pg_locks numa txn REVERTIDA, arquivo inteiro; 1a vez e
-- reaplicada): ~9-17 ms, SO catalogo (CREATE OR REPLACE FUNCTION). Relacoes: AccessShareLock nas 14 tabelas que o corpo
-- LANGUAGE sql cita (validacao do corpo: modelos, modelo_servico_mo, categorias_terceirizado, BOM, cad*, controle_qualidade,
-- producao_terceirizados) e em information_schema.columns (guarda) - so esperam DDL nelas; NENHUMA trava de escrita; NADA em
-- auth/storage/realtime. Qualquer hora. 55P03 = nada mudou, rodar de novo. Idempotente (2a vez = mesmo md5).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._avaliar_condicoes_kanban_core(uuid,uuid[])
--     ANTES  394578c15aecc303224356a554380de1
--     DEPOIS a95b92f0020667c4e1d38cc771d49212
--   dependencias FIXADAS (nao redefinidas):
--     public._peca_teste_aprovada(uuid,uuid,uuid) 417fa9850a5a52204f62476818dc408c
--     public.avaliar_condicoes_kanban(uuid[]) 855db089af9e12d6d16201d7ed490cc6
--     public._kanban_cond_modulos() e8196983de17cc5b8cf52c1810e53af2
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103194000_urg_r9_kanban_peca_teste_down.sql - ANTES do 20261103193000_down e de qualquer volta da Modularidade
-- (o 20261103120000_down exige _avaliar_condicoes_kanban_core = 394578c1 e RECUSA com esta viva). O _down RECUSA se alguma loja
-- exigir peca_teste_aprovada (requisitos/revenda/excecoes): tirar na Config da Loja antes (Passo 0-V). Sem _down_drop.
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
      RAISE EXCEPTION 'urg_r9c: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- dependencias FIXADAS (nao redefinidas aqui): o texto de hoje
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_aprovada(uuid,uuid,uuid)', '417fa9850a5a52204f62476818dc408c'),
      ('public.avaliar_condicoes_kanban(uuid[])', '855db089af9e12d6d16201d7ed490cc6'),
      ('public._kanban_cond_modulos()', 'e8196983de17cc5b8cf52c1810e53af2')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9c: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado'
                   AND column_name = 'exige_peca_teste') THEN
    RAISE EXCEPTION 'urg_r9c: exige a 20261103192000 (urg R9a) aplicada' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- 1) funcao EXISTENTE redefinida (troca exata sobre o texto de ANTES)
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
    -- [urg r9c] Peca teste aprovada (P-310 A + P-319 A): TODA linha de M.O. cujo tipo (da loja) exige peca teste tem a M.O. APROVADA
    -- e a peca teste APROVADA pelo predicado unico _peca_teste_aprovada (193000: tentativa ATUAL aprovada E fornecedor congelado na
    -- decisao = o fornecedor ATUAL da linha). Sem linha exigindo = cumprido (vacuo). Nao exige modulo; revenda/importado: disponivel.
    'peca_teste_aprovada', not exists (
      select 1 from modelo_servico_mo pm
      join categorias_terceirizado pc on pc.id = pm.categoria_terceirizado_id and pc.tenant_id = m.tenant_id and pc.exige_peca_teste
      where pm.modelo_id = m.id
        and (pm.aprovado is not true
             or not public._peca_teste_aprovada(pm.id, pm.categoria_terceirizado_id, pm.empresa_id))),
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
      ('public._avaliar_condicoes_kanban_core(uuid,uuid[])', 'a95b92f0020667c4e1d38cc771d49212', '{postgres=X/postgres,service_role=X/postgres}', false, true)
    ) AS x(f, m, acl, w, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9c: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.w
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9c: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;

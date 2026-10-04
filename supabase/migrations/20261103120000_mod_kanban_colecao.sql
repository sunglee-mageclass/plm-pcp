-- Modularidade T3 — kanban sabe de modulo + colecao pelo id (Partes 8 e 12). GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod3.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M3/M4/M5/M10, §5 T3, §13); desenho.md (+ RESPOSTAS DO DONO, P-254 A).
-- O que muda (troca de texto EXATA sobre o texto vivo; nada mais nas 6 funcoes):
--   3 auxiliares NOVOS (DEFINER, search_path public, EXECUTE revogado dos 3): _kanban_cond_modulos() (mapa M5 condicao ->
--     modulos; espelho de `requer` no catalogo TS), _kanban_cond_na(uuid) (condicoes que nao se aplicam na LOJA, pelo
--     _tenant_modulo_ligado da T1: sem JWT, sem atalho de super) e _modelo_colecao_rotulo(uuid,uuid,text) (nome da colecao
--     da mesma loja, senao o texto; MESMA regra de _integracao_extras).
--   _avaliar_condicoes_kanban_core (P-254 A, M3): condicao de modulo desligado = true ("nao se aplica") - derivacao,
--     cascata, guarda, previa e a tela leem este mapa; e colecao_preenchida aceita colecao_id (P12).
--   salvar_loja (M4): modules mudou de fato -> _kanban_enfileirar_tenant(_id) (recalcula no COMMIT; sem gatilho novo).
--   _dashboard_colecao/custos/producao/producao_servicos_core (P12, M10): filtro, agrupamento e lista de colecoes pelo
--     ROTULO (_modelo_colecao_rotulo). _dashboard_leadtime_itens_core NAO muda (ja filtra por id).
-- ACL, SECURITY DEFINER e search_path das 6 ficam iguais (pos-condicao).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._kanban_cond_modulos() (NOVA)
--     ANTES  ausente
--     DEPOIS e8196983de17cc5b8cf52c1810e53af2
--   public._kanban_cond_na(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 625aa805421941e40a0e82f5b3f2925b
--   public._modelo_colecao_rotulo(uuid,uuid,text) (NOVA)
--     ANTES  ausente
--     DEPOIS e9220bc3a67b82ddcd768b8ad5a81a46
--   public._avaliar_condicoes_kanban_core(uuid,uuid[])  [P8 (P-254 A) + P12]
--     ANTES  e6f3fceae7e6eb6f4589d4858e01d1d6
--     DEPOIS 394578c15aecc303224356a554380de1
--   public.salvar_loja(uuid,text,text,text,text,jsonb)  [M4 (P-254 A)]
--     ANTES  519ad32fd206f7fef53f42d297945fcd
--     DEPOIS 1c4dd54bc32c7605b6c389dcf3f5951d
--   public._dashboard_colecao_core(date,date,text,uuid,uuid)  [P12 (M10)]
--     ANTES  9435f724d61227a7014d95a95cf7fac5
--     DEPOIS e216bde59e8da32b0415b1318cf9d461
--   public._dashboard_custos_core(date,date,text,uuid,uuid)  [P12 (M10)]
--     ANTES  177263673f730f333b2870acd59e8859
--     DEPOIS 4ba33f5fb51695c62cda66b971728071
--   public._dashboard_producao_core(date,date,text,uuid)  [P12 (M10)]
--     ANTES  2662bae65ab7fb9c1c7cb012273481be
--     DEPOIS 2faa32104542259e36e50ff46a007eb7
--   public._dashboard_producao_servicos_core(date,date,text,uuid,text)  [P12 (M10)]
--     ANTES  197f3136e7ef2f3be6ade7169e863692
--     DEPOIS b456136272b4a74d9a198ac3a19d038c
--   dependencias fixadas: public._tenant_modulo_ligado(uuid,text) = 0c9655642d6b570f9adaf136bcaa09c7; public._kanban_enfileirar_tenant(uuid) = d27c6401de3659f1b352eb18e867c7ef; public._cq_liberado(uuid) = 55a5f7ad704a061087e0fc154d4605e7; public._kanban_norm(text) = 74606b6e06de34fa23fd0642d1ebafbb
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION / REVOKE de funcao): nenhuma tabela, nada de auth/storage/realtime.
-- Sem DROP, sem CREATE TRIGGER/POLICY.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261103120000_mod_kanban_colecao_down.sql (LIFO: depois do inverso de 20261103130000 desta frente e ANTES dos inversos de 110000/100000;
-- o _down_drop da T1 recusa enquanto _kanban_cond_na citar _tenant_modulo_ligado - rode o _down_drop desta antes). Inversos
-- antigos que guardam estas funcoes por md5 (L3 20261027100000_down, F1 kanban 20260930140000_down, R12 20261022100000_down,
-- L4 20261027200000_down; ver md5-mod3.txt) so DEPOIS do _down desta.
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
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
      ('public._avaliar_condicoes_kanban_core(uuid,uuid[])', 'e6f3fceae7e6eb6f4589d4858e01d1d6', '394578c15aecc303224356a554380de1'),
      ('public.salvar_loja(uuid,text,text,text,text,jsonb)', '519ad32fd206f7fef53f42d297945fcd', '1c4dd54bc32c7605b6c389dcf3f5951d'),
      ('public._dashboard_colecao_core(date,date,text,uuid,uuid)', '9435f724d61227a7014d95a95cf7fac5', 'e216bde59e8da32b0415b1318cf9d461'),
      ('public._dashboard_custos_core(date,date,text,uuid,uuid)', '177263673f730f333b2870acd59e8859', '4ba33f5fb51695c62cda66b971728071'),
      ('public._dashboard_producao_core(date,date,text,uuid)', '2662bae65ab7fb9c1c7cb012273481be', '2faa32104542259e36e50ff46a007eb7'),
      ('public._dashboard_producao_servicos_core(date,date,text,uuid,text)', '197f3136e7ef2f3be6ade7169e863692', 'b456136272b4a74d9a198ac3a19d038c')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'mod3_kanban_colecao: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._tenant_modulo_ligado(uuid,text)', '0c9655642d6b570f9adaf136bcaa09c7'),
      ('public._kanban_enfileirar_tenant(uuid)', 'd27c6401de3659f1b352eb18e867c7ef'),
      ('public._cq_liberado(uuid)', '55a5f7ad704a061087e0fc154d4605e7'),
      ('public._kanban_norm(text)', '74606b6e06de34fa23fd0642d1ebafbb')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod3_kanban_colecao: dependencia % com texto inesperado (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._kanban_cond_modulos()', 'e8196983de17cc5b8cf52c1810e53af2'),
      ('public._kanban_cond_na(uuid)', '625aa805421941e40a0e82f5b3f2925b'),
      ('public._modelo_colecao_rotulo(uuid,uuid,text)', 'e9220bc3a67b82ddcd768b8ad5a81a46')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.m THEN
      RAISE EXCEPTION 'mod3_kanban_colecao: % ja existe com texto inesperado (md5 %) - outra frente mexeu', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._kanban_cond_modulos()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [modularidade T3/M5] condicao do kanban -> modulos da LOJA que ela exige (todos). ESPELHO de `requer` em
  -- `src/lib/kanban-condicoes.ts` (anti-drift). Condicao fora do mapa vale sempre (ex.: lancado, P-252 A).
  SELECT '{"enviado_cad": ["criacao", "entrada_saida"], "cad_preenchido": ["criacao", "entrada_saida"], "enviado_para_pcp": ["criacao", "entrada_saida"], "separar_enviar_preenchido": ["criacao", "entrada_saida"], "servico_finalizado": ["producao"], "grade_cortada_lancada": ["producao"], "direcionamento_feito": ["producao"], "cq_confirmado": ["producao"], "cq_pos_confirmado": ["producao"], "cq_liberado": ["producao"]}'::jsonb
$function$;
REVOKE EXECUTE ON FUNCTION public._kanban_cond_modulos() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._kanban_cond_na(_tenant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [modularidade T3/P-254 A] condicoes que "nao se aplicam" na LOJA (algum modulo exigido desligado) -> {chave: true}.
  -- Modulo da LOJA = _tenant_modulo_ligado (sem JWT, sem atalho de super admin - M2).
  SELECT coalesce(jsonb_object_agg(e.k, true), '{}'::jsonb)
    FROM jsonb_each(public._kanban_cond_modulos()) e(k, mods)
   WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.mods) x(m) WHERE NOT public._tenant_modulo_ligado(_tenant, x.m))
$function$;
REVOKE EXECUTE ON FUNCTION public._kanban_cond_na(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._modelo_colecao_rotulo(_tenant uuid, _colecao_id uuid, _colecao text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [modularidade T3/P12] rotulo da colecao do card: nome da colecao (id, da MESMA loja), senao o texto livre (trim; vazio =
  -- NULL). MESMA regra de _integracao_extras (colecao) e de `rotuloColecao` (TS, src/lib/colecao-rotulo.ts) - anti-drift.
  SELECT coalesce((SELECT c.nome::text FROM public.colecoes c WHERE c.id = _colecao_id AND c.tenant_id = _tenant),
                  nullif(btrim(coalesce(_colecao, '')), ''))
$function$;
REVOKE EXECUTE ON FUNCTION public._modelo_colecao_rotulo(uuid,uuid,text) FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.salvar_loja(_id uuid, _nome text, _cnpj text, _contato text, _logo_url text, _modules jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mod_antes jsonb;  -- [modularidade M4]
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Apenas super_admin pode editar uma loja' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenants
     SET nome = _nome,
         cnpj = _cnpj,
         contato = _contato,
         logo_url = COALESCE(_logo_url, logo_url)  -- NULL = mantém a logo atual
   WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada'; END IF;

  IF _modules IS NOT NULL THEN
    SELECT tc.modules INTO v_mod_antes FROM public.tenant_config tc WHERE tc.tenant_id = _id;
    INSERT INTO public.tenant_config (tenant_id, modules)
    VALUES (_id, _modules || '{"cadastro": true}'::jsonb)  -- cadastro sempre on
    ON CONFLICT (tenant_id) DO UPDATE SET modules = EXCLUDED.modules;
    -- [modularidade M4/P-254 A] modulos mudaram: o kanban automatico da loja recalcula no COMMIT (condicao de modulo
    -- desligado passa a "nao se aplica" e vice-versa). Sem a chave ligada, _kanban_enfileirar_tenant nao faz nada.
    IF v_mod_antes IS DISTINCT FROM (SELECT tc.modules FROM public.tenant_config tc WHERE tc.tenant_id = _id) THEN
      PERFORM public._kanban_enfileirar_tenant(_id);
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._dashboard_colecao_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_estilista uuid DEFAULT NULL::uuid, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_total int := 0; v_planej int := 0; v_desenv int := 0; v_prod int := 0; v_lanc int := 0; v_reprov int := 0;
  v_reach_dev int := 0; v_reach_prod int := 0; v_pie jsonb;
  v_por_linha jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- [medios R12, prod #2] "Lancado" = modelos.lancado SOZINHO (inv. #6, fonte unica). O comprado (revenda/importado)
  -- nunca vai a Explosao por enviado_cad: conta como "Em Producao" quando ja tem CAD (o receber materializa o CAD) e,
  -- lancado, sai de Planejamento/Desenvolvimento/Producao e entra em Lancados (ruling do controlador, plan.md).
  -- [leves L4, prod #10] "chegou ao Desenvolvimento" (inv. #11) = ordem_criacao_enviada, em qualquer origem. O
  -- comprado (revenda/importado) SEM a ordem segue pelo status_planejamento, como antes.
  -- [leves L4 round 3, P-215 A] balde proprio "Reprovados": card reprovado no Dev OU no Planejamento (predicado da
  -- P-213 A) e NAO lancado sai de Planejamento/Desenvolvimento/Producao. Lancado + reprovado fica em Lancados
  -- (lancado e final - modelos.lancado, inv. #6 - e so acontece com CQ liberado). Os 5 baldes
  -- (Planejamento/Desenvolvimento/Producao/Lancados/Reprovados) sao uma particao: somam o total. O funil
  -- (Desenvolvimento/Producao) tambem tira o reprovado nao lancado e ganha a linha "Reprovados".
  WITH mods AS (
    SELECT mo.id, mo.status_planejamento AS sp,
           (COALESCE(mo.enviado_cad, false)
             OR (mo.origem IN ('revenda','importado') AND EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = mo.id))) AS ec,
           (mo.ordem_criacao_enviada
             OR (mo.origem IN ('revenda','importado') AND mo.status_planejamento IS NOT DISTINCT FROM 'planejado')) AS dev,
           mo.categoria_principal_id AS cat,
           (lower(COALESCE(mo.status_desenvolvimento,'')) = 'reprovado'
             OR lower(COALESCE(mo.status_planejamento,'')) = 'reprovado') AS rep,
           COALESCE(mo.lancado, false) AS lanc
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(mo.tenant_id, mo.colecao_id, mo.colecao) = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
      AND (p_linha IS NULL OR mo.linha_id = p_linha)
      AND public._modelo_no_periodo(mo.mes_id, mo.ano_id, p_inicio, p_fim)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE NOT ec AND NOT lanc AND NOT rep AND NOT dev),
    count(*) FILTER (WHERE NOT ec AND NOT lanc AND NOT rep AND dev),
    count(*) FILTER (WHERE ec AND NOT lanc AND NOT rep),
    count(*) FILTER (WHERE lanc),
    count(*) FILTER (WHERE rep AND NOT lanc),
    count(*) FILTER (WHERE (ec OR lanc OR dev) AND NOT (rep AND NOT lanc)),
    count(*) FILTER (WHERE (ec OR lanc) AND NOT (rep AND NOT lanc)),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', nome, 'value', total))
              FROM (SELECT COALESCE(cp.nome,'Sem categoria') AS nome, count(*) AS total
                    FROM mods LEFT JOIN categorias_produto cp ON cp.id = mods.cat GROUP BY 1) x), '[]'::jsonb)
  INTO v_total, v_planej, v_desenv, v_prod, v_lanc, v_reprov, v_reach_dev, v_reach_prod, v_pie
  FROM mods;

  -- Destrinche por LINHA — MESMAS 5 métricas dos KPIs, por linha_id (NULL => "Sem linha").
  WITH mods AS (
    SELECT mo.linha_id AS linha_id, mo.status_planejamento AS sp,
           (COALESCE(mo.enviado_cad, false)
             OR (mo.origem IN ('revenda','importado') AND EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = mo.id))) AS ec,
           (mo.ordem_criacao_enviada
             OR (mo.origem IN ('revenda','importado') AND mo.status_planejamento IS NOT DISTINCT FROM 'planejado')) AS dev,
           (lower(COALESCE(mo.status_desenvolvimento,'')) = 'reprovado'
             OR lower(COALESCE(mo.status_planejamento,'')) = 'reprovado') AS rep,
           COALESCE(mo.lancado, false) AS lanc
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(mo.tenant_id, mo.colecao_id, mo.colecao) = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
      AND (p_linha IS NULL OR mo.linha_id = p_linha)
      AND public._modelo_no_periodo(mo.mes_id, mo.ano_id, p_inicio, p_fim)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'linha_id', linha_id, 'nome', nome,
           'total', total, 'planejamento', planejamento, 'desenvolvimento', desenvolvimento,
           'producao', producao, 'lancados', lancados, 'reprovados', reprovados
         ) ORDER BY (linha_id IS NULL), nome), '[]'::jsonb)
  INTO v_por_linha
  FROM (
    SELECT mods.linha_id AS linha_id, COALESCE(l.nome,'Sem linha') AS nome,
      count(*) AS total,
      count(*) FILTER (WHERE NOT mods.ec AND NOT mods.lanc AND NOT mods.rep AND NOT mods.dev) AS planejamento,
      count(*) FILTER (WHERE NOT mods.ec AND NOT mods.lanc AND NOT mods.rep AND mods.dev) AS desenvolvimento,
      count(*) FILTER (WHERE mods.ec AND NOT mods.lanc AND NOT mods.rep) AS producao,
      count(*) FILTER (WHERE mods.lanc) AS lancados,
      count(*) FILTER (WHERE mods.rep AND NOT mods.lanc) AS reprovados
    FROM mods LEFT JOIN linhas l ON l.id = mods.linha_id
    GROUP BY mods.linha_id, COALESCE(l.nome,'Sem linha')
  ) x;

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object('total', v_total, 'planejamento', v_planej, 'desenvolvimento', v_desenv, 'producao', v_prod, 'lancados', v_lanc, 'reprovados', v_reprov),
    'funnel', jsonb_build_array(
      jsonb_build_object('name','Total','value', v_total),
      jsonb_build_object('name','Desenvolvimento','value', v_reach_dev),
      jsonb_build_object('name','Produção','value', v_reach_prod),
      jsonb_build_object('name','Lançados','value', v_lanc),
      jsonb_build_object('name','Reprovados','value', v_reprov)
    ),
    'pie', v_pie,
    'porLinha', v_por_linha,
    'filtros', jsonb_build_object(
      'estilistas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM colaboradores WHERE tenant_id = v_tenant AND tipo = 'estilista'), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT x.r) FROM (SELECT public._modelo_colecao_rotulo(m2.tenant_id, m2.colecao_id, m2.colecao) AS r FROM modelos m2 WHERE m2.tenant_id = v_tenant) x WHERE x.r IS NOT NULL), '[]'::jsonb)
    )
  );
END;
$function$;

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

  -- [medios R12, preco M3] previsto/real/confirmado vem da FONTE UNICA _custo_unitario_modelos_core (a mesma de
  -- custo_unitario_modelos: revenda e importado pelo custo da compra/landed; interno pelo CAD confirmado). Nao
  -- confirmado (ou real ainda nulo na compra nao recebida) -> real = previsto, como antes.
  WITH ids AS (
    SELECT m.id
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  ),
  cu AS (
    SELECT COALESCE(public._custo_unitario_modelos_core(COALESCE((SELECT array_agg(ids.id) FROM ids), '{}'::uuid[])), '{}'::jsonb) AS j
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) AS colecao, m.versao,
      COALESCE(((cu.j -> (m.id::text)) ->> 'confirmado')::boolean, false) AS confirmado,
      COALESCE(((cu.j -> (m.id::text)) ->> 'previsto')::numeric, 0) AS previsto,
      COALESCE(((cu.j -> (m.id::text)) ->> 'real')::numeric, ((cu.j -> (m.id::text)) ->> 'previsto')::numeric, 0) AS real
    FROM modelos m
    JOIN ids ON ids.id = m.id
    CROSS JOIN cu
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
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT x.r) FROM (SELECT public._modelo_colecao_rotulo(m2.tenant_id, m2.colecao_id, m2.colecao) AS r FROM modelos m2 WHERE m2.tenant_id = v_tenant) x WHERE x.r IS NOT NULL), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._dashboard_producao_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_timeline jsonb; v_kanban jsonb; v_sla jsonb; v_cortes jsonb; v_finalizadas jsonb; v_defeito_mes jsonb; v_por_colecao jsonb; v_por_linha jsonb;
  v_no_prazo int := 0; v_atrasos int := 0; v_total int := 0;
  v_usa_corte boolean := false;
  v_aprov_nao_lanc int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- A loja usa o SERVIÇO "Corte" (terceirizado)? Se não (só PL, corte incluso), os
  -- cards "Modelos cortados / Grade cortada" são redundantes e ficam escondidos.
  SELECT EXISTS(
    SELECT 1 FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
     WHERE ct.nome ILIKE 'corte' AND COALESCE(t.ativo, true)
  ) INTO v_usa_corte;

  -- Timeline (etapa de produção atual) com versão
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'nome', nome, 'versao', versao, 'etapa', etapa) ORDER BY ref), '[]'::jsonb)
  INTO v_timeline
  FROM (
    SELECT cd.id, m.ref, m.nome, m.versao,
      CASE
        WHEN m.lancado THEN 'Lançado'
        WHEN EXISTS(SELECT 1 FROM direcionamento d WHERE d.cad_id = cd.id)
          OR EXISTS(SELECT 1 FROM direcionamento_lojas dl WHERE dl.cad_id = cd.id) THEN 'Direcionamento'
        WHEN EXISTS(SELECT 1 FROM controle_qualidade q WHERE q.cad_id = cd.id) THEN 'Controle de Qualidade'
        WHEN EXISTS(SELECT 1 FROM producao_oficina o WHERE o.cad_id = cd.id AND o.data_enviado IS NOT NULL) THEN 'Oficina'
        WHEN EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = cd.id AND t.ativo) THEN 'Serviço'
        ELSE 'CAD'
      END AS etapa
    FROM cad cd JOIN modelos m ON m.id = cd.modelo_id
    WHERE cd.tenant_id = v_tenant
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
    ORDER BY m.ref LIMIT 200
  ) t;

  -- Kanban do DESENVOLVIMENTO (config de tenant_config.status_kanban; fallback DEFAULT)
  WITH defmap(dkey, dlabel) AS (VALUES
    ('em_modelagem','Em Modelagem'), ('corte_piloto_1','Corte de Piloto I'),
    ('corte_piloto_2','Corte de Piloto II'), ('corte_piloto_3','Corte de Piloto III'),
    ('em_pilotagem','Em Pilotagem'), ('prova_roupa_1','Prova de Roupa I'),
    ('prova_roupa_2','Prova de Roupa II'), ('prova_roupa_3','Prova de Roupa III'),
    ('prova_roupa_4','Prova de Roupa IV'), ('prova_roupa_5','Prova de Roupa V'),
    ('em_ajuste','Em Ajuste'), ('stand_by','Stand By'),
    ('reprovado','Reprovado'), ('aprovado','Aprovado')
  ),
  sk AS (
    SELECT COALESCE(
      (SELECT tc.status_kanban FROM tenant_config tc
         WHERE tc.tenant_id = v_tenant AND jsonb_typeof(tc.status_kanban) = 'array' AND jsonb_array_length(tc.status_kanban) > 0),
      (SELECT jsonb_agg(jsonb_build_object('key',dkey,'label',dlabel)) FROM defmap)
    ) AS arr
  ),
  cols AS (
    -- FIX: coluna-STRING → key via _kanban_resolve_key (slug/label→slug), NÃO a string crua. Assim
    -- "PCP"→"pcp" casa com modelos.status_desenvolvimento. Coluna-objeto usa key/id/value/slug e,
    -- na falta, resolve a partir do label (mesmo critério do _kanban_status_rows).
    SELECT t.ord,
      CASE jsonb_typeof(t.e) WHEN 'string' THEN public._kanban_resolve_key(t.e #>> '{}')
        ELSE COALESCE(t.e->>'key', t.e->>'id', t.e->>'value', t.e->>'slug',
                      public._kanban_resolve_key(COALESCE(t.e->>'label', t.e->>'nome', t.e->>'name', 's'||t.ord::text))) END AS key,
      CASE jsonb_typeof(t.e) WHEN 'string' THEN (t.e #>> '{}')
        ELSE COALESCE(t.e->>'label', t.e->>'nome', t.e->>'name', t.e->>'key', 's'||t.ord::text) END AS label
    FROM sk, LATERAL jsonb_array_elements(sk.arr) WITH ORDINALITY AS t(e, ord)
  ),
  cols2 AS (
    SELECT c.ord, c.key, c.label, (SELECT d.dkey FROM defmap d WHERE d.dlabel = c.label LIMIT 1) AS alias_key FROM cols c
  ),
  firstcol AS (SELECT key FROM cols2 ORDER BY ord LIMIT 1),
  -- [leves L4 round 3, P-215 A] card reprovado (Dev OU Planejamento, predicado da P-213 A) e nao lancado vai para a
  -- coluna Reprovado do quadro (a mesma do balde "Reprovados" de _dashboard_colecao_core); sem essa coluna no quadro,
  -- fica onde esta. Assim nao conta em "Aprovado" (aprovadoNaoLancado). O total do grafico nao muda.
  repcol AS (SELECT c.key FROM cols2 c WHERE c.key = 'reprovado' OR c.alias_key = 'reprovado' ORDER BY c.ord LIMIT 1),
  mods AS (
    SELECT m.id,
      COALESCE(CASE WHEN (lower(COALESCE(m.status_desenvolvimento,'')) = 'reprovado'
                          OR lower(COALESCE(m.status_planejamento,'')) = 'reprovado')
                     AND NOT COALESCE(m.lancado, false)
                    THEN (SELECT key FROM repcol) END,
               (SELECT c.key FROM cols2 c WHERE c.key = m.status_desenvolvimento OR c.alias_key = m.status_desenvolvimento ORDER BY c.ord LIMIT 1),
               (SELECT key FROM firstcol)) AS bucket,
      COALESCE((SELECT SUM(COALESCE(mg.grade_total,0)) FROM modelo_grades mg WHERE mg.modelo_id = m.id), 0) AS grade,
      COALESCE(m.lancado, false) AS lanc,
      (lower(COALESCE(m.status_desenvolvimento,'')) = 'reprovado'
       OR lower(COALESCE(m.status_planejamento,'')) = 'reprovado') AS rep
    FROM modelos m
    -- [leves L4, prod #10] mesmo criterio do KPI Desenvolvimento de _dashboard_colecao_core: chega ao Dev pela
    -- ordem_criacao_enviada (inv. #11); comprado (revenda/importado) sem a ordem segue pelo status_planejamento.
    WHERE m.tenant_id = v_tenant
      AND (m.ordem_criacao_enviada
           OR (m.origem IN ('revenda','importado') AND m.status_planejamento IS NOT DISTINCT FROM 'planejado'))
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  ),
  agg AS (SELECT bucket, count(*) AS modelos, SUM(grade) AS grade FROM mods GROUP BY bucket),
  -- [medios R12, prod #6] coluna "Aprovado" = a de key exata 'aprovado'; senao a 1a cujo label contem "aprovad"
  -- (mesmo criterio do front). aprovadoNaoLancado = modelos nessa coluna que AINDA nao foram lancados.
  ap AS (SELECT c.key FROM cols2 c WHERE c.key = 'aprovado' OR c.label ~* 'aprovad'
          ORDER BY (c.key = 'aprovado') DESC, c.ord LIMIT 1)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'modelos', COALESCE(a.modelos,0), 'grade', COALESCE(a.grade,0)) ORDER BY c.ord), '[]'::jsonb),
         -- [leves L4 round 4, B1] reprovado nunca conta como "aprovado, nao lancado" (quadro sem coluna Reprovado).
         (SELECT count(*) FROM mods WHERE mods.bucket = (SELECT ap.key FROM ap) AND NOT mods.lanc AND NOT mods.rep)
  INTO v_kanban, v_aprov_nao_lanc
  FROM cols2 c LEFT JOIN agg a ON a.bucket = c.key;

  -- Cortes por mês = data de entrega dos Serviços (producao_terceirizados.data_entregue)
  WITH cortes AS (
    SELECT c.modelo_id,
      (SELECT max(t.data_entregue) FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.data_entregue IS NOT NULL) AS dt,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = c.id), 0) AS grade
    FROM cad c JOIN modelos m ON m.id = c.modelo_id
    WHERE c.tenant_id = v_tenant AND c.enviado_corte
      AND EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.data_entregue IS NOT NULL)
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_cortes
  FROM (
    SELECT to_char(dt,'YYYY-MM') AS k, to_char(dt,'Mon/YY') AS mes,
           count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade
    FROM cortes
    WHERE dt IS NOT NULL AND (p_inicio IS NULL OR dt >= p_inicio) AND (p_fim IS NULL OR dt <= p_fim)
    GROUP BY 1, 2
  ) x;

  -- Produção finalizada por mês = Serviços com status finalizado
  WITH fin AS (
    SELECT c.modelo_id,
      (SELECT max(t.data_entregue) FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.status = 'finalizado' AND t.data_entregue IS NOT NULL) AS dt,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = c.id), 0) AS grade
    FROM cad c JOIN modelos m ON m.id = c.modelo_id
    WHERE c.tenant_id = v_tenant
      AND EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.status = 'finalizado')
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_finalizadas
  FROM (
    SELECT to_char(dt,'YYYY-MM') AS k, to_char(dt,'Mon/YY') AS mes,
           count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade
    FROM fin
    WHERE dt IS NOT NULL AND (p_inicio IS NULL OR dt >= p_inicio) AND (p_fim IS NULL OR dt <= p_fim)
    GROUP BY 1, 2
  ) y;

  -- SLA por terceirizado
  WITH entregas AS (
    -- Fornecedor = empresa, senão representante, senão colaborador — senão o serviço
    -- (via rep/colaborador ou sem fornecedor) some do "SLA por serviço".
    SELECT COALESCE(emp.nome_fantasia, rep.nome, col.nome, '—') AS nome,
           COALESCE(ct.nome, 'Serviço') AS tipo, t.data_enviado, t.data_prevista, t.data_entregue,
           COALESCE(t.quantidade_recebida,0) AS qrec, COALESCE(t.quantidade_defeito,0) AS qdef
    FROM producao_terceirizados t JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant JOIN modelos m ON m.id = c.modelo_id
      LEFT JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
      LEFT JOIN empresas emp ON emp.id = t.empresa_id
      LEFT JOIN representantes rep ON rep.id = t.representante_id
      LEFT JOIN colaboradores col ON col.id = t.colaborador_id
    WHERE (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nome', nome, 'tipo', tipo, 'slaMedio', slaMedio, 'atrasos', atrasos, 'total', total,
      'pecasProduzidas', pecasProduzidas, 'pecasDefeito', pecasDefeito,
      'taxaDefeito', CASE WHEN pecasProduzidas > 0 THEN ROUND((pecasDefeito::numeric / pecasProduzidas) * 100, 2) ELSE 0 END
    )), '[]'::jsonb)
  INTO v_sla
  FROM (
    SELECT e.nome AS nome, e.tipo AS tipo,
      AVG(EXTRACT(EPOCH FROM (e.data_entregue::timestamp - e.data_enviado::timestamp))/86400)
        FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS slaMedio,
      COUNT(*) FILTER (WHERE e.data_entregue IS NOT NULL AND e.data_prevista IS NOT NULL AND e.data_entregue > e.data_prevista) AS atrasos,
      COUNT(*) FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS total,
      SUM(e.qrec) AS pecasProduzidas, SUM(e.qdef) AS pecasDefeito
    FROM entregas e
    GROUP BY e.nome, e.tipo
  ) s;

  -- KPI prazo
  WITH entregas2 AS (
    SELECT t.data_prevista, t.data_entregue
    FROM producao_terceirizados t JOIN cad c ON c.id=t.cad_id AND c.tenant_id=v_tenant JOIN modelos m ON m.id=c.modelo_id
    WHERE t.data_entregue IS NOT NULL AND t.data_prevista IS NOT NULL
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT count(*) FILTER (WHERE data_entregue <= data_prevista), count(*) FILTER (WHERE data_entregue > data_prevista), count(*)
  INTO v_no_prazo, v_atrasos, v_total FROM entregas2;

    -- Taxa de defeito por mês (entregas de Serviços): Σ defeito / Σ recebido * 100.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'taxa', taxa) ORDER BY k), '[]'::jsonb)
  INTO v_defeito_mes
  FROM (
    SELECT to_char(t.data_entregue,'YYYY-MM') AS k, to_char(t.data_entregue,'Mon/YY') AS mes,
           CASE WHEN SUM(COALESCE(t.quantidade_recebida,0)) > 0
                THEN ROUND(SUM(COALESCE(t.quantidade_defeito,0))::numeric / SUM(COALESCE(t.quantidade_recebida,0)) * 100, 2)
                ELSE 0 END AS taxa
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE t.data_entregue IS NOT NULL
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha   IS NULL OR m.linha_id = p_linha)
    GROUP BY 1, 2
  ) d;

  WITH g AS (
    SELECT public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) AS nome, count(*) AS modelos,
           SUM(COALESCE((SELECT SUM(COALESCE(mg.grade_total,0)) FROM modelo_grades mg WHERE mg.modelo_id = m.id),0)) AS grade
    FROM modelos m
    WHERE m.tenant_id = v_tenant AND public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) IS NOT NULL
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao)
  ), d AS (
    SELECT public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) AS nome,
           CASE WHEN SUM(COALESCE(t.quantidade_recebida,0)) > 0
                THEN ROUND(SUM(COALESCE(t.quantidade_defeito,0))::numeric / SUM(COALESCE(t.quantidade_recebida,0)) * 100, 2)
                ELSE 0 END AS defeito
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE t.data_entregue IS NOT NULL AND public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) IS NOT NULL
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', g.nome, 'modelos', g.modelos, 'grade', g.grade, 'defeito', COALESCE(d.defeito,0)) ORDER BY g.grade DESC), '[]'::jsonb)
  INTO v_por_colecao
  FROM g LEFT JOIN d ON d.nome = g.nome;

  WITH g AS (
    SELECT l.nome AS nome, count(*) AS modelos,
           SUM(COALESCE((SELECT SUM(COALESCE(mg.grade_total,0)) FROM modelo_grades mg WHERE mg.modelo_id = m.id),0)) AS grade
    FROM modelos m JOIN linhas l ON l.id = m.linha_id
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY l.nome
  ), d AS (
    SELECT l.nome AS nome,
           CASE WHEN SUM(COALESCE(t.quantidade_recebida,0)) > 0
                THEN ROUND(SUM(COALESCE(t.quantidade_defeito,0))::numeric / SUM(COALESCE(t.quantidade_recebida,0)) * 100, 2)
                ELSE 0 END AS defeito
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    JOIN linhas l ON l.id = m.linha_id
    WHERE t.data_entregue IS NOT NULL
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY l.nome
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', g.nome, 'modelos', g.modelos, 'grade', g.grade, 'defeito', COALESCE(d.defeito,0)) ORDER BY g.grade DESC), '[]'::jsonb)
  INTO v_por_linha
  FROM g LEFT JOIN d ON d.nome = g.nome;

RETURN jsonb_build_object(
    'defeitoPorMes', v_defeito_mes,
    'porColecao', v_por_colecao, 'porLinha', v_por_linha,
    'timeline', v_timeline, 'kanbanDev', v_kanban, 'aprovadoNaoLancado', v_aprov_nao_lanc, 'cortesPorMes', v_cortes, 'usaCorte', v_usa_corte, 'finalizadasPorMes', v_finalizadas, 'slaPorTerc', v_sla,
    'kpiPrazo', jsonb_build_object('noPrazo', v_no_prazo, 'atrasadas', v_atrasos,
      'pct', CASE WHEN v_total > 0 THEN ROUND((v_no_prazo::numeric/v_total)*100) ELSE 0 END),
    'filtros', jsonb_build_object(
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT x.r) FROM (SELECT public._modelo_colecao_rotulo(m2.tenant_id, m2.colecao_id, m2.colecao) AS r FROM modelos m2 WHERE m2.tenant_id = v_tenant) x WHERE x.r IS NOT NULL), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._dashboard_producao_servicos_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_linha uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_categorias jsonb; v_por_cat jsonb; v_por_idade jsonb; v_entregue jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- Dropdown: NOMES de categoria de serviço com >= 1 bloco (dedup por nome; evita
  -- duplicatas vazias). Ordena pela menor `ordem` do grupo, depois pelo nome.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', nome) ORDER BY ord NULLS LAST, nome), '[]'::jsonb)
  INTO v_categorias
  FROM (
    SELECT ct.nome AS nome, min(ct.ordem) AS ord
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true)
    GROUP BY ct.nome
  ) q;

  -- (a1) EM PRODUÇÃO por SERVIÇO (categoria) — foto atual. Usado quando categoria=Todas.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('categoria', categoria, 'modelos', modelos, 'pecas', pecas)
           ORDER BY pecas DESC, modelos DESC, categoria), '[]'::jsonb)
  INTO v_por_cat
  FROM (
    SELECT ct.nome AS categoria,
           count(DISTINCT c.modelo_id) AS modelos,
           COALESCE(SUM(COALESCE(t.quantidade_enviada,0)),0) AS pecas
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN modelos m ON m.id = c.modelo_id
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true) AND t.status IS DISTINCT FROM 'finalizado'
      AND (p_categoria IS NULL OR ct.nome = p_categoria)
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
    GROUP BY ct.nome
  ) q;

  -- (a2) EM PRODUÇÃO por IDADE (dias desde o envio) — foto atual. Usado com categoria específica.
  WITH blocos AS (
    SELECT c.modelo_id,
           COALESCE(t.quantidade_enviada,0) AS pecas,
           CASE
             WHEN t.data_enviado IS NULL THEN 0
             WHEN (CURRENT_DATE - t.data_enviado) <= 7  THEN 1
             WHEN (CURRENT_DATE - t.data_enviado) <= 15 THEN 2
             WHEN (CURRENT_DATE - t.data_enviado) <= 30 THEN 3
             ELSE 4
           END AS faixa
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN modelos m ON m.id = c.modelo_id
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true) AND t.status IS DISTINCT FROM 'finalizado'
      AND (p_categoria IS NULL OR ct.nome = p_categoria)
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  ),
  faixas(faixa, rotulo) AS (VALUES
    (0,'Sem envio'), (1,'0–7 dias'), (2,'8–15 dias'), (3,'16–30 dias'), (4,'+30 dias')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', f.rotulo, 'ordem', f.faixa,
           'modelos', COALESCE(a.modelos,0), 'pecas', COALESCE(a.pecas,0)) ORDER BY f.faixa), '[]'::jsonb)
  INTO v_por_idade
  FROM faixas f
  LEFT JOIN (
    SELECT faixa, count(DISTINCT modelo_id) AS modelos, SUM(pecas) AS pecas
    FROM blocos GROUP BY faixa
  ) a ON a.faixa = f.faixa;

  -- (b) ENTREGUE ao longo do tempo (mês da data_entregue), status='finalizado'.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'pecas', pecas) ORDER BY k), '[]'::jsonb)
  INTO v_entregue
  FROM (
    SELECT to_char(t.data_entregue,'YYYY-MM') AS k, to_char(t.data_entregue,'Mon/YY') AS mes,
           count(DISTINCT c.modelo_id) AS modelos,
           COALESCE(SUM(COALESCE(t.quantidade_recebida,0)),0) AS pecas
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN modelos m ON m.id = c.modelo_id
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true) AND t.status = 'finalizado' AND t.data_entregue IS NOT NULL
      AND (p_categoria IS NULL OR ct.nome = p_categoria)
      AND (p_colecao IS NULL OR public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND (p_inicio IS NULL OR t.data_entregue >= p_inicio)
      AND (p_fim IS NULL OR t.data_entregue <= p_fim)
    GROUP BY 1, 2
  ) q;

  RETURN jsonb_build_object(
    'categorias', v_categorias,
    'emProducaoPorCategoria', v_por_cat,
    'emProducaoPorIdade', v_por_idade,
    'entreguePorMes', v_entregue
  );
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._avaliar_condicoes_kanban_core(uuid,uuid[])', '394578c15aecc303224356a554380de1', '{postgres=X/postgres,service_role=X/postgres}', false),
      ('public.salvar_loja(uuid,text,text,text,text,jsonb)', '1c4dd54bc32c7605b6c389dcf3f5951d', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public._dashboard_colecao_core(date,date,text,uuid,uuid)', 'e216bde59e8da32b0415b1318cf9d461', '{postgres=X/postgres,service_role=X/postgres}', false),
      ('public._dashboard_custos_core(date,date,text,uuid,uuid)', '4ba33f5fb51695c62cda66b971728071', '{postgres=X/postgres,service_role=X/postgres}', false),
      ('public._dashboard_producao_core(date,date,text,uuid)', '2faa32104542259e36e50ff46a007eb7', '{postgres=X/postgres,service_role=X/postgres}', false),
      ('public._dashboard_producao_servicos_core(date,date,text,uuid,text)', 'b456136272b4a74d9a198ac3a19d038c', '{postgres=X/postgres,service_role=X/postgres}', false)
    ) AS x(f, m, acl, auth) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod3_kanban_colecao: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.auth
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'mod3_kanban_colecao: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF md5(pg_get_functiondef(to_regprocedure('public._kanban_cond_modulos()'))) IS DISTINCT FROM 'e8196983de17cc5b8cf52c1810e53af2'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._kanban_cond_modulos()') AND p.prosecdef
                      AND p.proconfig = ARRAY['search_path=public'])
     OR has_function_privilege('anon', 'public._kanban_cond_modulos()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._kanban_cond_modulos()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._kanban_cond_modulos()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._kanban_cond_modulos()') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'mod3_kanban_colecao: pos-condicao falhou em _kanban_cond_modulos (md5/secdef/search_path/ACL)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._kanban_cond_na(uuid)'))) IS DISTINCT FROM '625aa805421941e40a0e82f5b3f2925b'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._kanban_cond_na(uuid)') AND p.prosecdef
                      AND p.proconfig = ARRAY['search_path=public'])
     OR has_function_privilege('anon', 'public._kanban_cond_na(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._kanban_cond_na(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._kanban_cond_na(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._kanban_cond_na(uuid)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'mod3_kanban_colecao: pos-condicao falhou em _kanban_cond_na (md5/secdef/search_path/ACL)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._modelo_colecao_rotulo(uuid,uuid,text)'))) IS DISTINCT FROM 'e9220bc3a67b82ddcd768b8ad5a81a46'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._modelo_colecao_rotulo(uuid,uuid,text)') AND p.prosecdef
                      AND p.proconfig = ARRAY['search_path=public'])
     OR has_function_privilege('anon', 'public._modelo_colecao_rotulo(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._modelo_colecao_rotulo(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._modelo_colecao_rotulo(uuid,uuid,text)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._modelo_colecao_rotulo(uuid,uuid,text)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'mod3_kanban_colecao: pos-condicao falhou em _modelo_colecao_rotulo (md5/secdef/search_path/ACL)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

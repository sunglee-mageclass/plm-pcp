-- Kanban PL configuravel - Onda 1, bloco C: catalogo PL (lib TS) + AVALIADOR SQL.
-- ADITIVA e idempotente (CREATE OR REPLACE). NAO muda dado; nenhuma tela usa ainda (etapas_pl_automatico
-- default false - a frente so liga na Onda 3). Migration PROPRIA, separada da base (20261126100000, ja aplicada).
--
-- O que cria:
--   1) _avaliar_condicoes_etapas_pl_core(_tenant uuid, _ids uuid[]) RETURNS jsonb  (STABLE SECURITY DEFINER,
--      search_path public, REVOKE EXECUTE dos 3). Mapa {modelo_id::text : {cond_key: bool}} com as 7 keys do
--      catalogo CONDICOES_PL (src/lib/etapas-pl-condicoes.ts). REUSA os helpers REAIS:
--      - peca_teste_aprovada: MESMO predicado da condicao homonima do Dev (_avaliar_condicoes_kanban_core,
--        20261103194000): NOT EXISTS linha de M.O. que exige peca teste (JOIN categorias_terceirizado
--        exige_peca_teste) e nao aprovada (pm.aprovado IS NOT TRUE OR NOT _peca_teste_aprovada(...)). Vacuoso
--        true sem linha.
--      - enviado_a_servicos: EXISTS cad c WHERE c.modelo_id=m.id AND c.enviado_corte.
--      - materiais_separados: >=1 bloco producao_terceirizados ATIVO do CAD do modelo E TODOS com data_enviado
--        (consolidacao "menos avancada" = NOT EXISTS bloco ativo sem data_enviado; 0 blocos = FALSE).
--      - grade_cortada_retornou: TODOS os blocos ativos tem alguma celula de grade_detalhe com cortada>0
--        (mesma expressao de cortadaRetornou/etapaDoBloco em src/lib/pcp-etapas.ts, portada p/ SQL via
--        jsonb_path_query '$.*.*'; 0 blocos = FALSE).
--      - oficina_entregue: TODOS os blocos ativos tem data_entregue IS NOT NULL AND quantidade_recebida>0
--        (0 blocos = FALSE).
--      - cq_liberado: _cq_liberado(c.id) do CAD do modelo (false sem CAD).
--      - lancado: m.lancado IS TRUE.
--      DECISAO TRAVADA: condicao de BLOCO (materiais_separados/grade_cortada_retornou/oficina_entregue) com
--      0 blocos = FALSE (sem material para separar ainda nao "separou").
--   2) avaliar_condicoes_etapas_pl(_ids uuid[]) - wrapper: gate login + _exige_modulos('producao','etapas_pl')
--      (etapas_pl e opt-in; super admin passa, modulo desligado -> 42501). Sem VER a pagina devolve '{}' (MESMO
--      padrao de peca_teste_quadro: PERFORM _exige_modulos; IF NOT user_can_view THEN RETURN). Chama o _core com
--      get_user_tenant_id(). GRANT authenticated; REVOKE PUBLIC/anon.
--
-- RAISE 5xx so ASCII (prefixos tecnicos). Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261126110000_kanban_pl_avaliador.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Trava: so catalogo (CREATE OR REPLACE FUNCTION), ms.
-- Volta: supabase/rollback/20261126110000_kanban_pl_avaliador_down.sql (DROP das 2 funcoes NOVAS - DROP seguro).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   dependencias FIXADAS (nao redefinidas aqui):
--     public._peca_teste_aprovada(uuid,uuid,uuid) 417fa9850a5a52204f62476818dc408c
--     public._cq_liberado(uuid)                    55a5f7ad704a061087e0fc154d4605e7
--   objeto NOVO (pos-condicao):
--     public._avaliar_condicoes_etapas_pl_core(uuid,uuid[]) 3715a292f9cd18a4b8eaa06601e114e9
-- ====================================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

-- Guarda: as dependencias reusadas tem o texto esperado (outra frente mexeu -> aborta, gere de novo).
DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_aprovada(uuid,uuid,uuid)', '417fa9850a5a52204f62476818dc408c'),
      ('public._cq_liberado(uuid)', '55a5f7ad704a061087e0fc154d4605e7')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'kpl_c: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) _core: avaliador PL (reuso, nao motor novo).
CREATE OR REPLACE FUNCTION public._avaliar_condicoes_etapas_pl_core(_tenant uuid, _ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    -- peca_teste_aprovada: MESMO predicado do Dev (_avaliar_condicoes_kanban_core). Vacuoso true sem linha.
    'peca_teste_aprovada', not exists (
      select 1 from modelo_servico_mo pm
      join categorias_terceirizado pc on pc.id = pm.categoria_terceirizado_id and pc.tenant_id = m.tenant_id and pc.exige_peca_teste
      where pm.modelo_id = m.id
        and (pm.aprovado is not true
             or not public._peca_teste_aprovada(pm.id, pm.categoria_terceirizado_id, pm.empresa_id))),
    -- enviado_a_servicos: saiu da Explosao (cad.enviado_corte).
    'enviado_a_servicos', exists (select 1 from cad c where c.modelo_id = m.id and coalesce(c.enviado_corte, false)),
    -- materiais_separados: >=1 bloco ativo E TODOS com data_enviado (0 blocos = false).
    'materiais_separados', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true) and pt.data_enviado is null)
    ),
    -- grade_cortada_retornou: TODOS os blocos ativos tem alguma celula grade_detalhe com cortada>0 (0 blocos = false).
    'grade_cortada_retornou', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true)
          and not exists (
            select 1 from jsonb_path_query(coalesce(pt.grade_detalhe, '{}'::jsonb), '$.*.*') cell
            where coalesce((cell->>'cortada')::numeric, 0) > 0))
    ),
    -- oficina_entregue: TODOS os blocos ativos entregaram (data_entregue + quantidade_recebida>0) (0 blocos = false).
    'oficina_entregue', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true)
          and not (pt.data_entregue is not null and coalesce(pt.quantidade_recebida, 0) > 0))
    ),
    -- cq_liberado: _cq_liberado(c.id) do CAD do modelo (false sem CAD).
    'cq_liberado', coalesce((select bool_or(public._cq_liberado(c.id)) from cad c where c.modelo_id = m.id), false),
    -- lancado: fonte unica = modelos.lancado.
    'lancado', coalesce(m.lancado, false)
  )), '{}'::jsonb)
  from modelos m
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$;

REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_etapas_pl_core(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- 2) wrapper: gate login + modulos; sem VER a pagina -> {} (padrao peca_teste_quadro).
CREATE OR REPLACE FUNCTION public.avaliar_condicoes_etapas_pl(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kpl_c: login necessario' USING ERRCODE = 'P0001';
  END IF;
  -- etapas_pl e opt-in; o modulo desligado -> 42501 (super admin passa). producao e o modulo-pai.
  PERFORM public._exige_modulos('producao', 'etapas_pl');
  IF NOT public.user_can_view('producao_etapas') THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN public._avaliar_condicoes_etapas_pl_core(public.get_user_tenant_id(), _ids);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.avaliar_condicoes_etapas_pl(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_condicoes_etapas_pl(uuid[]) TO authenticated;

-- Pos-condicao: md5 do _core + ACL (EXECUTE revogado dos 3 no _core; authenticated no wrapper; nenhum PUBLIC).
DO $pos$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])')));
  IF v IS DISTINCT FROM '3715a292f9cd18a4b8eaa06601e114e9' THEN
    RAISE EXCEPTION 'kpl_c: pos-condicao falhou no md5 do _core (md5 %, esperado %)', coalesce(v, 'ausente'), '3715a292f9cd18a4b8eaa06601e114e9'
      USING ERRCODE = 'P0001';
  END IF;
  -- _core: EXECUTE revogado dos 3, DEFINER, search_path=public.
  IF has_function_privilege('public', 'public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])')
                      AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
    RAISE EXCEPTION 'kpl_c: pos-condicao falhou na ACL/secdef/search_path do _core' USING ERRCODE = 'P0001';
  END IF;
  -- wrapper: authenticated SIM, PUBLIC/anon NAO, DEFINER.
  IF has_function_privilege('public', 'public.avaliar_condicoes_etapas_pl(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.avaliar_condicoes_etapas_pl(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.avaliar_condicoes_etapas_pl(uuid[])', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.avaliar_condicoes_etapas_pl(uuid[])')
                      AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.avaliar_condicoes_etapas_pl(uuid[])') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'kpl_c: pos-condicao falhou na ACL/secdef/search_path do wrapper' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

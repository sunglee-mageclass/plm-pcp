-- F6 — RPC peca_teste_status_lote: selo/filtro de Peca Teste na lista de PCP > Servicos.
-- So LEITURA, em LOTE: recebe _modelo_ids uuid[] e devolve jsonb = mapa { "<modelo_id>": "<status>" } com
-- status in {'nao_exige','pendente','aprovada'} por modelo da LOJA do usuario (modelo de outra loja = OMITIDO do mapa).
-- ESPELHA exatamente statusPecaTesteModelo / pecaTesteAprovadaModelo de src/lib/peca-teste.ts:
--   'nao_exige'  = o modelo NAO tem nenhuma linha modelo_servico_mo cujo tipo (categorias_terceirizado) tem exige_peca_teste=true;
--   'aprovada'   = tem >= 1 linha que exige E TODA linha que exige esta aprovada = (s.aprovado = true [M.O.]) AND
--                  public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id) = true;
--   'pendente'   = tem linha que exige mas NAO esta toda aprovada.
-- REUSA os helpers da 20261103193000 (urg R9b): o predicado unico _peca_teste_aprovada e o switch exige_peca_teste
-- (mesmo JOIN de "exige" do _peca_teste_trilhas_core). modelo_servico_mo tem RLS zero-policy (o cliente nao le direto) -> RPC DEFINER.
-- Padrao wrapper + _core (invariante 9): _core com EXECUTE revogado dos 3; wrapper DEFINER com gate (login + modulo Producao +
-- VER a pagina da lista de Servicos, producao_terceirizados) chamando o _core com get_user_tenant_id(). So catalogo (CREATE OR
-- REPLACE FUNCTION + GRANT/REVOKE); nenhum dado. RAISE que o PostgREST devolve como 5xx = SO ASCII; P0001 = 400.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

-- Dependencia FIXADA (nao redefinida aqui): o predicado unico da urg R9b tem de estar vivo com o texto esperado.
DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._peca_teste_aprovada(uuid,uuid,uuid)')));
  IF v IS DISTINCT FROM '417fa9850a5a52204f62476818dc408c' THEN
    RAISE EXCEPTION 'peca_teste_status_lote: dependencia public._peca_teste_aprovada(uuid,uuid,uuid) com texto inesperado (md5 %) - exige a 20261103193000 (urg R9b) aplicada; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._peca_teste_status_lote_core(_tenant uuid, _modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  -- [F6] status da Peca Teste por modelo, em LOTE, para o selo/filtro da lista de Servicos. Para cada modelo de _modelo_ids
  -- que seja da loja _tenant, calcula 'nao_exige'/'pendente'/'aprovada' (mesma regra do TS statusPecaTesteModelo). Modelo que
  -- nao e da loja (ou id inexistente) = OMITIDO do mapa. EXECUTE so postgres/service_role (REVOKE dos 3 abaixo).
  IF _tenant IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  v_ids := coalesce(_modelo_ids, '{}'::uuid[]);
  -- Limite de seguranca: recusa lote absurdamente grande (a lista da tela pagina). ASCII (P0001 = 400).
  IF array_length(v_ids, 1) > 2000 THEN
    RAISE EXCEPTION 'peca_teste_status_lote: lote grande demais (maximo 2000 modelos)' USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce((
    SELECT jsonb_object_agg(d.modelo_id::text, d.status)
      FROM (
        SELECT m.id AS modelo_id,
               CASE
                 WHEN NOT EXISTS (
                   SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
                                                           AND ct.tenant_id = _tenant AND ct.exige_peca_teste
                    WHERE s.modelo_id = m.id
                 ) THEN 'nao_exige'
                 WHEN NOT EXISTS (
                   -- alguma linha que EXIGE ainda nao esta toda aprovada (M.O. aprovada E peca teste aprovada)
                   SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
                                                           AND ct.tenant_id = _tenant AND ct.exige_peca_teste
                    WHERE s.modelo_id = m.id
                      AND NOT (s.aprovado IS TRUE
                               AND public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id))
                 ) THEN 'aprovada'
                 ELSE 'pendente'
               END AS status
          FROM public.modelos m
         WHERE m.id = ANY(v_ids) AND m.tenant_id = _tenant
      ) d
  ), '{}'::jsonb);
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_status_lote_core(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.peca_teste_status_lote(_modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [F6] selo/filtro da Peca Teste na lista de PCP > Servicos. Gate: login + modulo Producao (a lista de Servicos e PCP) +
  -- VER a pagina da lista (producao_terceirizados; sem VER = {} e a tela esconde o selo/filtro, como peca_teste_quadro devolve []).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'peca_teste_status_lote_sem_login: nao autenticado' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('producao');
  IF NOT public.user_can_view('producao_terceirizados') THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN public._peca_teste_status_lote_core(public.get_user_tenant_id(), _modelo_ids);
END $function$;
REVOKE EXECUTE ON FUNCTION public.peca_teste_status_lote(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peca_teste_status_lote(uuid[]) TO authenticated;

-- Pos-condicao: md5 do _core (informativo) + ACL conferida (REVOKE dos 3 no _core; authenticated no wrapper).
DO $pos$
DECLARE
  v_core text := md5(pg_get_functiondef(to_regprocedure('public._peca_teste_status_lote_core(uuid,uuid[])')));
BEGIN
  RAISE NOTICE 'peca_teste_status_lote: md5 _core = %', v_core;
  -- _core: nenhum dos 3 executa
  IF has_function_privilege('anon', 'public._peca_teste_status_lote_core(uuid,uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._peca_teste_status_lote_core(uuid,uuid[])', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._peca_teste_status_lote_core(uuid,uuid[])') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'peca_teste_status_lote: pos-condicao falhou - _core nao esta revogado dos 3' USING ERRCODE = 'P0001';
  END IF;
  -- wrapper: authenticated executa, anon nao
  IF NOT has_function_privilege('authenticated', 'public.peca_teste_status_lote(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.peca_teste_status_lote(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'peca_teste_status_lote: pos-condicao falhou - wrapper com ACL inesperada' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

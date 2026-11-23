-- Portao das 3 RPCs de preco do COMPRADO (salvar_precos_fixo_produto_acabado, salvar_markups_produto_acabado, salvar_precos_fixo_produto_importado):
-- editar o PRECO do comprado passa a exigir a PERMISSAO DE PRECO (criacao_planejamento:preco_venda OU criacao_planejamento:preco_atacado, Editor),
-- via _pode_editar_preco (migration 20261211100000): super_admin passa; admin/tenant_admin NAO furam (decisao do dono 23/nov: o preco so por
-- permissao concedida pelo super admin). DECISAO DE DESENHO: a pagina do produto (criacao_produto_acabado/importado) e FURAVEL por admin; se ela
-- liberasse o preco, o tenant_admin editaria preco por aqui. Logo a pagina do produto SOZINHA nao basta mais (o backfill da migration 1 ja concede
-- atacado a quem edita criacao_produto_acabado e ver+varejo a quem ve preco, entao quem editava continua editando se tinha linha de permissao).
-- Erro: 42501 'sem_permissao_pagina: <chave>|<chave>' (mesmo prefixo ASCII; a tela traduz por erro-mensagem.ts). Modulo da loja continua conferido antes.
-- MUDA SO a linha do portao (a PERFORM _seg_exige_pagina vira o IF acima, 1 linha de codigo + 1 de comentario). O resto do corpo e o vivo, byte a byte;
-- EXECUTE/grants/search_path/SECURITY DEFINER intocados. salvar_markups_produto_importado NAO existe.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.salvar_precos_fixo_produto_acabado
--     ANTES  815583deca5487c3c7b450d5e6db1bfc
--     DEPOIS f7cd5f6ed02bc7566d45e16b267a5788
--   public.salvar_markups_produto_acabado
--     ANTES  1f266f1908cf4918b4a0a9d868565f92
--     DEPOIS 644373572c1abb60f420793cfce70dd4
--   public.salvar_precos_fixo_produto_importado
--     ANTES  a277b0dcc67cacf0658ba771cc8d87a7
--     DEPOIS dac8b020f7dd2afb8a667a2245d95562
--   (b842360d.../caa171cd.../442fb620... = versao INTERMEDIA desta frente (trio _seg_exige_pagina), so na copia local/previa; a guarda a aceita)
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION). Sem DDL de tabela/DROP/TRIGGER/POLICY (nada em auth/storage). Idempotente (guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261211110000_preco_atacado_portao_rpcs_comprado_down.sql (devolve o portao ORIGINAL da S3d: _seg_exige_pagina(pagina do produto, preco_venda) - furavel por admin).
-- Ordem: esta migration vem DEPOIS da 20261211100000 (o helper _pode_editar_preco mora la); no inverso, rode este _down ANTES do da 20261211100000.
-- Aplicar fora de transacao de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';

DO $guarda$
DECLARE r record; v text;
BEGIN
  IF to_regprocedure('public._pode_editar_preco(text)') IS NULL THEN
    RAISE EXCEPTION 'preco_atacado_portao_rpcs: helper _pode_editar_preco ausente - aplique 20261211100000 antes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('salvar_precos_fixo_produto_acabado', '815583deca5487c3c7b450d5e6db1bfc,b842360d472acf66eb5b1dfe48427226,f7cd5f6ed02bc7566d45e16b267a5788'),
      ('salvar_markups_produto_acabado', '1f266f1908cf4918b4a0a9d868565f92,caa171cde24a682ebcabe2288426b95f,644373572c1abb60f420793cfce70dd4'),
      ('salvar_precos_fixo_produto_importado', 'a277b0dcc67cacf0658ba771cc8d87a7,442fb620618d50408253d6af4e880941,dac8b020f7dd2afb8a667a2245d95562')
    ) AS t(fn, ok) LOOP
    v := md5(pg_get_functiondef(('public.' || r.fn)::regproc));
    IF v <> ALL (string_to_array(r.ok, ',')) THEN
      RAISE EXCEPTION 'preco_atacado_portao_rpcs: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.fn, coalesce(v,'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- salvar_precos_fixo_produto_acabado
CREATE OR REPLACE FUNCTION public.salvar_precos_fixo_produto_acabado(_produto_id uuid, _tocar_atacado boolean, _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- [seg s3d] (C4) modulo Produto Acabado (como o gemeo importado) + pagina.
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [preco permissao] editar o preco do COMPRADO exige a permissao de PRECO (varejo OU atacado), NAO furavel por admin/tenant_admin (so super_admin fura): _pode_editar_preco. A pagina do produto (furavel por admin) sozinha NAO libera o preco.
  IF NOT (public._pode_editar_preco('criacao_planejamento:preco_venda') OR public._pode_editar_preco('criacao_planejamento:preco_atacado')) THEN RAISE EXCEPTION 'sem_permissao_pagina: criacao_planejamento:preco_venda|criacao_planejamento:preco_atacado' USING ERRCODE = '42501'; END IF;
  perform public._salvar_precos_fixo_produto_acabado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

-- salvar_markups_produto_acabado
CREATE OR REPLACE FUNCTION public.salvar_markups_produto_acabado(_produto_id uuid, _markup_atacado numeric, _markup_varejo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  -- [preco permissao] editar o preco do COMPRADO exige a permissao de PRECO (varejo OU atacado), NAO furavel por admin/tenant_admin (so super_admin fura): _pode_editar_preco. A pagina do produto (furavel por admin) sozinha NAO libera o preco.
  IF NOT (public._pode_editar_preco('criacao_planejamento:preco_venda') OR public._pode_editar_preco('criacao_planejamento:preco_atacado')) THEN RAISE EXCEPTION 'sem_permissao_pagina: criacao_planejamento:preco_venda|criacao_planejamento:preco_atacado' USING ERRCODE = '42501'; END IF;
  perform public._salvar_markups_produto_acabado_core(_produto_id, _markup_atacado, _markup_varejo);
end;
$function$;

-- salvar_precos_fixo_produto_importado
CREATE OR REPLACE FUNCTION public.salvar_precos_fixo_produto_importado(_produto_id uuid, _tocar_atacado boolean, _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não habilitado para esta loja' using errcode = '42501';
  end if;
  -- [preco permissao] editar o preco do COMPRADO exige a permissao de PRECO (varejo OU atacado), NAO furavel por admin/tenant_admin (so super_admin fura): _pode_editar_preco. A pagina do produto (furavel por admin) sozinha NAO libera o preco.
  IF NOT (public._pode_editar_preco('criacao_planejamento:preco_venda') OR public._pode_editar_preco('criacao_planejamento:preco_atacado')) THEN RAISE EXCEPTION 'sem_permissao_pagina: criacao_planejamento:preco_venda|criacao_planejamento:preco_atacado' USING ERRCODE = '42501'; END IF;
  perform public._salvar_precos_fixo_produto_importado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

DO $pos$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('salvar_precos_fixo_produto_acabado', 'f7cd5f6ed02bc7566d45e16b267a5788'),
      ('salvar_markups_produto_acabado', '644373572c1abb60f420793cfce70dd4'),
      ('salvar_precos_fixo_produto_importado', 'dac8b020f7dd2afb8a667a2245d95562')
    ) AS t(fn, esperado) LOOP
    v := md5(pg_get_functiondef(('public.' || r.fn)::regproc));
    IF v <> r.esperado THEN
      RAISE EXCEPTION 'preco_atacado_portao_rpcs: pos-condicao % md5 % <> %', r.fn, v, r.esperado USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_function_privilege('authenticated', ('public.' || r.fn)::regproc, 'EXECUTE')
       OR has_function_privilege('anon', ('public.' || r.fn)::regproc, 'EXECUTE') THEN
      RAISE EXCEPTION 'preco_atacado_portao_rpcs: pos-condicao % ACL alterada', r.fn USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

COMMIT;

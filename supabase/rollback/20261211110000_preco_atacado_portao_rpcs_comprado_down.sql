-- Inverso de 20261211110000_preco_atacado_portao_rpcs_comprado: devolve o portao das 3 RPCs de preco do comprado SEM a chave de atacado
-- (o trio vira o par: pagina do produto OU criacao_planejamento:preco_venda). Muda SO a linha do PERFORM; o resto do corpo e o vivo, byte a byte.
-- Guarda: aceita o texto desta frente (DEPOIS) ou ja o de antes (idempotente); qualquer outro = outra frente mexeu. Dado nao e tocado.
-- Pos-condicao: md5 de ANTES + ACL intacta.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';

DO $guarda$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('salvar_precos_fixo_produto_acabado', 'b842360d472acf66eb5b1dfe48427226,815583deca5487c3c7b450d5e6db1bfc'),
      ('salvar_markups_produto_acabado', 'caa171cde24a682ebcabe2288426b95f,1f266f1908cf4918b4a0a9d868565f92'),
      ('salvar_precos_fixo_produto_importado', '442fb620618d50408253d6af4e880941,a277b0dcc67cacf0658ba771cc8d87a7')
    ) AS t(fn, ok) LOOP
    v := md5(pg_get_functiondef(('public.' || r.fn)::regproc));
    IF v <> ALL (string_to_array(r.ok, ',')) THEN
      RAISE EXCEPTION 'preco_atacado_portao_rpcs_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.fn, coalesce(v,'ausente')
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
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_produto_acabado OU criacao_planejamento:preco_venda.
  PERFORM public._seg_exige_pagina('criacao_produto_acabado', 'criacao_planejamento:preco_venda');
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
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_produto_acabado OU criacao_planejamento:preco_venda.
  PERFORM public._seg_exige_pagina('criacao_produto_acabado', 'criacao_planejamento:preco_venda');
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
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_produto_importado OU criacao_planejamento:preco_venda.
  PERFORM public._seg_exige_pagina('criacao_produto_importado', 'criacao_planejamento:preco_venda');
  perform public._salvar_precos_fixo_produto_importado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

DO $pos$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('salvar_precos_fixo_produto_acabado', '815583deca5487c3c7b450d5e6db1bfc'),
      ('salvar_markups_produto_acabado', '1f266f1908cf4918b4a0a9d868565f92'),
      ('salvar_precos_fixo_produto_importado', 'a277b0dcc67cacf0658ba771cc8d87a7')
    ) AS t(fn, esperado) LOOP
    v := md5(pg_get_functiondef(('public.' || r.fn)::regproc));
    IF v <> r.esperado THEN
      RAISE EXCEPTION 'preco_atacado_portao_rpcs_down: pos-condicao % md5 % <> %', r.fn, v, r.esperado USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_function_privilege('authenticated', ('public.' || r.fn)::regproc, 'EXECUTE')
       OR has_function_privilege('anon', ('public.' || r.fn)::regproc, 'EXECUTE') THEN
      RAISE EXCEPTION 'preco_atacado_portao_rpcs_down: pos-condicao % ACL alterada', r.fn USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

COMMIT;

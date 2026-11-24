-- Exportar itens do Armario em CSV (botao "Baixar CSV" dentro do Armario, 24/nov/2026): 2 RPCs NOVAS, SO LEITURA (objetos novos;
-- nenhuma funcao existente e redefinida).
--
--   public._exportar_armario_core(_tenant uuid, _armario_id uuid) -> jsonb
--       (DEFINER, STABLE; EXECUTE revogado de PUBLIC/anon/authenticated). Recebe a loja por PARAMETRO e nao confere o chamador.
--   public.exportar_armario(_armario_id uuid) -> jsonb
--       (wrapper DEFINER, STABLE: login + loja ativa + user_can_view('criacao_armario'); confere que o armario e da loja do
--       usuario e chama o _core com get_user_tenant_id()).
--
-- RETORNO: {"nome_armario": "<nome>",
--           "linhas": [{"sku_pai": text|null, "grupo": text|null, "categoria": text|null, "subcategoria1": text|null,
--                       "subcategoria2": text|null}, ...]}
-- 1 linha por ITEM do armario (cor), na ordem da vitrine (armario_itens.ordem, desempate por id). O nome do armario sai UMA vez no
-- topo (o front o replica por linha no CSV). Taxonomia = a do MODELO do item (grupo da categoria principal, categoria principal,
-- subcategoria 1 e 2), sempre filtrada pela LOJA do modelo; nome vazio = null.
--
-- SKU PAI = o SKU ATE A COR (sem tamanho): o formato da loja (tenant_config.sku_config) MENOS a parte 'tamanho', pelo MESMO resolvedor
-- do SKU (_sku_resolver) e com a MESMA remocao do tamanho do nivel 2 de _exportar_produtos_core (20261122100000: o separador que antecede
-- o tamanho some junto e o que o segue passa a ligar a parte anterior). REF = modelos.ref (a oficial; o mesmo campo do export). A cor do
-- item e o snapshot do armario (cor_id/cor_apelido_id, sem FK): resolve-se SO aquela cor (nao a matriz do modelo). null = loja sem formato
-- (partes []), REF vazia ou falta de sigla (cor sem sigla, apelido sem sigla cai para a cor base) - esperado/aceito.
--
-- Erros: exportar_armario_sem_loja (P0001, ASCII; _tenant nulo/nil), armario_nao_encontrado (P0001, ASCII; armario inexistente ou de outra
-- loja), armario_nao_autenticado (42501, sem login), sem_permissao_pagina: criacao_armario (42501, ASCII; sem VER a pagina).
-- Seguranca: SECURITY DEFINER + SET search_path TO 'public'; o _core NAO e chamavel pelo cliente (REVOKE dos TRES, invariante 9);
-- so o wrapper o chama, com a loja do usuario. Leitura apenas. Nao exige o modulo (leitura segue a regra de VER a pagina do Armario).
-- Trava: so catalogo (CREATE FUNCTION + GRANT/REVOKE). Nada em auth/storage/realtime. Idempotente (CREATE OR REPLACE).
-- Volta: supabase/rollback/20261124100000_exportar_armario_down.sql (DROP das 2 funcoes). Banco ANTES do site.
-- Aplicar fora de transacao de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_n int;
BEGIN
  -- sobrecarga com outros argumentos deixaria a chamada por nome ambigua no PostgREST
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'exportar_armario' AND p.pronargs <> 1;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'exportar_armario_sobrecarga: % sobrecarga(s) de public.exportar_armario com outros argumentos', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_exportar_armario_core' AND p.pronargs <> 2;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'exportar_armario_sobrecarga: % sobrecarga(s) de public._exportar_armario_core com outros argumentos', v_n USING ERRCODE = 'P0001';
  END IF;
  -- dependencias lidas pelas funcoes
  IF to_regprocedure('public._sku_resolver(jsonb,text,jsonb,jsonb,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.user_can_view(text)') IS NULL
     OR to_regprocedure('public.get_user_tenant_id()') IS NULL
     OR to_regclass('public.armarios') IS NULL
     OR to_regclass('public.armario_itens') IS NULL THEN
    RAISE EXCEPTION 'exportar_armario_dep: falta um objeto do qual a exportacao do armario depende' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._exportar_armario_core(_tenant uuid, _armario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text;
  v_cfg jsonb;
  v_cfg2 jsonb;
  v_partes text[];
  v_pos integer;
  v_sep jsonb;
  v_sep_dep text;
  v_linhas jsonb;
BEGIN
  IF _tenant IS NULL OR _tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'exportar_armario_sem_loja' USING ERRCODE = 'P0001';
  END IF;

  SELECT a.nome::text INTO v_nome FROM public.armarios a WHERE a.id = _armario_id AND a.tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'armario_nao_encontrado' USING ERRCODE = 'P0001';
  END IF;

  -- SKU ate a cor: o formato da loja SEM a parte 'tamanho' (UMA leitura; o mesmo para todos os itens).
  -- Trecho reaproveitado do nivel 2 de _exportar_produtos_core (20261122100000).
  SELECT tc.sku_config INTO v_cfg FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  v_cfg2 := v_cfg;
  IF v_cfg IS NOT NULL AND jsonb_typeof(v_cfg -> 'partes') = 'array' THEN
    v_partes := ARRAY(SELECT e.value FROM jsonb_array_elements_text(v_cfg -> 'partes') WITH ORDINALITY AS e(value, n) ORDER BY e.n);
    v_pos := array_position(v_partes, 'tamanho');
    IF v_pos IS NOT NULL THEN
      v_sep := CASE WHEN jsonb_typeof(v_cfg -> 'separadores') = 'object' THEN v_cfg -> 'separadores' ELSE '{}'::jsonb END;
      -- o separador anda com a parte que vem DEPOIS dele: tirado o tamanho, o "tamanho|prox" liga a parte anterior a prox
      IF v_pos > 1 AND v_pos < cardinality(v_partes) THEN
        v_sep_dep := v_sep ->> ('tamanho|' || v_partes[v_pos + 1]);
        IF v_sep_dep IS NOT NULL THEN
          v_sep := v_sep || jsonb_build_object(v_partes[v_pos - 1] || '|' || v_partes[v_pos + 1], v_sep_dep);
        END IF;
      END IF;
      v_cfg2 := jsonb_set(jsonb_set(v_cfg, '{partes}', to_jsonb(array_remove(v_partes, 'tamanho'))), '{separadores}', v_sep);
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sku_pai', to_jsonb(x.sku_pai),
           'grupo', to_jsonb(x.grupo),
           'categoria', to_jsonb(x.categoria),
           'subcategoria1', to_jsonb(x.subcategoria1),
           'subcategoria2', to_jsonb(x.subcategoria2)) ORDER BY x.ordem, x.item_id), '[]'::jsonb)
    INTO v_linhas
    FROM (
      SELECT ai.ordem, ai.id AS item_id,
             nullif(btrim(coalesce(
               public._sku_resolver(
                 v_cfg2, m.ref::text,
                 CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'nome', c.nome, 'sigla', c.sigla_sku) END,
                 CASE WHEN ca.id IS NULL THEN NULL ELSE jsonb_build_object('id', ca.id, 'nome', ca.nome, 'sigla', ca.sigla_sku) END,
                 NULL, coalesce(m.tamanho_tipo, 'letra'), NULL) ->> 'sku', '')), '') AS sku_pai,
             nullif(btrim(coalesce(gp.nome::text, '')), '') AS grupo,
             nullif(btrim(coalesce(cp.nome::text, '')), '') AS categoria,
             nullif(btrim(coalesce(s1.nome::text, '')), '') AS subcategoria1,
             nullif(btrim(coalesce(s2.nome::text, '')), '') AS subcategoria2
        FROM public.armario_itens ai
        JOIN public.modelos m ON m.id = ai.modelo_id AND m.tenant_id = _tenant
        LEFT JOIN public.categorias_produto cp ON cp.id = m.categoria_principal_id AND cp.tenant_id = m.tenant_id
        LEFT JOIN public.grupos_produto gp ON gp.id = cp.grupo_id AND gp.tenant_id = m.tenant_id
        LEFT JOIN public.subcategorias1_produto s1 ON s1.id = m.subcategoria1_id AND s1.tenant_id = m.tenant_id
        LEFT JOIN public.subcategorias2_produto s2 ON s2.id = m.subcategoria2_id AND s2.tenant_id = m.tenant_id
        LEFT JOIN public.cores c ON c.id = ai.cor_id AND c.tenant_id = m.tenant_id
        LEFT JOIN public.cores_apelido ca ON ca.id = ai.cor_apelido_id AND ca.tenant_id = m.tenant_id
       WHERE ai.armario_id = _armario_id AND ai.tenant_id = _tenant
    ) x;

  RETURN jsonb_build_object('nome_armario', to_jsonb(v_nome), 'linhas', v_linhas);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._exportar_armario_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exportar_armario_core(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.exportar_armario(_armario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'exportar_armario_sem_loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_can_view('criacao_armario') THEN
    RAISE EXCEPTION 'sem_permissao_pagina: criacao_armario' USING ERRCODE = '42501';
  END IF;
  -- armario inexistente e armario de outra loja dao o MESMO erro (o _core confere a loja)
  RETURN public._exportar_armario_core(v_tenant, _armario_id);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.exportar_armario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exportar_armario(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.exportar_armario(uuid) IS
  'Exportar itens do Armario (CSV): nome do armario + 1 linha por item (cor) com SKU ate a cor, grupo, categoria, subcategoria 1 e 2.';

-- pos-condicoes
DO $pos$
BEGIN
  IF has_function_privilege('anon', 'public._exportar_armario_core(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._exportar_armario_core(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exportar_armario_pos: o _core esta executavel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.exportar_armario(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exportar_armario_pos: o wrapper esta executavel por anon' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

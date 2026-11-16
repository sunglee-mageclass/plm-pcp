-- F7 · Armario - Task C2, BANCO: RPC de ESCRITA public.armario_salvar(...) (wrapper) + public._armario_salvar_core(...) (nucleo).
-- Plano: docs/superpowers/plans/2026-11-16-f7-armario.md (Task C2). Molde de "salvar lista ordenada, estado completo": salvar_mix_padrao
-- (20260708270000_mix_padroes.sql); molde wrapper + _core + portao de pagina: S3 (20261101100000 _seg_exige_pagina; lancar_modelo).
-- Depende das tabelas da A1 (armarios, armario_itens) e do gatilho da A2 (que so morde o PAPEL do cliente: aqui o _core roda como DEFINER,
-- entao a guarda de "publicado" e CONFERIDA no proprio _core, com a linha travada FOR UPDATE).
--
-- ASSINATURA (wrapper, o que o front chama):
--   armario_salvar(_id uuid, _colecao_id uuid, _colecao text, _subcolecao text, _nome text, _colunas int, _status text, _itens jsonb) -> uuid
--   _id NULL = cria o armario (vai p/ o fim da lista da subcolecao); senao atualiza. Devolve o id do armario.
--   _itens = ARRAY jsonb da lista COMPLETA, EM ORDEM: [{ "modelo_id": uuid, "variante_tecido_id": uuid|null, "produto_variante_id": uuid|null }].
--   Qualquer outra chave (cor_id, cor_apelido_id, origem...) e IGNORADA: o snapshot de cor e a origem sao DERIVADOS no servidor.
--
-- REGRAS (no _core):
--   * Estado completo: delete-and-reinsert dos itens, ordem = indice do array (1-based). Nada de "ordem da variante" como identidade.
--   * Lista VAZIA ('[]', null ou 'null') e ACEITA (decisao do dono: o armario pode ficar vazio na montagem) - NAO e como a Camada C1.
--   * ANTI-CROSS-TENANT: o armario (e a colecao, o modelo e a variante) tem que ser da loja do usuario (get_user_tenant_id());
--     armario de outra loja/inexistente = P0001 armario_nao_encontrado.
--   * Guarda de PUBLICADO: SELECT ... FOR UPDATE; armario publicado = P0001 armario_publicado_travado (nem cabecalho, nem itens).
--     Despublicar e a RPC de status (C3), nao esta. Esta RPC grava status 'rascunho' ou 'pronto' (NULL = mantem; novo = rascunho);
--     'publicado' so pela RPC de status (P0001 armario_status_invalido).
--   * INVARIANTE: item SEM ponteiro (sem variante_tecido_id E sem produto_variante_id) = P0001 armario_item_sem_variante (produto sem cor
--     e "em desenvolvimento" e nao se grava; isso tambem fecha o unico caso de colisao NULL do index de de-dup).
--   * SNAPSHOT DERIVADO: cor_id/cor_apelido_id/origem vem do PONTEIRO no banco, nunca do cliente. Interno: variante_tecido_id tem que ser
--     do Tecido 1 do BOM do modelo (a mesma regra que a C1 oferece); revenda: produto_variante_id de produto_acabado_variantes do produto
--     espelho do modelo; importado: produto_importado_variantes. So variante COM cor. Ponteiro de outra origem/modelo/loja = recusa.
--     EXCECAO "cor removida": item que JA esta neste armario (mesmo modelo+ponteiro) cujo ponteiro ficou orfao/sem cor mantem o snapshot
--     gravado (a vitrine nunca trava por cadastro mexido; a leitura C1 mostra "cor removida"). Item NOVO com ponteiro invalido = recusa.
--   * DE-DUP: a mesma variante (modelo+ponteiro) 2x na lista = P0001 armario_item_duplicado (o index unico uq_armario_itens_variante e a rede).
--   * Mensagens de RAISE so ASCII nos P0001 (viram 400, a tela traduz pelo prefixo); 42501 ASCII tambem.
--
-- SEGURANCA: wrapper SECURITY DEFINER + SET search_path TO 'public': login (42501) + modulo 'criacao' (42501, como lancar_modelo) +
-- _seg_exige_pagina('criacao_armario') (42501) -> _core. _core SECURITY DEFINER com REVOKE EXECUTE de PUBLIC/anon/authenticated (so o
-- wrapper o alcanca). Wrapper: REVOKE PUBLIC/anon; GRANT authenticated + service_role. Toda tabela lida e filtrada por tenant explicito.
--
-- Trava: so catalogo (CREATE FUNCTION + GRANT/REVOKE). Nada em auth/storage/realtime; sem policy/gatilho/tabela. Idempotente.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- Volta: supabase/rollback/20261202130000_armario_salvar_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regclass('public.armarios') IS NULL OR to_regclass('public.armario_itens') IS NULL THEN
    RAISE EXCEPTION 'armario_c2_dep: tabelas armarios/armario_itens ausentes (aplicar a A1 antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_armario_trava_publicado()') IS NULL THEN
    RAISE EXCEPTION 'armario_c2_dep: gatilho de trava ausente (aplicar a A2 antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._seg_exige_pagina(text[])') IS NULL THEN
    RAISE EXCEPTION 'armario_c2_dep: _seg_exige_pagina ausente (S3a)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.tenant_module_enabled(text)') IS NULL OR to_regprocedure('public.get_user_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'armario_c2_dep: tenant_module_enabled/get_user_tenant_id ausentes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._armario_salvar_core(_id uuid, _colecao_id uuid, _colecao text, _subcolecao text, _nome text, _colunas integer, _status text, _itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid := public.get_user_tenant_id();
  v_id       uuid := _id;
  v_cur      record;
  v_nome     text := btrim(coalesce(_nome, ''));
  v_sub      text := btrim(coalesce(_subcolecao, ''));
  v_col_nome text;
  v_status   text;
  v_colunas  int;
  v_arr      jsonb;
  v_it       jsonb;
  v_i        int := 0;
  v_mod      uuid;
  v_vt       uuid;
  v_pv       uuid;
  v_origem   text;
  v_cor      uuid;
  v_ap       uuid;
  v_achou    boolean;
  v_rows     jsonb := '[]'::jsonb;
  v_chaves   text[] := ARRAY[]::text[];
  v_chave    text;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF v_nome = '' THEN
    RAISE EXCEPTION 'armario_nome_obrigatorio: informe o nome do armario' USING ERRCODE = 'P0001';
  END IF;
  IF _colunas IS NOT NULL AND _colunas NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'armario_colunas_invalidas: colunas deve estar entre 1 e 12' USING ERRCODE = 'P0001';
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('rascunho', 'pronto') THEN
    RAISE EXCEPTION 'armario_status_invalido: o salvar grava rascunho ou pronto (publicar e pela acao de status)' USING ERRCODE = 'P0001';
  END IF;

  -- lista: NULL / 'null' / [] = vazia (aceita); so ARRAY e valido
  IF _itens IS NULL OR jsonb_typeof(_itens) = 'null' THEN
    v_arr := '[]'::jsonb;
  ELSIF jsonb_typeof(_itens) <> 'array' THEN
    RAISE EXCEPTION 'armario_itens_invalido: itens deve ser uma lista' USING ERRCODE = 'P0001';
  ELSE
    v_arr := _itens;
  END IF;

  -- colecao (se informada) e da loja; o texto da colecao cai no nome dela quando o cliente nao manda
  IF _colecao_id IS NOT NULL THEN
    SELECT c.nome::text INTO v_col_nome FROM public.colecoes c WHERE c.id = _colecao_id AND c.tenant_id = v_tenant;
    IF v_col_nome IS NULL THEN
      RAISE EXCEPTION 'armario_colecao_invalida: colecao nao encontrada nesta loja' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- armario existente: da loja (ANTI-CROSS-TENANT), travado, e NAO publicado
  IF v_id IS NOT NULL THEN
    SELECT a.status, a.colunas INTO v_cur FROM public.armarios a WHERE a.id = v_id AND a.tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
    END IF;
    IF v_cur.status = 'publicado' THEN
      RAISE EXCEPTION 'armario_publicado_travado: armario publicado e so-leitura (despublique antes de editar)' USING ERRCODE = 'P0001';
    END IF;
    v_status  := coalesce(_status, v_cur.status);
    v_colunas := coalesce(_colunas, v_cur.colunas);
  ELSE
    v_status  := coalesce(_status, 'rascunho');
    v_colunas := coalesce(_colunas, 5);
  END IF;

  -- itens: valida + deriva o snapshot ANTES de gravar (qualquer recusa desfaz tudo - a funcao e atomica)
  FOR v_it IN SELECT value FROM jsonb_array_elements(v_arr) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_it) <> 'object' THEN
      RAISE EXCEPTION 'armario_item_invalido: item % nao e um objeto', v_i USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_mod := nullif(v_it->>'modelo_id', '')::uuid;
      v_vt  := nullif(v_it->>'variante_tecido_id', '')::uuid;
      v_pv  := nullif(v_it->>'produto_variante_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'armario_item_invalido: item % com id malformado', v_i USING ERRCODE = 'P0001';
    END;
    IF v_mod IS NULL THEN
      RAISE EXCEPTION 'armario_item_invalido: item % sem modelo_id', v_i USING ERRCODE = 'P0001';
    END IF;
    IF v_vt IS NULL AND v_pv IS NULL THEN
      RAISE EXCEPTION 'armario_item_sem_variante: item % sem variante (produto sem cor nao entra no armario)', v_i USING ERRCODE = 'P0001';
    END IF;

    SELECT m.origem::text INTO v_origem FROM public.modelos m WHERE m.id = v_mod AND m.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'armario_item_modelo_invalido: item % com modelo inexistente ou de outra loja', v_i USING ERRCODE = 'P0001';
    END IF;

    -- de-dup (modelo + ponteiro; o ponteiro determina a cor, entao e a mesma tupla de identidade)
    v_chave := v_mod::text || '|' || coalesce(v_vt::text, '') || '|' || coalesce(v_pv::text, '');
    IF v_chave = ANY (v_chaves) THEN
      RAISE EXCEPTION 'armario_item_duplicado: item % repete uma variante ja colocada neste armario', v_i USING ERRCODE = 'P0001';
    END IF;
    v_chaves := v_chaves || v_chave;

    -- deriva a cor do PONTEIRO (a origem do modelo decide qual ponteiro vale)
    v_cor := NULL; v_ap := NULL; v_achou := false;
    IF v_origem = 'revenda' THEN
      IF v_vt IS NOT NULL OR v_pv IS NULL THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - produto de revenda usa produto_variante_id', v_i USING ERRCODE = 'P0001';
      END IF;
      SELECT true, pav.cor_id, pav.cor_apelido_id INTO v_achou, v_cor, v_ap
        FROM public.produto_acabado_variantes pav
        JOIN public.produtos_acabados pa ON pa.id = pav.produto_acabado_id AND pa.tenant_id = v_tenant
       WHERE pav.id = v_pv AND pav.tenant_id = v_tenant AND pa.modelo_id = v_mod;
    ELSIF v_origem = 'importado' THEN
      IF v_vt IS NOT NULL OR v_pv IS NULL THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - produto importado usa produto_variante_id', v_i USING ERRCODE = 'P0001';
      END IF;
      SELECT true, piv.cor_id, piv.cor_apelido_id INTO v_achou, v_cor, v_ap
        FROM public.produto_importado_variantes piv
        JOIN public.produtos_importados pi ON pi.id = piv.produto_importado_id AND pi.tenant_id = v_tenant
       WHERE piv.id = v_pv AND piv.tenant_id = v_tenant AND pi.modelo_id = v_mod;
    ELSE
      IF v_pv IS NOT NULL OR v_vt IS NULL THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - produto interno usa variante_tecido_id', v_i USING ERRCODE = 'P0001';
      END IF;
      -- interno: a variante tem que ser do Tecido 1 do BOM do modelo (regra da C1)
      SELECT true, vt.cor_id, vt.cor_apelido_id INTO v_achou, v_cor, v_ap
        FROM public.variantes_tecido vt
       WHERE vt.id = v_vt AND vt.tenant_id = v_tenant
         AND EXISTS (SELECT 1
                       FROM public.modelo_tecido_variantes mtv
                       JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
                      WHERE mtv.variante_tecido_id = vt.id AND mt.modelo_id = v_mod AND mt.tipo = 'tecido' AND mt.numero = 1);
    END IF;

    IF NOT coalesce(v_achou, false) OR v_cor IS NULL THEN
      -- "cor removida": item que ja esta NESTE armario com o mesmo ponteiro preserva o snapshot gravado; item novo = recusa
      v_cor := NULL; v_ap := NULL; v_achou := false;
      IF v_id IS NOT NULL THEN
        SELECT true, ai.cor_id, ai.cor_apelido_id INTO v_achou, v_cor, v_ap
          FROM public.armario_itens ai
         WHERE ai.armario_id = v_id AND ai.tenant_id = v_tenant AND ai.modelo_id = v_mod
           AND ai.variante_tecido_id IS NOT DISTINCT FROM v_vt AND ai.produto_variante_id IS NOT DISTINCT FROM v_pv
         LIMIT 1;
      END IF;
      IF NOT coalesce(v_achou, false) THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - variante inexistente, sem cor ou que nao pertence ao produto', v_i USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_rows := v_rows || jsonb_build_object(
      'modelo_id', v_mod, 'origem', coalesce(v_origem, 'interno'), 'variante_tecido_id', v_vt, 'produto_variante_id', v_pv,
      'cor_id', v_cor, 'cor_apelido_id', v_ap, 'ordem', v_i);
  END LOOP;

  -- cabecalho
  IF v_id IS NULL THEN
    INSERT INTO public.armarios (tenant_id, colecao_id, colecao, subcolecao, nome, colunas, status, ordem)
    VALUES (v_tenant, _colecao_id, coalesce(nullif(btrim(coalesce(_colecao, '')), ''), v_col_nome), v_sub, v_nome, v_colunas, v_status,
            coalesce((SELECT max(a.ordem) FROM public.armarios a
                       WHERE a.tenant_id = v_tenant AND a.colecao_id IS NOT DISTINCT FROM _colecao_id AND a.subcolecao = v_sub), 0) + 1)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.armarios
       SET colecao_id = _colecao_id,
           colecao    = coalesce(nullif(btrim(coalesce(_colecao, '')), ''), v_col_nome),
           subcolecao = v_sub,
           nome       = v_nome,
           colunas    = v_colunas,
           status     = v_status
     WHERE id = v_id AND tenant_id = v_tenant;
    DELETE FROM public.armario_itens WHERE armario_id = v_id AND tenant_id = v_tenant;
  END IF;

  -- itens: estado completo, ordem = indice 1-based
  BEGIN
    INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem)
    SELECT v_tenant, v_id, r.modelo_id, r.origem, r.variante_tecido_id, r.produto_variante_id, r.cor_id, r.cor_apelido_id, r.ordem
      FROM jsonb_to_recordset(v_rows) AS r(modelo_id uuid, origem text, variante_tecido_id uuid, produto_variante_id uuid, cor_id uuid, cor_apelido_id uuid, ordem int)
     ORDER BY r.ordem;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'armario_item_duplicado: a mesma variante aparece mais de uma vez neste armario' USING ERRCODE = 'P0001';
  END;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_salvar(_id uuid, _colecao_id uuid, _colecao text, _subcolecao text, _nome text, _colunas integer, _status text, _itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [F7 armario C2] ESCRITA: login + modulo Criacao + permissao de PAGINA (EDITAR criacao_armario) -> _core (sem JWT nao se chega nele).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_armario');
  RETURN public._armario_salvar_core(_id, _colecao_id, _colecao, _subcolecao, _nome, _colunas, _status, _itens);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._armario_salvar_core(uuid, uuid, text, text, text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.armario_salvar(uuid, uuid, text, text, text, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armario_salvar(uuid, uuid, text, text, text, integer, text, jsonb) TO authenticated, service_role;

DO $pos$
DECLARE
  v_w oid := to_regprocedure('public.armario_salvar(uuid,uuid,text,text,text,integer,text,jsonb)');
  v_c oid := to_regprocedure('public._armario_salvar_core(uuid,uuid,text,text,text,integer,text,jsonb)');
  v_p record;
BEGIN
  IF v_w IS NULL OR v_c IS NULL THEN
    RAISE EXCEPTION 'armario_c2_pos: funcao ausente' USING ERRCODE = 'P0001';
  END IF;
  FOR v_p IN SELECT p.oid, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid IN (v_w, v_c) LOOP
    IF NOT v_p.prosecdef OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION 'armario_c2_pos: secdef/config errado em %', v_p.oid::regprocedure USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', v_c, 'EXECUTE') OR has_function_privilege('authenticated', v_c, 'EXECUTE')
     OR has_function_privilege('anon', v_w, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_w, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_w, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid IN (v_w, v_c) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'armario_c2_pos: grants errados' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;

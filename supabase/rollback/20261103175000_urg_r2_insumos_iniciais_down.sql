-- Inverso de supabase/migrations/20261103175000_urg_r2_insumos_iniciais.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a2.mjs (nunca editar a mao).
-- Devolve o texto de ANTES de public._plan_tecido_criar_card_core(uuid,uuid,jsonb) (md5 fceac02c52bd0b29a33856dc9e0f9b11) e de public.importar_modelo_linha(jsonb,jsonb)
-- (md5 db0c3dcbd90ded80d210b96747e01cb1) - byte a byte o vivo antes da ida, ACL/DEFINER/search_path preservados: criar card pelo Plan. Tecido
-- e pela importacao volta a NAO trazer os insumos padrao. NEUTRALIZA public.salvar_insumos_iniciais(uuid,jsonb) (recusa sempre: P0001
-- funcao_desativada: salvar_insumos_iniciais) e public._insumos_padrao_aplicar(uuid) (devolve 0) - os textos neutros nao citam a coluna da 174000 nem os
-- portoes (o _down_drop deles varre o prosrc). Linhas de insumo ja gravadas em cards FICAM (dado que NAO volta sozinho).
-- Volta LIFO: SITE antes (o Dialog novo chama a RPC); este arquivo ANTES do 20261103174000_down. DROP das novas: supabase/rollback/20261103175000_urg_r2_insumos_iniciais_down_drop.sql.
-- Trava: SO catalogo (corpos de antes NAO validados - check_function_bodies off: sao os textos que ja estavam vivos). Idempotente.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';
SET LOCAL check_function_bodies = off;

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)', 'fceac02c52bd0b29a33856dc9e0f9b11', '5814a5907981617a1b7c731941177143'),
      ('public.importar_modelo_linha(jsonb,jsonb)', 'db0c3dcbd90ded80d210b96747e01cb1', '4c53027d97a3b2a60108098fe8e1849a')
    ) AS x(fn, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.fn)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'urg_r2_175000_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.fn, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._insumos_padrao_aplicar(uuid)', '8e51a47dadb9b56970e2903f2bf2624f', 'fa0d3ce7bb39628db1a6d33c46f4d289'),
      ('public.salvar_insumos_iniciais(uuid,jsonb)', '44da042744bc302a7b129201de93aeac', '9a0c13cdab6ca7720c6669b964faa052')
    ) AS x(fn, depois, neutro) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.fn)));
    IF v IS NULL THEN
      RAISE EXCEPTION 'urg_r2_175000_down: % nao existe - nada a voltar', r.fn USING ERRCODE = 'P0001';
    END IF;
    IF v NOT IN (r.depois, r.neutro) THEN
      RAISE EXCEPTION 'urg_r2_175000_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.fn, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._plan_tecido_criar_card_core(_tenant uuid, _colecao_id uuid, _slot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_mid uuid; v_mes uuid; v_ano uuid; v_sub text;
  v_tt text;  -- [tamanho-em v1]
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  select mes_id, ano_id into v_mes, v_ano from colecoes where id = _colecao_id;
  v_sub := nullif(_slot->>'subcolecao_nome','');
  if v_sub is null and nullif(_slot->>'subcolecao_id','') is not null then
    select nome into v_sub from colecao_subcolecoes where id = (_slot->>'subcolecao_id')::uuid and tenant_id = _tenant;
  end if;

  -- [tamanho-em v1] "Tamanho em" do card = o da VAGA SALVA (P-119 A); sem vaga salva com valor, o do payload
  -- (validado); senão Letra.
  v_tt := nullif(_slot->>'tamanho_tipo', '');
  if v_tt is not null and v_tt not in ('letra', 'numero') then
    raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
  end if;
  if nullif(_slot->>'slot_id','') is not null then
    v_tt := coalesce((select sl.tamanho_tipo from plan_tecido_slots sl
                       where sl.id = (_slot->>'slot_id')::uuid and sl.tenant_id = _tenant), v_tt);
  end if;

  insert into modelos (tenant_id, nome, colecao_id, subcolecao, linha_id, categoria_principal_id,
                       mes_id, ano_id, preco_venda, custo_terceirizados_previsto, custo_simulado,
                       origem, status_planejamento, mix_id, tamanho_tipo)
  values (_tenant,
          coalesce(nullif(_slot->>'nome',''), nullif(_slot->>'ref',''), 'Novo modelo (Plan. Tecido)'),
          _colecao_id, v_sub,
          nullif(_slot->>'linha_id','')::uuid, nullif(_slot->>'categoria_id','')::uuid,
          v_mes, v_ano,
          nullif(_slot->>'preco_venda','')::numeric,
          coalesce(nullif(_slot->>'custo_terceirizados_previsto','')::numeric, 0),
          coalesce(_slot->'custo_simulado', '{}'::jsonb),
          'interno', 'em_planejamento',
          nullif(_slot->>'mix_id','')::uuid,   -- herda o mix reservado pela vaga (decisão 9)
          coalesce(v_tt, 'letra'))  -- [tamanho-em v1]
  returning id into v_mid;

  perform public._plan_tecido_gravar_bom_core(v_mid, _slot->'materiais');

  -- [G4] migra referências do slot (se houver) para o modelo recém-criado.
  update modelos set fotos_referencia = fotos_referencia || (
    select coalesce(array_agg(t.x),'{}') from jsonb_array_elements_text(coalesce(_slot->'referencia_paths','[]'::jsonb)) t(x)
  ) where id = v_mid and jsonb_array_length(coalesce(_slot->'referencia_paths','[]'::jsonb)) > 0;

  -- vincula o slot do plano ao modelo criado (persistente; some o botão "Criar card")
  if nullif(_slot->>'slot_id','') is not null then
    update plan_tecido_slots set modelo_id = v_mid, tamanho_tipo = null  -- [tamanho-em v1] com card, a vaga fica NULL
    where id = (_slot->>'slot_id')::uuid and tenant_id = _tenant;
  end if;

  return v_mid;
end $function$;

CREATE OR REPLACE FUNCTION public.importar_modelo_linha(_cabecalho jsonb, _grades jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_categoria uuid;
  v_sub1 uuid;
  v_sub2 uuid;
  v_colecao uuid;
  v_linha uuid;
  v_mes uuid;
  v_ano uuid;
  v_existe_id uuid;
  g jsonb;
  v_grades jsonb;
  v_grade_total numeric;
  v_has_value boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja' USING errcode = '42501';
  END IF;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR importar.
  PERFORM public._seg_exige_pagina('importar');

  v_nome := NULLIF(btrim(_cabecalho->>'nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do modelo.' USING errcode = 'P0001'; END IF;

  v_categoria := NULLIF(_cabecalho->>'categoria_principal_id','')::uuid;
  v_sub1      := NULLIF(_cabecalho->>'subcategoria1_id','')::uuid;
  v_sub2      := NULLIF(_cabecalho->>'subcategoria2_id','')::uuid;
  v_colecao   := NULLIF(_cabecalho->>'colecao_id','')::uuid;
  v_linha     := NULLIF(_cabecalho->>'linha_id','')::uuid;
  v_mes       := NULLIF(_cabecalho->>'mes_id','')::uuid;
  v_ano       := NULLIF(_cabecalho->>'ano_id','')::uuid;

  IF v_categoria IS NULL THEN
    RAISE EXCEPTION 'Informe a categoria do modelo.' USING errcode = 'P0001';
  END IF;

  -- IDOR do cabeçalho: cada FK tem de ser da MESMA loja.
  IF NOT EXISTS (SELECT 1 FROM categorias_produto c WHERE c.id = v_categoria AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Categoria não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias1_produto s WHERE s.id = v_sub1 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 1 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias2_produto s WHERE s.id = v_sub2 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 2 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_colecao IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colecoes cc WHERE cc.id = v_colecao AND cc.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_linha IS NOT NULL AND NOT EXISTS (SELECT 1 FROM linhas l WHERE l.id = v_linha AND l.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Linha não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_mes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meses m WHERE m.id = v_mes AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Mês não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_ano IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anos a WHERE a.id = v_ano AND a.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Ano não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- Só cria NOVOS: se já existe modelo interno de mesmo nome, PULA.
  SELECT id INTO v_existe_id FROM modelos
    WHERE tenant_id = v_tenant AND origem = 'interno'
      AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
    ORDER BY created_at LIMIT 1;
  IF v_existe_id IS NOT NULL THEN
    RETURN jsonb_build_object('modelo_id', v_existe_id, 'acao', 'inalterado');
  END IF;

  -- CRIAR o card (INSERT direto; origem interno; fica no Planejamento — ordem_criacao_enviada=false).
  INSERT INTO modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, mes_id, ano_id, linha_id,
    preco_venda, preco_atacado
  ) VALUES (
    v_tenant, v_nome, 'interno', v_categoria, v_sub1, v_sub2,
    v_colecao, NULLIF(_cabecalho->>'subcolecao',''), NULLIF(_cabecalho->>'semana',''),
    v_mes, v_ano, v_linha,
    NULLIF(_cabecalho->>'preco_venda','')::numeric,
    NULLIF(_cabecalho->>'preco_atacado','')::numeric
  ) RETURNING id INTO v_id;

  -- Grade (opcional): materializa em modelo_grades (variante 1). Mesma regra do BOM core: só grava
  -- quando grade_total>0 ou algum valor>0. O resto do BOM o usuário monta no Desenvolvimento.
  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(_grades) LOOP
      v_grades := COALESCE(g->'grades', '{}'::jsonb);
      v_grade_total := COALESCE((g->>'grade_total')::numeric, 0);
      v_has_value := false;
      IF v_grade_total > 0 THEN
        v_has_value := true;
      ELSIF jsonb_typeof(v_grades) = 'object' THEN
        SELECT EXISTS(SELECT 1 FROM jsonb_each_text(v_grades) WHERE NULLIF(value,'')::numeric > 0) INTO v_has_value;
      END IF;
      IF v_has_value THEN
        INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total)
        VALUES (v_id, COALESCE((g->>'variante_numero')::int, 1), v_grades, v_grade_total);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('modelo_id', v_id, 'acao', 'criado');
END $function$;

CREATE OR REPLACE FUNCTION public._insumos_padrao_aplicar(_modelo_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R2 T10] NEUTRALIZADA pelo _down da 20261103175000: nao grava nada (devolve 0). Os criadores de card ja voltaram ao texto de
-- antes (nao a chamam mais). Apagar de verdade = o _down_drop da mesma migration.
BEGIN
  RETURN 0;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._insumos_padrao_aplicar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_insumos_iniciais(_modelo_id uuid, _linhas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R2 T10] NEUTRALIZADA pelo _down da 20261103175000: recusa sempre (nenhum BOM inicial de insumo e gravado por aqui).
-- Apagar de verdade = o _down_drop da mesma migration.
BEGIN
  RAISE EXCEPTION 'funcao_desativada: salvar_insumos_iniciais' USING ERRCODE = 'P0001';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.salvar_insumos_iniciais(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_insumos_iniciais(uuid,jsonb) TO authenticated, service_role;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)', 'fceac02c52bd0b29a33856dc9e0f9b11'),
      ('public.importar_modelo_linha(jsonb,jsonb)', 'db0c3dcbd90ded80d210b96747e01cb1'),
      ('public._insumos_padrao_aplicar(uuid)', 'fa0d3ce7bb39628db1a6d33c46f4d289'),
      ('public.salvar_insumos_iniciais(uuid,jsonb)', '9a0c13cdab6ca7720c6669b964faa052')
    ) AS x(fn, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r2_175000_down: pos-condicao falhou no texto de % (esperado %)', r.fn, r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._insumos_padrao_aplicar(uuid)') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public._insumos_padrao_aplicar(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._insumos_padrao_aplicar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'urg_r2_175000_down: pos-condicao falhou na ACL/secdef/search_path de public._insumos_padrao_aplicar(uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_insumos_iniciais(uuid,jsonb)') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.salvar_insumos_iniciais(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.salvar_insumos_iniciais(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.salvar_insumos_iniciais(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'urg_r2_175000_down: pos-condicao falhou na ACL/secdef/search_path de public.salvar_insumos_iniciais(uuid,jsonb)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)') AND p.prosecdef
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
    RAISE EXCEPTION 'urg_r2_175000_down: pos-condicao falhou na ACL/secdef/search_path de public._plan_tecido_criar_card_core(uuid,uuid,jsonb)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.importar_modelo_linha(jsonb,jsonb)') AND p.prosecdef
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
    RAISE EXCEPTION 'urg_r2_175000_down: pos-condicao falhou na ACL/secdef/search_path de public.importar_modelo_linha(jsonb,jsonb)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

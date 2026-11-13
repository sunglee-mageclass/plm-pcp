-- Reforma da Peca Teste por TIPO - migration 3 de 5 (SALVAR): o Salvar da Peca Teste passa a gravar por TIPO de servico.
-- Spec A1-A4. ESTE ARQUIVO CRESCE (Task 3 = base; Task 4 = historico editavel nos marcadores @@T4-...@@).
-- O que faz (so catalogo + 1 gatilho novo na propria tabela de tentativas; nenhum dado):
--   1) helper NOVO _peca_teste_valida_fornecedor(tenant, tipo, empresa): fornecedor de SERVICO da loja E vinculado ao tipo
--      (empresa_categorias_servico). Valida so quando o fornecedor da tentativa MUDA (um fornecedor ja congelado e desvinculado depois
--      continua valendo).
--   2) _salvar_peca_teste_core REESCRITA: trilha = (modelo, tipo) [payload: categoria_id; mo_linha_id e _rev_base.fornecedor sao
--      IGNORADOS]; fornecedor = campo da TENTATIVA (empresa_id por tentativa; chave ausente = mantem); nascer/aprovar/reprovar por tipo;
--      a M.O. nao e mais tocada pela peca teste (acabou o CAS do fornecedor da linha); mo_linha_id da tentativa nova = a M.O. vigente
--      do tipo (referencia historica opcional).
--   3) _peca_teste_mini_aplicar: so a resolucao da tentativa NOVA muda (de (linha, tipo, numero) para (modelo, tipo, numero)).
--   4) trava de fornecedor MIGRA para a tentativa: gatilho novo trg_peca_teste_trava_fornecedor_tentativa (BEFORE UPDATE OF empresa_id,
--      aprovada -> aprovada com fornecedor diferente = P0001). A fn_peca_teste_trava_fornecedor() antiga vira NEUTRA (RETURN NEW); o
--      gatilho dela em modelo_servico_mo fica INERTE ate o DROP (supabase/consultas/peca_teste_tipo_limpeza_gatilho_mo.sql, horario calmo).
-- Janela banco->site: o site ANTIGO manda payload por mo_linha_id/fornecedor da linha; o core novo ignora essas chaves e uma decisao sem
-- empresa_id na tentativa recusa com peca_teste_sem_fornecedor (P0001, sem gravar). Deploy unico: minutos.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_peca_teste_core(uuid,jsonb,jsonb)   ANTES 3e3b9db2d04dd176a4712898293f8545
--   public._peca_teste_mini_aplicar(uuid,uuid,jsonb)   ANTES e6c43399f0a5c20c17c6255477947d2d
--   public.fn_peca_teste_trava_fornecedor()            ANTES 982769d4384a04d9a35d53db654667da
--   public._peca_teste_valida_fornecedor(uuid,uuid,uuid) / fn_peca_teste_trava_fornecedor_tentativa()   ANTES ausente
-- ====================================================================================
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261129120000_peca_teste_tipo_salvar.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site. Volta: supabase/rollback/20261129120000_peca_teste_tipo_salvar_down.sql (+ _down_drop)
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $pre$
DECLARE
  v_core text := md5(pg_get_functiondef('public._salvar_peca_teste_core(uuid,jsonb,jsonb)'::regprocedure));
  v_mini text := md5(pg_get_functiondef('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)'::regprocedure));
  v_trv text := md5(pg_get_functiondef('public.fn_peca_teste_trava_fornecedor()'::regprocedure));
BEGIN
  IF v_core <> '3e3b9db2d04dd176a4712898293f8545'
     AND position('[reforma pt]' in pg_get_functiondef('public._salvar_peca_teste_core(uuid,jsonb,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_salvar: _salvar_peca_teste_core divergente (md5 %)', v_core USING ERRCODE = 'P0001';
  END IF;
  IF v_mini <> 'e6c43399f0a5c20c17c6255477947d2d'
     AND position('[reforma pt]' in pg_get_functiondef('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_salvar: _peca_teste_mini_aplicar divergente (md5 %)', v_mini USING ERRCODE = 'P0001';
  END IF;
  IF v_trv <> '982769d4384a04d9a35d53db654667da'
     AND position('[reforma pt]' in pg_get_functiondef('public.fn_peca_teste_trava_fornecedor()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_salvar: fn_peca_teste_trava_fornecedor divergente (md5 %)', v_trv USING ERRCODE = 'P0001';
  END IF;
END
$pre$;

-- 1) helper: fornecedor da tentativa = de SERVICO, da loja, vinculado ao tipo
CREATE OR REPLACE FUNCTION public._peca_teste_valida_fornecedor(_tenant uuid, _categoria_id uuid, _empresa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [reforma pt] _empresa_id nulo = nada a validar. Mensagens so ASCII (a tela traduz pelo prefixo).
  IF _empresa_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = _empresa_id AND e.tenant_id = _tenant AND e.tipo = 'servico') THEN
    RAISE EXCEPTION 'peca_teste_fornecedor_invalido: fornecedor de servico invalido' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empresa_categorias_servico k
                  WHERE k.empresa_id = _empresa_id AND k.categoria_terceirizado_id = _categoria_id) THEN
    RAISE EXCEPTION 'peca_teste_fornecedor_categoria: fornecedor nao vinculado ao tipo de servico (vincule em Cadastro)' USING ERRCODE = 'P0001';
  END IF;
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_valida_fornecedor(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 2) _salvar_peca_teste_core por TIPO
CREATE OR REPLACE FUNCTION public._salvar_peca_teste_core(_modelo_id uuid, _trilhas jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_uid uuid := auth.uid();
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_dia constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_revs jsonb;
  v_ids uuid[];
  tr jsonb;
  tt jsonb;
  v_cat uuid;
  v_t public.modelo_peca_teste_tentativas%ROWTYPE;
  v_id uuid;
  v_num integer;
  v_saida date;
  v_entrada date;
  v_aprov text;
  v_forn uuid;
  v_max integer;
  v_ult text;
  v_linha uuid;
  -- @@T4-DECLARE@@
BEGIN
  -- [reforma pt] Salvar da secao Peca Teste POR TIPO (payload = so as trilhas tocadas, delta). Trilha = (modelo, categoria_id); a tentativa
  -- carrega o PROPRIO fornecedor (empresa_id; chave ausente = mantem). Ordem: (1) card da loja + formato; (2) chave do card PRIMEIRO
  -- (a mesma 1a chave do Enviar a Explosao / aprovar M.O. / Salvar da M.O.); (3) tipo tem de exigir peca teste (senao P0409
  -- peca_teste_desatualizada); (4) tentativas do tipo FOR UPDATE (ordem de id); (5) rev de TODA tentativa citada conferido ANTES de
  -- qualquer escrita (a renumeracao sobe o rev das seguintes); (6) aplica por trilha; (7) passo da MINI (_peca_teste_mini_aplicar).
  -- A M.O. nao e tocada. Tentativa NOVA nunca nasce decidida. Toda escrita grava updated_at = now().
  IF NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'peca_teste_modelo: nao encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_trilhas) IS DISTINCT FROM 'array' OR jsonb_typeof(_rev_base) IS DISTINCT FROM 'object'
     OR jsonb_typeof(coalesce(_rev_base->'tentativas', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'peca_teste_formato: _trilhas tem de ser lista e _rev_base objeto' USING ERRCODE = 'P0001';
  END IF;
  v_revs := coalesce(_rev_base->'tentativas', '{}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x
              WHERE jsonb_typeof(x) <> 'object'
                 OR coalesce(x->>'categoria_id', '') !~ v_uuid
                 OR jsonb_typeof(coalesce(x->'tentativas', '[]'::jsonb)) <> 'array'
                 OR jsonb_typeof(coalesce(x->'excluir', '[]'::jsonb)) <> 'array')
     OR (SELECT count(*) <> count(DISTINCT lower(x->>'categoria_id')) FROM jsonb_array_elements(_trilhas) x) THEN
    RAISE EXCEPTION 'peca_teste_formato: trilha invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'excluir', '[]'::jsonb)) e
              WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ v_uuid)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x,
                       jsonb_array_elements(coalesce(x->'excluir', '[]'::jsonb)) e,
                       jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
                 WHERE lower(e #>> '{}') = lower(t->>'id')) THEN
    RAISE EXCEPTION 'peca_teste_formato: lista de exclusao invalida' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE jsonb_typeof(t) <> 'object'
                 OR (t->>'id' IS NOT NULL AND t->>'id' !~ v_uuid)
                 OR (t->>'id' IS NULL AND coalesce(t->>'numero', '') !~ '^[1-9][0-9]{0,5}$')
                 OR coalesce(t->>'data_saida', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'data_entrada', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'aprovacao', 'aprovado') !~ '^(aprovado|reprovado)$'
                 OR (t ? 'empresa_id' AND jsonb_typeof(t->'empresa_id') NOT IN ('string', 'null'))
                 OR (t ? 'empresa_id' AND t->>'empresa_id' IS NOT NULL AND t->>'empresa_id' !~ v_uuid))
     OR (SELECT count(t->>'id') <> count(DISTINCT lower(t->>'id'))
           FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t) THEN
    RAISE EXCEPTION 'peca_teste_formato: tentativa invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  -- tentativa NOVA nunca nasce decidida: decide-se so a tentativa ja GRAVADA (com as 2 datas e o fornecedor)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE t->>'id' IS NULL AND t->>'aprovacao' IS NOT NULL) THEN
    RAISE EXCEPTION 'peca_teste_sem_datas: tentativa nova nao nasce aprovada ou reprovada - salve as datas antes de decidir' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    PERFORM count((t->>'data_saida')::date) + count((t->>'data_entrada')::date)
       FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'peca_teste_formato: data invalida' USING ERRCODE = 'P0001';
  END;
  -- @@T4-EXCLUIR-RECUSA-INICIO@@
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x WHERE jsonb_array_length(coalesce(x->'excluir', '[]'::jsonb)) > 0) THEN
    RAISE EXCEPTION 'peca_teste_formato: exclusao de tentativa ainda nao suportada' USING ERRCODE = 'P0001';
  END IF;
  -- @@T4-EXCLUIR-RECUSA-FIM@@

  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    IF NOT EXISTS (SELECT 1 FROM public.categorias_terceirizado ct
                    WHERE ct.id = (tr->>'categoria_id')::uuid AND ct.tenant_id = v_tenant AND ct.exige_peca_teste) THEN
      RAISE EXCEPTION 'peca_teste_desatualizada: tipo de servico nao exige peca teste' USING ERRCODE = 'P0409';
    END IF;
  END LOOP;
  PERFORM 1 FROM public.modelo_peca_teste_tentativas t
    WHERE t.modelo_id = _modelo_id AND t.tenant_id = v_tenant
      AND t.categoria_terceirizado_id IN (SELECT (x->>'categoria_id')::uuid FROM jsonb_array_elements(_trilhas) x)
    ORDER BY t.id FOR UPDATE;

  -- (5) rev de TODA tentativa citada (editada ou a excluir), ANTES de qualquer escrita
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    v_cat := (tr->>'categoria_id')::uuid;
    SELECT coalesce(array_agg(q.i), '{}'::uuid[]) INTO v_ids FROM (
      SELECT (x->>'id')::uuid AS i FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NOT NULL
      UNION
      SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(coalesce(tr->'excluir', '[]'::jsonb)) e) q;
    FOREACH v_id IN ARRAY v_ids LOOP
      SELECT * INTO v_t FROM public.modelo_peca_teste_tentativas t
       WHERE t.id = v_id AND t.modelo_id = _modelo_id AND t.categoria_terceirizado_id = v_cat AND t.tenant_id = v_tenant;
      IF NOT FOUND OR coalesce(v_revs->>v_id::text, '') !~ '^[0-9]{1,9}$' OR v_t.rev <> (v_revs->>v_id::text)::integer THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
    END LOOP;
  END LOOP;

  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    v_cat := (tr->>'categoria_id')::uuid;
    -- @@T4-EXCLUIR-PASSO@@

    -- tentativas EXISTENTES (id)
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NOT NULL LOOP
      v_id := (tt->>'id')::uuid;
      SELECT * INTO v_t FROM public.modelo_peca_teste_tentativas t WHERE t.id = v_id;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_aprov := tt->>'aprovacao';
      v_forn := CASE WHEN tt ? 'empresa_id' THEN nullif(tt->>'empresa_id', '')::uuid ELSE v_t.empresa_id END;
      -- @@T4-REPROVADA-INICIO@@
      -- reprovada = so leitura (o literal reprovado fica fora: o anti-drift da Mod T4 o reserva ao status do card; o CHECK da tabela
      -- so aceita aprovado/reprovado, entao "aprovacao diferente de aprovado e nao nula" = reprovada)
      IF v_t.aprovacao IS NOT NULL AND v_t.aprovacao <> 'aprovado' THEN
        IF v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada
           OR v_aprov IS DISTINCT FROM v_t.aprovacao OR v_forn IS DISTINCT FROM v_t.empresa_id THEN
          RAISE EXCEPTION 'peca_teste_historico: tentativa reprovada e so leitura' USING ERRCODE = 'P0001';
        END IF;
        CONTINUE;
      END IF;
      -- @@T4-REPROVADA-FIM@@
      -- aprovada mantida = datas E fornecedor travados
      IF v_t.aprovacao = 'aprovado' AND v_aprov = 'aprovado' THEN
        IF v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada THEN
          RAISE EXCEPTION 'peca_teste_aprovada_travada: datas da peca aprovada nao mudam (desfaca a aprovacao antes)' USING ERRCODE = 'P0001';
        END IF;
        IF v_forn IS DISTINCT FROM v_t.empresa_id THEN
          RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
        END IF;
        CONTINUE;
      END IF;
      -- @@T4-DECISAO-INICIO@@
      -- @@T4-DECISAO-FIM@@
      IF v_saida IS NULL AND v_entrada IS NULL AND v_aprov IS NULL AND v_forn IS NULL THEN
        -- so apaga (volta a VIRTUAL) sem mini com dado (no PAYLOAD ou ja gravada) e sem historico de baixa
        IF NOT (tt ? 'mini' AND jsonb_typeof(tt->'mini') = 'object')
           AND NOT public._peca_teste_mini_tem_historico(v_id)
           AND NOT EXISTS (SELECT 1 FROM public.modelo_peca_teste_mini m WHERE m.tentativa_id = v_id) THEN
          DELETE FROM public.modelo_peca_teste_tentativas WHERE id = v_id;
          CONTINUE;
        END IF;
      END IF;
      IF v_aprov IS NOT NULL THEN
        IF v_saida IS NULL OR v_entrada IS NULL THEN
          RAISE EXCEPTION 'peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada' USING ERRCODE = 'P0001';
        END IF;
        IF v_forn IS NULL THEN
          RAISE EXCEPTION 'peca_teste_sem_fornecedor: defina o fornecedor da tentativa antes de aprovar ou reprovar a peca teste' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      IF v_forn IS NOT NULL AND v_forn IS DISTINCT FROM v_t.empresa_id THEN
        PERFORM public._peca_teste_valida_fornecedor(v_tenant, v_cat, v_forn);
      END IF;
      IF v_saida IS NOT DISTINCT FROM v_t.data_saida AND v_entrada IS NOT DISTINCT FROM v_t.data_entrada
         AND v_aprov IS NOT DISTINCT FROM v_t.aprovacao AND v_forn IS NOT DISTINCT FROM v_t.empresa_id THEN
        CONTINUE;  -- nada mudou: nao sobe o rev
      END IF;
      UPDATE public.modelo_peca_teste_tentativas t
         SET data_saida = v_saida,
             data_entrada = v_entrada,
             aprovacao = v_aprov,
             empresa_id = v_forn,
             decidido_em = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN now() ELSE t.decidido_em END,
             decidido_por = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN v_uid ELSE t.decidido_por END,
             updated_at = now()
       WHERE t.id = v_id;
    END LOOP;

    -- tentativas NOVAS (id nulo), por numero: so a proxima depois de uma reprovada (ou a 1a); so nulos (sem fornecedor, datas nem mini) = ignora
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NULL
               ORDER BY (x->>'numero')::integer LOOP
      v_num := (tt->>'numero')::integer;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_forn := CASE WHEN tt ? 'empresa_id' THEN nullif(tt->>'empresa_id', '')::uuid END;
      IF v_saida IS NULL AND v_entrada IS NULL AND v_forn IS NULL
         AND NOT (tt ? 'mini' AND jsonb_typeof(tt->'mini') = 'object') THEN
        CONTINUE;
      END IF;
      SELECT t.numero, t.aprovacao INTO v_max, v_ult FROM public.modelo_peca_teste_tentativas t
       WHERE t.modelo_id = _modelo_id AND t.categoria_terceirizado_id = v_cat ORDER BY t.numero DESC LIMIT 1;
      IF NOT FOUND THEN
        v_max := 0;      -- nenhuma tentativa: a nova e a 1a
      ELSIF v_ult IS NULL OR v_ult = 'aprovado' THEN
        v_max := NULL;   -- a atual nao foi reprovada: nao ha "proxima" (outra pessoa ja lancou a tentativa)
      END IF;
      IF v_max IS NULL OR v_num <> v_max + 1 THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
      PERFORM public._peca_teste_valida_fornecedor(v_tenant, v_cat, v_forn);
      SELECT s.id INTO v_linha FROM public.modelo_servico_mo s
       WHERE s.modelo_id = _modelo_id AND s.tenant_id = v_tenant AND s.categoria_terceirizado_id = v_cat
       ORDER BY s.created_at, s.id LIMIT 1;
      BEGIN
        INSERT INTO public.modelo_peca_teste_tentativas
          (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, created_by, updated_at)
        VALUES (v_tenant, _modelo_id, v_linha, v_cat, v_num, v_forn, v_saida, v_entrada, v_uid, now());
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END;
    END LOOP;
  END LOOP;

  -- passo da MINI explosao (cabecalho/ajustes + baixa/estorno): DEPOIS do laco das tentativas
  PERFORM public._peca_teste_mini_aplicar(_modelo_id, v_tenant, _trilhas);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._salvar_peca_teste_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- 3) _peca_teste_mini_aplicar: so a resolucao da tentativa NOVA muda (gerado de pg_get_functiondef + 4 trocas exatas)
CREATE OR REPLACE FUNCTION public._peca_teste_mini_aplicar(_modelo_id uuid, _tenant uuid, _trilhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- [urg r11e] passo da mini explosao, chamado pelo _salvar_peca_teste_core DEPOIS do laco das tentativas e ANTES do CAS do
  -- fornecedor. Para cada tentativa do payload com a chave 'mini' (objeto): resolve a tentativa (existente por id; nova por
  -- (mo_linha_id, categoria, numero) - ja inserida pelo core), trava o cabecalho FOR UPDATE, valida e aplica a chave mini (cabecalho +
  -- ajustes em estado COMPLETO) e roda a maquina de estados (baixar/estornar). Ordem de travas do _salvar_peca_teste_core (card -> M.O.
  -- -> tentativas -> AQUI: cabecalhos da mini FOR UPDATE, ordem de tentativa_id -> corte_tenant, SO na baixa/estorno, dentro dos
  -- helpers r11d). Mini numa loja sem Entrada e Saida = recusa. Chave de ajuste fora do BOM ATUAL = P0409.
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_tem_es boolean := public._tenant_modulo_ligado(_tenant, 'entrada_saida');
  tr jsonb; tt jsonb; mn jsonb; aj jsonb; cf jsonb;
  v_cat uuid; v_tent uuid; v_num integer;
  v_aprov_paga text;   -- aprovacao GRAVADA da tentativa (NULL = pendente)
  v_t public.modelo_peca_teste_tentativas%ROWTYPE;
  v_mini public.modelo_peca_teste_mini%ROWTYPE;
  v_tem_mini boolean;
  v_tam text; v_var uuid; v_mesma boolean;
  v_saida date;
  v_hist boolean;
  v_imutavel boolean;
  v_mudou boolean;
  v_chaves_bom text[];
  r record;
BEGIN
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    v_cat := (tr->>'categoria_id')::uuid;
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x ? 'mini' LOOP
      mn := tt->'mini';
      IF jsonb_typeof(mn) = 'null' THEN
        CONTINUE;  -- 'mini': null (tentativa sem cabecalho) = nada a aplicar
      END IF;
      IF jsonb_typeof(mn) <> 'object' THEN
        RAISE EXCEPTION 'peca_teste_mini_formato: mini tem de ser objeto' USING ERRCODE = 'P0001';
      END IF;

      -- [reforma pt] resolve a tentativa (existente por id; nova pela chave (modelo, tipo, numero) - ja inserida pelo core)
      IF tt->>'id' IS NOT NULL THEN
        v_tent := (tt->>'id')::uuid;
      ELSE
        v_num := (tt->>'numero')::integer;
        SELECT t.id INTO v_tent FROM public.modelo_peca_teste_tentativas t
         WHERE t.modelo_id = _modelo_id AND t.categoria_terceirizado_id = v_cat AND t.numero = v_num AND t.tenant_id = _tenant;
        IF v_tent IS NULL THEN
          CONTINUE;  -- tentativa nova "so nulos" (sem datas/decisao) nao foi inserida: nao ha onde pendurar a mini
        END IF;
      END IF;

      -- trava o cabecalho da mini (ou a tentativa, se ainda nao tem mini) na ordem de tentativa_id
      PERFORM 1 FROM public.modelo_peca_teste_tentativas t
        WHERE t.id = v_tent AND t.modelo_id = _modelo_id AND t.tenant_id = _tenant FOR UPDATE;
      SELECT * INTO v_t FROM public.modelo_peca_teste_tentativas t WHERE t.id = v_tent;
      IF v_t.id IS NULL THEN CONTINUE; END IF;
      SELECT * INTO v_mini FROM public.modelo_peca_teste_mini m WHERE m.tentativa_id = v_tent FOR UPDATE;
      v_tem_mini := v_mini.tentativa_id IS NOT NULL;

      -- formato da chave mini
      IF (mn ? 'tamanho' AND jsonb_typeof(mn->'tamanho') NOT IN ('string','null'))
         OR (mn ? 'variante_tecido_id' AND jsonb_typeof(mn->'variante_tecido_id') NOT IN ('string','null'))
         OR (mn->>'variante_tecido_id' IS NOT NULL AND mn->>'variante_tecido_id' !~ v_uuid)
         OR (mn ? 'mesma_oc' AND jsonb_typeof(mn->'mesma_oc') <> 'boolean')
         OR (mn ? 'ajustes' AND jsonb_typeof(mn->'ajustes') <> 'array')
         OR (mn ? 'confere' AND jsonb_typeof(mn->'confere') NOT IN ('object','null')) THEN
        RAISE EXCEPTION 'peca_teste_mini_formato: chaves da mini invalidas' USING ERRCODE = 'P0001';
      END IF;
      v_tam := mn->>'tamanho';
      v_var := nullif(mn->>'variante_tecido_id', '')::uuid;
      v_mesma := coalesce((mn->>'mesma_oc')::boolean, true);
      aj := coalesce(mn->'ajustes', '[]'::jsonb);
      cf := CASE WHEN jsonb_typeof(mn->'confere') = 'object' THEN mn->'confere' END;

      -- formato de cada ajuste (faixas dos CHECKs; <= 4 casas em consumo/a_enviar)
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(aj) a
                  WHERE jsonb_typeof(a) <> 'object'
                     OR coalesce(a->>'chave', '') = ''
                     OR (a ? 'consumo' AND a->'consumo' <> 'null'::jsonb
                           AND (jsonb_typeof(a->'consumo') <> 'number' OR (a->>'consumo')::numeric NOT BETWEEN 0 AND 9999
                                OR scale((a->>'consumo')::numeric) > 4))
                     OR (a ? 'loss_percent' AND a->'loss_percent' <> 'null'::jsonb
                           AND (jsonb_typeof(a->'loss_percent') <> 'number' OR (a->>'loss_percent')::numeric NOT BETWEEN 0 AND 100))
                     OR (a ? 'a_enviar' AND a->'a_enviar' <> 'null'::jsonb
                           AND (jsonb_typeof(a->'a_enviar') <> 'number' OR (a->>'a_enviar')::numeric NOT BETWEEN 0 AND 99999
                                OR scale((a->>'a_enviar')::numeric) > 4))
                     OR (a ? 'variante_aviamento_id' AND a->'variante_aviamento_id' <> 'null'::jsonb
                           AND coalesce(a->>'variante_aviamento_id', '') !~ v_uuid)
                     OR (a ? 'oc_tecido_item_id' AND a->'oc_tecido_item_id' <> 'null'::jsonb
                           AND coalesce(a->>'oc_tecido_item_id', '') !~ v_uuid))
         OR (SELECT count(*) <> count(DISTINCT a->>'chave') FROM jsonb_array_elements(aj) a) THEN
        RAISE EXCEPTION 'peca_teste_mini_formato: ajuste invalido ou chave repetida' USING ERRCODE = 'P0001';
      END IF;

      -- estado DE ANTES deste Salvar: SO a aprovada (em Salvar ANTERIOR) congela a mini. A reprovada cai no caminho NORMAL
      -- (estorno_e_baixa), como a pendente: a decisao "reprovado" fica (o core trava datas/fornecedor/aprovacao), mas o material/baixa
      -- da mini abre. A decisao ja foi aplicada pelo core (este passo roda DEPOIS do laco das tentativas), entao "aprovada ANTES" =
      -- aprovacao gravada 'aprovado' E decidido_em de uma txn ANTERIOR (decidido_em <> now(), constante na txn). Aprovar no MESMO
      -- Salvar tem decidido_em = now() -> NAO e imutavel -> a baixa sai (peca gasta).
      v_aprov_paga := CASE WHEN v_t.decidido_em IS DISTINCT FROM now() THEN v_t.aprovacao END;
      v_hist := v_aprov_paga IS NOT NULL AND v_aprov_paga <> 'aprovado';
      v_imutavel := v_aprov_paga = 'aprovado';  -- SO aprovada em Salvar ANTERIOR congela a mini (reprovada e editavel)

      -- a mini "muda" quando o cabecalho ou os ajustes diferem do gravado
      v_mudou := (NOT v_tem_mini)
        OR v_mini.tamanho IS DISTINCT FROM v_tam
        OR v_mini.variante_tecido_id IS DISTINCT FROM v_var
        OR v_mini.mesma_oc IS DISTINCT FROM v_mesma
        OR EXISTS (
             -- ajustes do payload x ajustes gravados (linhas com algum ajuste nao nulo)
             SELECT 1 FROM (
               SELECT a->>'chave' AS chave,
                      nullif(a->'consumo','null'::jsonb)::text::numeric AS consumo,
                      nullif(a->'loss_percent','null'::jsonb)::text::numeric AS loss_percent,
                      nullif(a->'a_enviar','null'::jsonb)::text::numeric AS a_enviar,
                      nullif(a->>'variante_aviamento_id','')::uuid AS variante_aviamento_id,
                      nullif(a->>'oc_tecido_item_id','')::uuid AS oc_tecido_item_id
                 FROM jsonb_array_elements(aj) a
                WHERE a->'consumo' IS DISTINCT FROM 'null'::jsonb OR a->'loss_percent' IS DISTINCT FROM 'null'::jsonb
                   OR a->'a_enviar' IS DISTINCT FROM 'null'::jsonb OR nullif(a->>'variante_aviamento_id','') IS NOT NULL
                   OR nullif(a->>'oc_tecido_item_id','') IS NOT NULL
             ) p
             FULL JOIN (
               SELECT l.chave, l.consumo, l.loss_percent, l.a_enviar, l.variante_aviamento_id, l.oc_tecido_item_id
                 FROM public.modelo_peca_teste_mini_linhas l
                WHERE l.tentativa_id = v_tent
                  AND (l.consumo IS NOT NULL OR l.loss_percent IS NOT NULL OR l.a_enviar IS NOT NULL
                       OR l.variante_aviamento_id IS NOT NULL OR l.oc_tecido_item_id IS NOT NULL)
             ) g ON g.chave = p.chave
            WHERE p.chave IS NULL OR g.chave IS NULL
               OR p.consumo IS DISTINCT FROM g.consumo OR p.loss_percent IS DISTINCT FROM g.loss_percent
               OR p.a_enviar IS DISTINCT FROM g.a_enviar OR p.variante_aviamento_id IS DISTINCT FROM g.variante_aviamento_id
               OR p.oc_tecido_item_id IS DISTINCT FROM g.oc_tecido_item_id
           );

      IF v_imutavel THEN
        -- tentativa APROVADA (em Salvar ANTERIOR): a mini e IMUTAVEL. Qualquer diferenca do gravado = recusa. A reprovada NAO cai
        -- aqui (v_imutavel = false): a mini dela e editavel e segue o caminho normal (estorno_e_baixa). Aprovar no MESMO Salvar
        -- tambem nao cai aqui (v_aprov_paga NULL -> a baixa sai normal; a decisao vem do core DEPOIS deste passo).
        IF v_mudou THEN
          IF v_hist THEN
            RAISE EXCEPTION 'peca_teste_historico: tentativa reprovada e so leitura' USING ERRCODE = 'P0001';
          ELSE
            RAISE EXCEPTION 'peca_teste_mini_travada: peca teste aprovada trava a mini' USING ERRCODE = 'P0001';
          END IF;
        END IF;
        CONTINUE;
      END IF;

      -- loja sem Entrada e Saida: o payload nao pode trazer mini com dado
      IF NOT v_tem_es THEN
        RAISE EXCEPTION 'peca_teste_mini_sem_estoque: loja sem Entrada e Saida nao faz a baixa da peca teste' USING ERRCODE = 'P0001';
      END IF;

      -- tamanho fora da grade da loja
      IF v_tam IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.tenant_config tc, jsonb_array_elements_text(coalesce(tc.tamanhos_grade, '[]'::jsonb)) g
         WHERE tc.tenant_id = _tenant AND g = v_tam) THEN
        RAISE EXCEPTION 'peca_teste_mini_tamanho_invalido: tamanho fora da grade da loja' USING ERRCODE = 'P0001';
      END IF;
      -- V fora das variantes do Tecido 1 do BOM ATUAL
      IF v_var IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.modelo_tecidos mt
          JOIN public.modelo_tecido_variantes ctv ON ctv.modelo_tecido_id = mt.id
         WHERE mt.modelo_id = _modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1 AND ctv.variante_tecido_id = v_var) THEN
        RAISE EXCEPTION 'peca_teste_mini_variante_invalida: variante nao e do Tecido 1 do BOM' USING ERRCODE = 'P0001';
      END IF;
      -- variante de aviamento de outro aviamento/loja; item de OC de outra loja/variante (por ajuste)
      FOR r IN SELECT a->>'chave' AS chave,
                      nullif(a->>'variante_aviamento_id','')::uuid AS va,
                      nullif(a->>'oc_tecido_item_id','')::uuid AS oci FROM jsonb_array_elements(aj) a LOOP
        IF r.va IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.variantes_aviamento va
            JOIN public.aviamentos av ON av.id = va.aviamento_id AND av.tenant_id = _tenant
            JOIN public.modelo_aviamentos ma ON ma.aviamento_id = av.id AND ma.modelo_id = _modelo_id
           WHERE va.id = r.va AND ('a:' || av.id::text || ':') = regexp_replace(r.chave, '([0-9]+)$', '')) THEN
          RAISE EXCEPTION 'peca_teste_mini_variante_invalida: variante de aviamento invalida' USING ERRCODE = 'P0001';
        END IF;
        IF r.oci IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.ocs_tecido_itens oi JOIN public.ocs_tecido o ON o.id = oi.oc_tecido_id
           WHERE oi.id = r.oci AND o.tenant_id = _tenant) THEN
          RAISE EXCEPTION 'peca_teste_mini_fonte_invalida: item de OC invalido' USING ERRCODE = 'P0001';
        END IF;
      END LOOP;

      -- chave de ajuste fora do BOM ATUAL (para o tamanho/variante dados) -> P0409 (nada grava; a tela recarrega)
      SELECT coalesce(array_agg(chave), '{}'::text[]) INTO v_chaves_bom
        FROM public._peca_teste_mini_linhas(_modelo_id, v_tam, v_var, '{}'::jsonb);
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(aj) a WHERE NOT (a->>'chave' = ANY(v_chaves_bom))) THEN
        RAISE EXCEPTION 'peca_teste_mini_desatualizada: a mini mudou; recarregue' USING ERRCODE = 'P0409';
      END IF;

      -- aplica o cabecalho (upsert). As linhas de ajuste sao gravadas abaixo, no momento certo da maquina de estados (sem baixa
      -- ativa, ou antes da (re)baixa), para nao destruir a FOTO quando a baixa permanece.
      INSERT INTO public.modelo_peca_teste_mini (tentativa_id, tenant_id, modelo_id, tamanho, variante_tecido_id, mesma_oc, updated_at)
      VALUES (v_tent, _tenant, _modelo_id, v_tam, v_var, v_mesma, now())
      ON CONFLICT (tentativa_id) DO UPDATE
        SET tamanho = excluded.tamanho, variante_tecido_id = excluded.variante_tecido_id, mesma_oc = excluded.mesma_oc,
            updated_at = now();

      -- maquina de estados. baixa ATIVA = v_mini.baixa_em NOT NULL (estado GRAVADO antes deste Salvar). Data de saida da tentativa
      -- (ja gravada pelo core). Pronto para baixar = data de saida + tamanho (+ cor, se houver Tecido 1 no BOM).
      v_saida := v_t.data_saida;
      DECLARE
        v_pronto boolean;
        v_grava boolean := false;  -- reescrever as linhas SO de ajuste (estado completo), sem destruir a FOTO quando a baixa fica
      BEGIN
        v_pronto := v_saida IS NOT NULL AND v_tam IS NOT NULL
          AND (v_var IS NOT NULL
               OR NOT EXISTS (SELECT 1 FROM public.modelo_tecidos mt WHERE mt.modelo_id = _modelo_id AND mt.tipo='tecido' AND mt.numero=1));
        IF v_mini.baixa_em IS NULL THEN
          v_grava := true;  -- sem baixa ativa: os ajustes sao reescritos agora (a baixa, se vier, regrava a FOTO por cima)
          IF v_pronto THEN
            -- grava os ajustes ANTES da baixa (ela le as linhas), depois baixa (tambem se a gravacao reprova: peca gasta)
            NULL;
          END IF;
        ELSE
          -- ja tinha baixa ativa
          IF v_saida IS NULL THEN
            PERFORM public._peca_teste_mini_estornar(v_tent);  -- data apagada -> estorna (limpa a foto; os ajustes ficam)
            v_grava := true;                                   -- reescreve os ajustes (estado completo)
            v_pronto := false;
          ELSIF v_mudou THEN
            PERFORM public._peca_teste_mini_estornar(v_tent);  -- Q2=A: estorna
            v_grava := true;                                   -- grava os ajustes NOVOS antes de rebaixar
          ELSE
            v_pronto := false;  -- data segue + mini igual = nada (a baixa e a foto ficam)
          END IF;
        END IF;

        IF v_grava THEN
          DELETE FROM public.modelo_peca_teste_mini_linhas l WHERE l.tentativa_id = v_tent;
          INSERT INTO public.modelo_peca_teste_mini_linhas (tenant_id, tentativa_id, chave, familia, consumo, loss_percent, a_enviar,
                 variante_aviamento_id, oc_tecido_item_id)
          SELECT _tenant, v_tent, a->>'chave', coalesce(a->>'familia', 'tecido'),
                 nullif(a->'consumo','null'::jsonb)::text::numeric, nullif(a->'loss_percent','null'::jsonb)::text::numeric,
                 nullif(a->'a_enviar','null'::jsonb)::text::numeric, nullif(a->>'variante_aviamento_id','')::uuid,
                 nullif(a->>'oc_tecido_item_id','')::uuid
            FROM jsonb_array_elements(aj) a
           WHERE a->'consumo' IS DISTINCT FROM 'null'::jsonb OR a->'loss_percent' IS DISTINCT FROM 'null'::jsonb
              OR a->'a_enviar' IS DISTINCT FROM 'null'::jsonb OR nullif(a->>'variante_aviamento_id','') IS NOT NULL
              OR nullif(a->>'oc_tecido_item_id','') IS NOT NULL;
        END IF;

        IF v_pronto THEN
          PERFORM public._peca_teste_mini_baixar(v_tent, cf);  -- BAIXAR / rebaixar
        END IF;
      END;

      -- toca a tentativa (rev+1) quando a mini/baixa mudou
      IF v_mudou OR v_mini.baixa_em IS DISTINCT FROM (SELECT baixa_em FROM public.modelo_peca_teste_mini WHERE tentativa_id = v_tent) THEN
        UPDATE public.modelo_peca_teste_tentativas SET updated_at = now() WHERE id = v_tent;
      END IF;
    END LOOP;
  END LOOP;
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_aplicar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 4) a trava de fornecedor MIGRA para a tentativa
CREATE OR REPLACE FUNCTION public.fn_peca_teste_trava_fornecedor_tentativa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [reforma pt] so e chamada pelo gatilho com WHEN (aprovada -> aprovada com fornecedor DIFERENTE): peca aprovada trava o fornecedor da
  -- TENTATIVA. Reabrir (aprovada -> outra decisao) e trocar o fornecedor e permitido (o gatilho nao dispara).
  RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_peca_teste_trava_fornecedor_tentativa() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.modelo_peca_teste_tentativas'::regclass
                    AND tgname = 'trg_peca_teste_trava_fornecedor_tentativa' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_peca_teste_trava_fornecedor_tentativa
      BEFORE UPDATE OF empresa_id ON public.modelo_peca_teste_tentativas
      FOR EACH ROW
      WHEN (OLD.aprovacao = 'aprovado' AND NEW.aprovacao = 'aprovado' AND OLD.empresa_id IS DISTINCT FROM NEW.empresa_id)
      EXECUTE FUNCTION public.fn_peca_teste_trava_fornecedor_tentativa();
  END IF;
END
$trg$;

-- a funcao ANTIGA (gatilho em modelo_servico_mo) vira NEUTRA: o fornecedor da M.O. e independente da peca teste
CREATE OR REPLACE FUNCTION public.fn_peca_teste_trava_fornecedor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [reforma pt] NEUTRA: o fornecedor da peca teste e da tentativa (gatilho trg_peca_teste_trava_fornecedor_tentativa). O gatilho
  -- trg_peca_teste_trava_fornecedor em modelo_servico_mo fica INERTE ate o DROP em horario calmo (DROP TRIGGER prende a tabela).
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_peca_teste_trava_fornecedor() FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.modelo_peca_teste_tentativas'::regclass
                    AND t.tgname = 'trg_peca_teste_trava_fornecedor_tentativa' AND t.tgenabled = 'O' AND (t.tgtype & 1) = 1) THEN
    RAISE EXCEPTION 'reforma_pt_salvar: pos-condicao falhou - gatilho da trava na tentativa ausente/desabilitado/nao e por linha' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('_salvar_peca_teste_core', '_peca_teste_mini_aplicar', '_peca_teste_valida_fornecedor',
                                  'fn_peca_teste_trava_fornecedor', 'fn_peca_teste_trava_fornecedor_tentativa')
                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'reforma_pt_salvar: pos-condicao falhou - ACL com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');

-- Achados LEVES, release L3 - parte 5 (fix round 1, A1): reprovado = status_desenvolvimento OU status_planejamento (P-213 A)
-- tambem nos caminhos POR CARD do P-190 A ("reprovado nunca revela a REF nem passa no gate da Explosao"). Ruling do controlador
-- (01/out): mesmo predicado da Integracao/OTB/Plan. Tecido. Funcoes da R14 (+ o gatilho da REF), redefinidas aqui guardadas
-- pelos md5 "depois" da R14:
--   _kanban_status_gate       card REPROVADO (Dev OU Planejamento) -> NULL (sem posicao) em QUALQUER estado da chave.
--                             [fix round 2, ruling do controlador] o reprovado do DEV tambem com a chave DESLIGADA (a R14
--                             so o tratava com a chave ligada): com a chave desligada, 'reprovado' depois da etapa no board
--                             deixava revelar a REF e enviar a Explosao. Efeito: fn_modelo_ref_auto, _enviar_modelo_para_cad_core
--                             ('reprovado_explosao:') e _integracao_gates (gate 'ref') recusam sem mudar de texto.
--   _kanban_aplicar           revela_ref (fixado) exclui o reprovado no planejamento.
--   kanban_previa_recalculo   a previa "REFs reveladas" exclui o reprovado no planejamento (≡ _kanban_aplicar/gatilho).
--   fn_modelo_ref_auto        nao revela com NEW.status_planejamento = 'reprovado' (o mesmo UPDATE que o marca).
-- Os outros 3 caminhos ja tratam na propria migration da L3: _enviar_modelo_para_cad_core (100000: 'reprovado_explosao:'),
-- _integracao_gates (110000: motivo do gate 'ref') e _ref_revelar_candidatos (130000: lote do Salvar).
-- Espelho TS (anti-drift GATE_CASOS G8/G9): statusParaGate(ligado, derivacao, status, statusPlanejamento) em
-- src/lib/kanban-auto.ts. Limite consciente: card que SAI de reprovado no Planejamento num UPDATE so revela a REF na proxima
-- mudanca relevante (o _kanban_status_gate le a linha gravada, ainda reprovada, dentro do BEFORE UPDATE).
-- Nada gravado muda na ida (REF ja revelada nunca volta - inv. #11). Copia (Ave Rara, chave desligada): 2 cards com
-- status_planejamento='reprovado', Ordem enviada e REF escondida (TOP ALICIA, VESTIDO ASSIMETRICO BIANCA) passam a ficar
-- escondidos (antes revelariam ao chegar na etapa) e nao vao a Explosao.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._kanban_status_gate(uuid,uuid,text)        ANTES 635c7bbad3a3db2779f68fd1c5c8a954 ("depois" da R14 20261024100000) -> DEPOIS 44a0ebe16970322eefa949dce8c2f38f
--   public._kanban_aplicar(uuid,uuid[],text,uuid)     ANTES 9c50c6700d5bedc22b53ee95466d43f4 ("depois" da R14)               -> DEPOIS d20c6f9404028c20f8336799743f234a
--   public.kanban_previa_recalculo(jsonb)             ANTES 1ed117822a5dc7b5a3f54559ba68b89b ("depois" da R14)               -> DEPOIS fdbc2039870d90a0277c20f859084259
--   public.fn_modelo_ref_auto()                       ANTES 36f303e458a6ed95fd97c6ed2802dc6b (PROVISORIO, copia; = Passo 0 contas certas 30/set) -> DEPOIS 6d68b20b0e5086a9a9dc0c87a8b42c69
--   Sem mudanca (so guarda): _kanban_derivar_lote 0755d9ad, _ref_exibir_gate 824e463a, _kanban_ligado 82ddd5ea (CONFIRMADOS
--   passo0-medios), _kanban_norm 74606b6e (PROVISORIO).
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION. ACL: identica (pos-condicao); internas sem EXECUTE para PUBLIC/anon/authenticated
-- (inv. #9); kanban_previa_recalculo COM authenticated e SEM PUBLIC/anon; fn_modelo_ref_auto (funcao de gatilho) com a ACL de
-- producao.
-- Volta: supabase/rollback/20261027140000_reprovado_planejamento_gate_down.sql (devolve os 4 textos "depois" da R14). LIFO: e
-- o 1o inverso da L3 (antes do 130000_down) e vem ANTES do inverso da R14 (20261024100000_down guarda os mesmos 3 md5 da R14).
-- Site: statusParaGate (4o parametro) + useFichaKanban/gateEnvioExplosao; o PlanejamentoDetail (junção L2) passa
-- statusPlanejamento ao gate da Explosao.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l3p_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l3p_md5_aceitos VALUES
  ('public._kanban_status_gate(uuid,uuid,text)', '635c7bbad3a3db2779f68fd1c5c8a954', 'antes'),
  ('public._kanban_status_gate(uuid,uuid,text)', '44a0ebe16970322eefa949dce8c2f38f', 'depois'),
  ('public._kanban_aplicar(uuid,uuid[],text,uuid)', '9c50c6700d5bedc22b53ee95466d43f4', 'antes'),
  ('public._kanban_aplicar(uuid,uuid[],text,uuid)', 'd20c6f9404028c20f8336799743f234a', 'depois'),
  ('public.kanban_previa_recalculo(jsonb)', '1ed117822a5dc7b5a3f54559ba68b89b', 'antes'),
  ('public.kanban_previa_recalculo(jsonb)', 'fdbc2039870d90a0277c20f859084259', 'depois'),
  ('public.fn_modelo_ref_auto()', '36f303e458a6ed95fd97c6ed2802dc6b', 'antes'),  -- PROVISORIO (copia 54422)
  ('public.fn_modelo_ref_auto()', '6d68b20b0e5086a9a9dc0c87a8b42c69', 'depois'),
  ('public._kanban_derivar_lote(uuid,uuid[],jsonb)', '0755d9ad499379295ba24c7a669daa76', 'dep'),
  ('public._ref_exibir_gate(uuid,text)', '824e463a9223f3fe4646d771276c856f', 'dep'),
  ('public._kanban_ligado(uuid)', '82ddd5ea48af16f92843ebe6226fca2b', 'dep'),
  ('public._kanban_norm(text)', '74606b6e06de34fa23fd0642d1ebafbb', 'dep');

CREATE TEMP TABLE _l3p_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _l3p_md5_aceitos a;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3p_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'leves_l3: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l3p_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'leves_l3: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._kanban_status_gate(_tenant uuid, _modelo_id uuid, _status_atual text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_derivavel boolean;
  v_alvo      text;
BEGIN
  -- leves L3 fix round 1/2 (A1, P-213 A + P-190 A; ruling do controlador 01/out): reprovado = Dev OU Planejamento e NAO tem
  -- posicao para os gates em QUALQUER estado da chave (nunca revela a REF nem libera a Explosao). O Dev pelo status dado
  -- (_status_atual); o Planejamento pela linha gravada (o fn_modelo_ref_auto confere tambem o NEW.status_planejamento, mesmo
  -- UPDATE). Espelho TS: statusParaGate (4o parametro).
  IF public._kanban_norm(_status_atual) = 'reprovado' THEN
    RETURN NULL;
  END IF;
  IF _modelo_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.modelos mp
                                         WHERE mp.id = _modelo_id AND public._kanban_norm(mp.status_planejamento) = 'reprovado') THEN
    RETURN NULL;
  END IF;
  IF _tenant IS NULL OR _modelo_id IS NULL OR NOT public._kanban_ligado(_tenant) THEN
    RETURN _status_atual;
  END IF;
  -- (medios R14 kanban #7: o 'reprovado' do Dev com a chave ligada - agora tratado no topo, para qualquer chave.)
  -- Outras colunas manuais seguem pela posicao DERIVADA (decisao 10).
  IF coalesce(current_setting('app.kanban_sistema', true), '') IN ('auto', 'config', 'restauracao') THEN
    RETURN _status_atual;
  END IF;
  SELECT d.derivavel, d.alvo INTO v_derivavel, v_alvo
    FROM public._kanban_derivar_lote(_tenant, ARRAY[_modelo_id]) d
   LIMIT 1;
  IF NOT FOUND OR NOT coalesce(v_derivavel, false) OR v_alvo IS NULL THEN
    RETURN _status_atual;
  END IF;
  RETURN v_alvo;
END;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_cfg      jsonb;
  v_n        integer := 0;
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('auto', 'config') THEN
    RAISE EXCEPTION '_kanban_aplicar: origem inválida (%).', _origem USING ERRCODE = 'P0001';
  END IF;
  IF _tenant IS NULL OR NOT public._kanban_ligado(_tenant) THEN
    RETURN 0;
  END IF;

  v_cfg := public._kanban_cfg(_tenant);

  PERFORM set_config('app.kanban_sistema', _origem, true);
  PERFORM set_config('app.kanban_lote', coalesce(_lote::text, ''), true);

  WITH d AS (
    SELECT x.* FROM public._kanban_derivar_lote(_tenant, _ids, v_cfg) x WHERE x.derivavel
  ), calc AS (
    SELECT d.modelo_id AS mid,
           d.resultado,
           (d.resultado IS DISTINCT FROM d.status_atual) AS muda,
           -- medios R14 kanban #7 (P-190 A): fixado em 'reprovado' nunca revela a REF (≡ _kanban_status_gate)
           (d.fixado AND public._kanban_norm(d.resultado) <> 'reprovado'
            -- leves L3 fix round 1 (A1, P-213 A): reprovado no PLANEJAMENTO tambem nunca revela
            AND NOT EXISTS (SELECT 1 FROM public.modelos mp
                             WHERE mp.id = d.modelo_id AND public._kanban_norm(mp.status_planejamento) = 'reprovado')
            AND public._ref_exibir_gate(_tenant, d.alvo)) AS revela_ref
      FROM d
  ), upd AS (
    UPDATE public.modelos m
       SET status_desenvolvimento = CASE WHEN c.muda THEN c.resultado ELSE m.status_desenvolvimento END,
           ref = CASE WHEN c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''
                      THEN m.ref_auto ELSE m.ref END
      FROM calc c
     WHERE m.id = c.mid
       AND m.tenant_id = _tenant
       AND (c.muda OR (c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''))
    RETURNING c.muda
  )
  SELECT count(*) FILTER (WHERE upd.muda) INTO v_n FROM upd;

  PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
  PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kanban_previa_recalculo(_cfg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_atual     jsonb;
  v_prop      jsonb;
  v_board_at  text[];
  v_board_nv  text[];
  v_rb        text[];  -- board PROPOSTO sem dedup (≡ _kanban_status_rows: régua do _ref_exibir_gate)
  v_ref_cfg   text;
  v_ref_pos   integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode ver a prévia do Kanban automático.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  v_atual := coalesce(public._kanban_cfg(v_tenant), '{}'::jsonb);
  v_prop  := v_atual || coalesce((
    SELECT jsonb_object_agg(e.k, e.v)
      FROM jsonb_each(CASE WHEN jsonb_typeof(_cfg) = 'object' THEN _cfg ELSE '{}'::jsonb END) AS e(k, v)
     WHERE e.k IN ('kanban_automatico', 'status_kanban', 'kanban_requisitos', 'kanban_requisitos_excecoes',
                   'revenda_kanban_colunas', 'revenda_kanban_requisitos')), '{}'::jsonb);
  v_board_at := public._kanban_fluxo(v_atual, false);
  v_board_nv := public._kanban_fluxo(v_prop, false);
  -- Régua da REF (≡ _ref_exibir_gate, mas sobre o board PROPOSTO; ref_exibir_status vem da config gravada)
  v_rb := ARRAY(SELECT r.key FROM public._kanban_status_rows_raw(v_prop -> 'status_kanban') r ORDER BY r.ord);
  v_ref_cfg := v_atual ->> 'ref_exibir_status';
  IF v_ref_cfg IS NULL OR btrim(v_ref_cfg) = '' THEN v_ref_cfg := 'aprovado'; END IF;
  v_ref_pos := array_position(v_rb, v_ref_cfg);
  IF v_ref_pos IS NULL AND v_ref_cfg <> 'aprovado' THEN
    v_ref_cfg := 'aprovado';
    v_ref_pos := array_position(v_rb, 'aprovado');
  END IF;

  RETURN (
    WITH d AS (
      SELECT x.*, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib, m.status_planejamento AS st_plan,
             coalesce(m.ref, '') AS ref_atual, m.ref_auto
        FROM public._kanban_derivar_lote(v_tenant, NULL, v_prop) x
        JOIN public.modelos m ON m.id = x.modelo_id
       WHERE x.elegivel
    ), c AS (
      SELECT d.*,
             CASE WHEN d.status_atual = ANY (v_board_at) THEN d.status_atual ELSE v_board_at[1] END AS de,
             CASE WHEN d.derivavel THEN d.resultado
                  WHEN d.status_atual = ANY (v_board_nv) THEN d.status_atual
                  ELSE v_board_nv[1] END AS para,
             (d.derivavel AND d.ref_atual = '' AND coalesce(d.ref_auto, '') <> ''
              AND (d.fixado OR d.resultado IS DISTINCT FROM d.status_atual)
              -- medios R14 kanban #7 (P-190 A): card que fica em 'reprovado' nao revela a REF (≡ _kanban_aplicar)
              AND public._kanban_norm(d.resultado) <> 'reprovado'
              -- leves L3 fix round 1 (A1, P-213 A): reprovado no PLANEJAMENTO tambem nunca revela (≡ _kanban_status_gate)
              AND public._kanban_norm(d.st_plan) <> 'reprovado'
              AND CASE WHEN v_ref_pos IS NULL OR array_position(v_rb, public._kanban_norm(d.alvo)) IS NULL
                         THEN public._kanban_norm(d.alvo) = v_ref_cfg
                       ELSE array_position(v_rb, public._kanban_norm(d.alvo)) >= v_ref_pos
                  END) AS revela_ref
        FROM d
    )
    SELECT jsonb_build_object(
      'chave_proposta', coalesce((v_prop ->> 'kanban_automatico')::boolean, false),
      'total',   (SELECT count(*) FROM c),
      'mudam',   (SELECT count(*) FROM c WHERE c.de IS DISTINCT FROM c.para),
      'fixados', (SELECT count(*) FROM c WHERE c.fixado),
      'cards', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref', c.ref_exib, 'origem', c.origem,
                 'de', c.de, 'para', c.para, 'fixado', c.fixado,
                 'recua', coalesce(array_position(v_board_nv, c.para) < array_position(v_board_nv, c.de), false),
                 'primeira_falha', c.primeira_falha, 'faltando', to_jsonb(c.faltando))
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.de IS DISTINCT FROM c.para), '[]'::jsonb),
      'cards_fixados', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref', c.ref_exib, 'origem', c.origem,
                 'coluna', c.resultado, 'posicao_derivada', c.alvo)
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.fixado), '[]'::jsonb),
      'revelam_ref', (SELECT count(*) FROM c WHERE c.revela_ref),
      'refs_reveladas', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref_auto', c.ref_auto, 'posicao_derivada', c.alvo)
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.revela_ref), '[]'::jsonb),
      'avisos', CASE WHEN EXISTS (SELECT 1 FROM c WHERE c.revela_ref)
                     THEN jsonb_build_array('A REF revelada não volta ao desligar nem ao restaurar as colunas.')
                     ELSE '[]'::jsonb END)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean; v_relevante boolean; v_grupo_id uuid;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  -- leves L3 fix round 1 (A1, P-213 A + P-190 A): reprovado no PLANEJAMENTO nunca revela (NEW: vale no mesmo UPDATE que o marca;
  -- o _kanban_status_gate le a linha gravada). Reprovado no Dev segue a regra da R14 (chave ligada) via _kanban_status_gate.
  v_revelar := public._kanban_norm(NEW.status_planejamento) IS DISTINCT FROM 'reprovado'
    AND coalesce(public._ref_exibir_gate(NEW.tenant_id, public._kanban_status_gate(NEW.tenant_id, NEW.id, NEW.status_desenvolvimento)), false);

  SELECT c.nome, gp.nome, c.grupo_id INTO v_cat, v_grupo, v_grupo_id
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;

  v_sigla := public._ref_montar_sigla(NEW.tenant_id, 'interno', v_grupo_id, NEW.categoria_principal_id, NEW.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;

  IF NOT v_revelar THEN
    IF v_sigla <> '' THEN
      -- Número fixo na chegada: extrai o bloco final de dígitos do ref_auto atual, senão gera.
      IF coalesce(NEW.ref_auto,'') ~ '[0-9]+$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]+)$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
  ELSE
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
  v_erros text := '';
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3p_md5_aceitos LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l3p_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5 AND a.papel IN ('depois', 'dep')) THEN
      v_erros := v_erros || format(' [%s md5 %s]', r.assinatura, v_md5);
    END IF;
  END LOOP;
  IF v_erros <> '' THEN
    RAISE EXCEPTION 'leves_l3: pos-condicao falhou - texto inesperado:%', v_erros USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT assinatura, acl FROM _l3p_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l3: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('public._kanban_status_gate(uuid,uuid,text)'), ('public._kanban_aplicar(uuid,uuid[],text,uuid)'),
                                 ('public._kanban_derivar_lote(uuid,uuid[],jsonb)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.kanban_previa_recalculo(jsonb)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.kanban_previa_recalculo(jsonb)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.kanban_previa_recalculo(jsonb)') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'leves_l3: ACL de kanban_previa_recalculo fora do esperado' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

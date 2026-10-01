-- INVERSO de supabase/migrations/20261024100000_kanban_reprovado_nao_passa_gate.sql (achados MEDIOS R14, kanban #7, P-190 A).
-- Devolve o texto de ANTES das 3 funcoes: _kanban_status_gate (reprovado volta a usar a posicao DERIVADA com a chave
-- ligada - decisao 10 sem excecao), _kanban_aplicar (revela_ref sem o filtro de reprovado) e kanban_previa_recalculo.
-- Guarda: so roda se as 3 estao EXATAMENTE com o texto da ida (md5 de depois) e _kanban_derivar_lote/_ref_exibir_gate/
-- _kanban_ligado/_kanban_norm seguem com o texto conferido; outro -> P0001 e nada muda. Nada gravado muda (REF ja
-- revelada nunca volta - inv. #11). Site: a volta do site (statusParaGate) pode vir antes ou depois.
-- LIFO: nenhum outro inverso confere estes md5. Travas: so CREATE OR REPLACE FUNCTION.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._kanban_status_gate(uuid,uuid,text)', '635c7bbad3a3db2779f68fd1c5c8a954'),
      ('public._kanban_aplicar(uuid,uuid[],text,uuid)', '9c50c6700d5bedc22b53ee95466d43f4'),
      ('public.kanban_previa_recalculo(jsonb)', '1ed117822a5dc7b5a3f54559ba68b89b'),
      ('public._kanban_derivar_lote(uuid,uuid[],jsonb)', '0755d9ad499379295ba24c7a669daa76'),
      ('public._ref_exibir_gate(uuid,text)', '824e463a9223f3fe4646d771276c856f'),
      ('public._kanban_ligado(uuid)', '82ddd5ea48af16f92843ebe6226fca2b'),
      ('public._kanban_norm(text)', '74606b6e06de34fa23fd0642d1ebafbb')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r14 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r14 (volta): % nao esta com o texto esperado da 20261024100000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r14kv_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._kanban_status_gate(uuid,uuid,text)'), ('public._kanban_aplicar(uuid,uuid[],text,uuid)'), ('public.kanban_previa_recalculo(jsonb)')) v(s);

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
  IF _tenant IS NULL OR _modelo_id IS NULL OR NOT public._kanban_ligado(_tenant) THEN
    RETURN _status_atual;
  END IF;
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
           (d.fixado AND public._ref_exibir_gate(_tenant, d.alvo)) AS revela_ref
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
      SELECT x.*, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib,
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

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._kanban_status_gate(uuid,uuid,text)', 'a3a7751675f378297b970e5bbe23c435'),
      ('public._kanban_aplicar(uuid,uuid[],text,uuid)', '17c35880433e381332883c932ef6f0b0'),
      ('public.kanban_previa_recalculo(jsonb)', 'afb8beebd6d121e0654f867f6711682b')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r14 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ACL identica a de antes (CREATE OR REPLACE nao mexe; conferido).
  FOR r IN SELECT assinatura, acl FROM _r14kv_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r14 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._kanban_status_gate(uuid,uuid,text)'), ('public._kanban_aplicar(uuid,uuid[],text,uuid)'), ('public._kanban_derivar_lote(uuid,uuid[],jsonb)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r14 (volta): % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r14 (volta): % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- kanban_previa_recalculo: RPC publica (admin da loja) - authenticated SIM; anon e PUBLIC NAO (como hoje).
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.kanban_previa_recalculo(jsonb)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.kanban_previa_recalculo(jsonb)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.kanban_previa_recalculo(jsonb)') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r14 (volta): ACL de kanban_previa_recalculo fora do esperado (authenticated sim; anon/PUBLIC nao)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

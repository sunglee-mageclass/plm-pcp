-- Integração — PERMISSAO POR ABA (Campos da API / API / Manual da API) com Ler E Editar separados, concedidas SO pelo
-- super admin (nov/2026, dono). Antes essas abas eram "so super admin" em bloco (_integracao_exige_super); agora cada
-- uma tem uma SECTION propria no catalogo (integracao:campos_api / integracao:api / integracao:manual_api). A aba LOG
-- NAO tem permissao propria: fica junto da permissao base `integracao` (como Produtos — decisao do dono) e
-- integracao_log_listar NAO e tocada aqui. O front gateia a visibilidade/edicao (useAuth.ehPaginaSemBypassAdmin ja
-- cobre `integracao:*`); AQUI o servidor libera as RPCs de cada aba para quem tem a SECTION, alem do super admin e de
-- quem tem a pagina `integracao` em bloco.
--
-- Helpers novos (DEFINER, EXECUTE revogado dos 3, inv. 9):
--   • _integracao_pode_secao(_secao, _editar) = is_super_admin() OR a linha `integracao` OU `integracao:<secao>` em
--     _perm_efetiva(auth.uid()) com pode_ver/pode_editar.
--   • _integracao_exige_secao(_secao, _editar) = login + loja ativa + _integracao_pode_secao (senao 42501).
--   • _integracao_exige_aba(_editar) = login + loja ativa + (super OU `integracao` OU campos_api/api/manual_api): gate
--     da leitura da config compartilhada (integracao_config_ler), que alimenta as abas Produtos/Campos/API. Log NAO
--     entra (nem precisa: quem ve o Log tem a base `integracao`, ja coberta).
--
-- RPCs ampliadas (troca do PORTAO; corpo byte a byte identico ao vivo fora da linha do gate — geradas sobre
-- pg_get_functiondef, md5 diff-validado antes/depois):
--   • Campos da API: integracao_salvar_config            → _integracao_exige_secao('campos_api', true)
--   • API (escrita):  integracao_salvar_config_api, integracao_chave_criar, integracao_chave_revogar
--                                                         → _integracao_exige_secao('api', true)
--   • API (leitura):  integracao_chaves_listar, integracao_acessos_listar, integracao_exemplo
--                                                         → _integracao_exige_secao('api', false)
--   • Compartilhada: integracao_config_ler — gate → _integracao_exige_aba(false); o bloco `api` (faixas) passa a
--     aparecer para super OU quem tem `integracao:api` (antes so super).
--   • Manual da API: SO leitura, sem RPC sensivel → gate no front basta (nenhuma RPC tocada).
--   • Log: SEM section — integracao_log_listar / aba Produtos (integracao_listar/_previa/salvar/marcar) seguem no gate
--     de bloco _integracao_exige(`integracao`), INTOCADAS.
-- Nenhuma mudanca de dado. Idempotente (CREATE OR REPLACE; guarda aceita o texto de antes OU o de depois). Inverso em
-- supabase/rollback/20261205100000_integracao_perm_abas_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v text;
BEGIN
  IF to_regprocedure('public._integracao_pode(boolean)') IS NULL
     OR to_regprocedure('public._integracao_exige(boolean)') IS NULL
     OR to_regprocedure('public._perm_efetiva(uuid)') IS NULL
     OR to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'integracao_perm_abas: aplique as migrations da Integracao (delta 7 / _perm_efetiva) antes' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_salvar_config(text[],integer)'::regprocedure));
  IF v NOT IN ('e71312f89640076b5b285c9464216aa4', '277b54cad770348a150106944af6f3bf') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_salvar_config inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_salvar_config_api(jsonb,integer)'::regprocedure));
  IF v NOT IN ('a90484d095fa09e10a0bb49e5253e11c', 'aac6f2757e15b16c14410d5a1133e2ae') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_salvar_config_api inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_chave_criar(text)'::regprocedure));
  IF v NOT IN ('ece7b56faabb8e237a83c933e1534382', 'b5712922021a0e17c6a6d02aae214fc4') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_chave_criar inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_chave_revogar(uuid)'::regprocedure));
  IF v NOT IN ('16f8db9eae45448ba369861e298098f5', '5a7b859ddb7c2c4b44c2ca19fb5f7674') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_chave_revogar inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_chaves_listar()'::regprocedure));
  IF v NOT IN ('7e826acfef7bcb79c6bcc6fc56942d1e', '75cc0c7b89f8c3824ad4facaabfe1576') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_chaves_listar inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_acessos_listar(integer)'::regprocedure));
  IF v NOT IN ('01fc416258fb57bc4ed8433fe026ec64', 'e019faf589ac297a8a619d7f93b99eff') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_acessos_listar inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_exemplo()'::regprocedure));
  IF v NOT IN ('1a46dfa33c0d15398e22495bf2d48699', '903d64af12e36390bedb7fa232a237dc') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_exemplo inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_config_ler()'::regprocedure));
  IF v NOT IN ('62b81b3853de66118baef1748866b0dd', '50aab98e50e6ae225a276431c1f572f0') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_config_ler inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- ── Helpers por SECTION / por ABA ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._integracao_pode_secao(_secao text, _editar boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public._perm_efetiva(auth.uid()) e
         WHERE e.pagina IN ('integracao', 'integracao:' || _secao)
           AND CASE WHEN coalesce(_editar, false) THEN e.pode_editar ELSE e.pode_ver END
      );
$function$;
CREATE OR REPLACE FUNCTION public._integracao_exige_secao(_secao text, _editar boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _editar AND NOT public._integracao_pode_secao(_secao, true) THEN
    RAISE EXCEPTION 'Sem permissão para editar esta aba da Integração.' USING ERRCODE = '42501';
  END IF;
  IF NOT _editar AND NOT public._integracao_pode_secao(_secao, false) THEN
    RAISE EXCEPTION 'Sem permissão para ver esta aba da Integração.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$;
CREATE OR REPLACE FUNCTION public._integracao_exige_aba(_editar boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin() OR EXISTS (
            SELECT 1 FROM public._perm_efetiva(auth.uid()) e
             WHERE e.pagina IN ('integracao', 'integracao:campos_api', 'integracao:api', 'integracao:manual_api')
               AND CASE WHEN coalesce(_editar, false) THEN e.pode_editar ELSE e.pode_ver END)) THEN
    RAISE EXCEPTION 'Sem permissão para ver a Integração.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$;

-- ── RPCs reemitidas (so a linha do gate mudou) ──
CREATE OR REPLACE FUNCTION public.integracao_salvar_config(_campos text[], _rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_secao('campos_api', true);
  v_cfg public.integracao_config;
  v_novos text[];
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(coalesce(_campos, '{}'::text[])) AS k(x) WHERE k.x <> ALL(public._integracao_layout())) THEN
    RAISE EXCEPTION 'Campo desconhecido na seleção.' USING ERRCODE = 'P0001';
  END IF;
  v_novos := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                    WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  IF cardinality(v_novos) = 0 THEN
    RAISE EXCEPTION 'Marque pelo menos um campo.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.integracao_config c WHERE c.tenant_id = v_tenant FOR UPDATE;
  v_cfg := public._integracao_cfg(v_tenant);
  IF v_cfg.rev IS DISTINCT FROM _rev THEN
    RAISE EXCEPTION 'conflito_versao: a configuracao foi salva por outra pessoa' USING ERRCODE = 'P0409';
  END IF;
  INSERT INTO public.integracao_config AS c (tenant_id, campos, rev, atualizado_por, atualizado_em)
  VALUES (v_tenant, v_novos, 1, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE SET campos = excluded.campos, rev = c.rev + 1,
                                        atualizado_por = excluded.atualizado_por, atualizado_em = now();
  PERFORM public._integracao_logar(v_tenant, 'campos', NULL,
    jsonb_build_object('antes', to_jsonb(v_cfg.campos), 'depois', to_jsonb(v_novos)), NULL);
  RETURN public.integracao_config_ler();
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_salvar_config_api(_valores jsonb, _rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_secao('api', true);
  v_cfg public.integracao_config;
  v_v jsonb := coalesce(_valores, '{}'::jsonb);
  v_lim integer;
  v_pag integer;
  v_foto integer;
  v_blq integer;
  v_k text;
BEGIN
  -- re-review round 1 (#6 nit): _valores não-objeto (ex.: array) faria jsonb_object_keys estourar 22023 cru;
  -- recusa cedo com P0001 em PT, mesmo padrão de tudo mais nesta função.
  IF jsonb_typeof(v_v) <> 'object' THEN
    RAISE EXCEPTION 'Configuracao invalida: esperado um objeto.' USING ERRCODE = 'P0001';
  END IF;
  -- revisão T6 #6 (Minor #6): chave desconhecida (typo) recusa cedo em vez de ser silenciosamente ignorada.
  FOR v_k IN SELECT jsonb_object_keys(v_v) LOOP
    IF v_k <> ALL(ARRAY['limite_por_minuto', 'max_por_pagina', 'validade_foto_dias', 'bloqueio_tentativas']) THEN
      RAISE EXCEPTION 'Configuracao desconhecida: %', v_k USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  PERFORM 1 FROM public.integracao_config c WHERE c.tenant_id = v_tenant FOR UPDATE;
  v_cfg := public._integracao_cfg(v_tenant);
  IF v_cfg.rev IS DISTINCT FROM _rev THEN
    RAISE EXCEPTION 'conflito_versao: a configuracao foi salva por outra pessoa' USING ERRCODE = 'P0409';
  END IF;
  -- revisão T6 #6 (Minor #6): valida TIPO antes do cast — um valor não-inteiro (jsonb_typeof <> 'number' ou número
  -- fracionário) dava um 22P02 cru em inglês; agora recusa com P0001 em PT, mesmo padrão das faixas abaixo.
  -- re-review round 1 (#6 nit): o range do PR8 (-2147483648..2147483647, limite do tipo `integer` de 32 bits) é
  -- conferido AQUI (antes de qualquer ::integer) — um valor fora disso (ex.: 3000000000) dava 22003 cru; agora cai
  -- na mesma mensagem P0001, e como a faixa de negócio (1-600 etc.) é sempre mais estreita que o range do tipo,
  -- nenhum valor hoje aceito pela faixa de negócio jamais bateria nesta checagem.
  IF v_v ? 'limite_por_minuto' AND (jsonb_typeof(v_v -> 'limite_por_minuto') <> 'number'
      OR (v_v -> 'limite_por_minuto')::text !~ '^-?\d+$'
      OR (v_v -> 'limite_por_minuto')::text::numeric NOT BETWEEN -2147483648 AND 2147483647) THEN
    RAISE EXCEPTION 'Limite de consultas por minuto precisa ser um numero inteiro.' USING ERRCODE = 'P0001';
  END IF;
  IF v_v ? 'max_por_pagina' AND (jsonb_typeof(v_v -> 'max_por_pagina') <> 'number'
      OR (v_v -> 'max_por_pagina')::text !~ '^-?\d+$'
      OR (v_v -> 'max_por_pagina')::text::numeric NOT BETWEEN -2147483648 AND 2147483647) THEN
    RAISE EXCEPTION 'Maximo de produtos por pagina precisa ser um numero inteiro.' USING ERRCODE = 'P0001';
  END IF;
  IF v_v ? 'validade_foto_dias' AND (jsonb_typeof(v_v -> 'validade_foto_dias') <> 'number'
      OR (v_v -> 'validade_foto_dias')::text !~ '^-?\d+$'
      OR (v_v -> 'validade_foto_dias')::text::numeric NOT BETWEEN -2147483648 AND 2147483647) THEN
    RAISE EXCEPTION 'Validade dos links das fotos precisa ser um numero inteiro.' USING ERRCODE = 'P0001';
  END IF;
  IF v_v ? 'bloqueio_tentativas' AND (jsonb_typeof(v_v -> 'bloqueio_tentativas') <> 'number'
      OR (v_v -> 'bloqueio_tentativas')::text !~ '^-?\d+$'
      OR (v_v -> 'bloqueio_tentativas')::text::numeric NOT BETWEEN -2147483648 AND 2147483647) THEN
    RAISE EXCEPTION 'Bloqueio de IP precisa ser um numero inteiro.' USING ERRCODE = 'P0001';
  END IF;
  v_lim := coalesce((v_v ->> 'limite_por_minuto')::integer, v_cfg.limite_por_minuto);
  v_pag := coalesce((v_v ->> 'max_por_pagina')::integer, v_cfg.max_por_pagina);
  v_foto := coalesce((v_v ->> 'validade_foto_dias')::integer, v_cfg.validade_foto_dias);
  v_blq := coalesce((v_v ->> 'bloqueio_tentativas')::integer, v_cfg.bloqueio_tentativas);
  -- faixa = recusa; fora do RECOMENDADO a tela alerta antes e o servidor aceita (v4)
  IF v_lim NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'Limite de consultas por minuto fora da faixa permitida (1–600).' USING ERRCODE = 'P0001';
  END IF;
  IF v_pag NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Máximo de produtos por página fora da faixa permitida (1–500).' USING ERRCODE = 'P0001';
  END IF;
  IF v_foto NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Validade dos links das fotos fora da faixa permitida (1–30 dias).' USING ERRCODE = 'P0001';
  END IF;
  IF v_blq NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'Bloqueio de IP fora da faixa permitida (3–100 tentativas).' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.integracao_config AS c (tenant_id, limite_por_minuto, max_por_pagina, validade_foto_dias,
                                             bloqueio_tentativas, rev, atualizado_por, atualizado_em)
  VALUES (v_tenant, v_lim, v_pag, v_foto, v_blq, 1, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE SET limite_por_minuto = excluded.limite_por_minuto, max_por_pagina = excluded.max_por_pagina,
    validade_foto_dias = excluded.validade_foto_dias, bloqueio_tentativas = excluded.bloqueio_tentativas, rev = c.rev + 1,
    atualizado_por = excluded.atualizado_por, atualizado_em = now();
  PERFORM public._integracao_logar(v_tenant, 'config_api', NULL, jsonb_build_object(
    'antes', jsonb_build_object('limite_por_minuto', v_cfg.limite_por_minuto, 'max_por_pagina', v_cfg.max_por_pagina,
                                'validade_foto_dias', v_cfg.validade_foto_dias, 'bloqueio_tentativas', v_cfg.bloqueio_tentativas),
    'depois', jsonb_build_object('limite_por_minuto', v_lim, 'max_por_pagina', v_pag, 'validade_foto_dias', v_foto,
                                 'bloqueio_tentativas', v_blq)), NULL);
  RETURN public.integracao_config_ler();
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_chave_criar(_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_secao('api', true);
  v_nome text := btrim(coalesce(_nome, ''));
  v_chave text;
  v_final text;
  v_id uuid;
BEGIN
  IF length(v_nome) < 1 OR length(v_nome) > 60 THEN
    RAISE EXCEPTION 'Dê um nome à chave (até 60 caracteres).' USING ERRCODE = 'P0001';
  END IF;
  -- D17: 24 bytes aleatórios em base64url = 32 caracteres; só o SHA-256 é guardado
  v_chave := 'wish_live_' || translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_final := right(v_chave, 4);
  INSERT INTO public.integracao_chaves (tenant_id, nome, hash, final, criada_por)
  VALUES (v_tenant, v_nome, encode(extensions.digest(v_chave, 'sha256'), 'hex'), v_final, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public._integracao_logar(v_tenant, 'chave_criar', NULL, jsonb_build_object('nome', v_nome, 'final', v_final), NULL);
  RETURN jsonb_build_object('id', v_id, 'nome', v_nome, 'chave', v_chave, 'final', v_final);
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_chave_revogar(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_secao('api', true);
  v_nome text;
  v_final text;
BEGIN
  UPDATE public.integracao_chaves SET revogada_em = now(), revogada_por = auth.uid()
   WHERE id = _id AND tenant_id = v_tenant AND revogada_em IS NULL
  RETURNING nome, final INTO v_nome, v_final;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chave não encontrada ou já revogada.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._integracao_logar(v_tenant, 'chave_revogar', NULL, jsonb_build_object('nome', v_nome, 'final', v_final), NULL);
  RETURN jsonb_build_object('ok', true);
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_chaves_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_secao('api', false);
BEGIN
  -- N11/D32: nunca devolve o hash
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome, 'final', k.final,
             'criada_por', coalesce((SELECT coalesce(nullif(btrim(u.nome::text), ''), u.email::text) FROM public.users u WHERE u.id = k.criada_por), '—'),
             'criada_em', k.criada_em, 'revogada_em', k.revogada_em, 'ultimo_uso_em', k.ultimo_uso_em)
             ORDER BY (k.revogada_em IS NOT NULL), k.criada_em DESC)
      FROM public.integracao_chaves k
     WHERE k.tenant_id = v_tenant), '[]'::jsonb);
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_acessos_listar(_limite integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_secao('api', false);
  v_lim integer := least(greatest(coalesce(_limite, 50), 1), 200);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(s.x ORDER BY s.q DESC)
      FROM (SELECT jsonb_build_object('id', a.id, 'chave', k.nome, 'final', k.final,
                     'ip', CASE WHEN a.status IN ('chave_invalida', 'ip_bloqueado') THEN a.ip END,
                     'modo', a.modo, 'status', a.status, 'tentativas', a.tentativas, 'produtos', a.produtos_entregues,
                     'exemplos', (a.detalhe ->> 'exemplos')::integer,
                     'linhas', a.linhas, 'quando', coalesce(a.minuto, a.criado_em)) AS x,
                   coalesce(a.minuto, a.criado_em) AS q
              FROM public.integracao_acessos a
              LEFT JOIN public.integracao_chaves k ON k.id = a.chave_id
             WHERE a.tenant_id = v_tenant OR (a.tenant_id IS NULL AND a.status IN ('chave_invalida', 'ip_bloqueado'))
             ORDER BY coalesce(a.minuto, a.criado_em) DESC
             LIMIT v_lim) s), '[]'::jsonb);
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_exemplo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_secao('api', false);
  v_cfg public.integracao_config;
  v_ex jsonb;
  v_cols jsonb;
BEGIN
  -- N12: SÓ super admin, da loja atual, NÃO registra acesso e NÃO conta no limite; a tela mostra a foto como null
  v_cfg := public._integracao_cfg(v_tenant);
  v_ex := public._integracao_exemplo(v_cfg.campos, 1);
  v_cols := public._integracao_colunas(v_cfg.campos);
  RETURN jsonb_build_object('status', 'ok', 'modo', 'teste', 'tenant_id', v_tenant,
    'loja', jsonb_build_object('id', v_tenant, 'nome', (SELECT t.nome FROM public.tenants t WHERE t.id = v_tenant)),
    'colunas', v_cols -> 'rotulos', 'chaves_colunas', v_cols -> 'chaves', 'produtos', v_ex -> 'produtos',
    'proximo_cursor', v_ex -> 'proximo_cursor', 'validade_foto_dias', v_cfg.validade_foto_dias,
    'pagina', jsonb_build_object('limite', 2, 'maximo', v_cfg.max_por_pagina));
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_config_ler()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_aba(false);
  v_cfg public.integracao_config;
BEGIN
  v_cfg := public._integracao_cfg(v_tenant);
  -- LER os campos = quem vê a tela (a aba Produtos monta as colunas); config da API = SÓ super admin (v4)
  RETURN jsonb_build_object('campos', to_jsonb(v_cfg.campos), 'layout', to_jsonb(public._integracao_layout()),
    'rotulos', public._integracao_rotulos(), 'rev', v_cfg.rev,
    -- Release I3: o padrão marcado (loja nova / reset) e os campos NÃO obrigatórios (vazio não é falta; não travam)
    'padrao', to_jsonb(public._integracao_padrao()), 'opcionais', to_jsonb(public._integracao_opcionais()),
    'api', CASE WHEN public.is_super_admin() OR public._integracao_pode_secao('api', false) THEN jsonb_build_object(
      'limite_por_minuto', v_cfg.limite_por_minuto, 'max_por_pagina', v_cfg.max_por_pagina,
      'validade_foto_dias', v_cfg.validade_foto_dias, 'bloqueio_tentativas', v_cfg.bloqueio_tentativas) END);
END
$function$
;
REVOKE ALL ON FUNCTION public._integracao_pode_secao(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._integracao_exige_secao(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._integracao_exige_aba(boolean) FROM PUBLIC, anon, authenticated;

-- ACL das RPCs reemitidas NAO muda (CREATE OR REPLACE preserva os grants): seguem sem PUBLIC/anon, com EXECUTE p/
-- authenticated.
NOTIFY pgrst, 'reload schema';

DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._integracao_pode_secao(text,boolean)', 'public._integracao_exige_secao(text,boolean)',
    'public._integracao_exige_aba(boolean)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_perm_abas: % executavel por PUBLIC/anon/authenticated (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.integracao_salvar_config(text[],integer)', 'public.integracao_salvar_config_api(jsonb,integer)',
    'public.integracao_chave_criar(text)', 'public.integracao_chave_revogar(uuid)', 'public.integracao_chaves_listar()',
    'public.integracao_acessos_listar(integer)', 'public.integracao_exemplo()'] LOOP
    IF pg_get_functiondef(f::regprocedure) !~ '_integracao_exige_secao\(' THEN
      RAISE EXCEPTION 'integracao_perm_abas: % nao ficou com _integracao_exige_secao', f USING ERRCODE = 'P0001';
    END IF;
    IF pg_get_functiondef(f::regprocedure) ~ '_integracao_exige_super\(' THEN
      RAISE EXCEPTION 'integracao_perm_abas: % ainda cita _integracao_exige_super', f USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_perm_abas: ACL inesperada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- config_ler usa o gate de aba; Log e Produtos NAO foram tocados (seguem no gate de bloco _integracao_exige).
  IF pg_get_functiondef('public.integracao_config_ler()'::regprocedure) !~ '_integracao_exige_aba\(' THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_config_ler nao ficou com _integracao_exige_aba' USING ERRCODE = 'P0001';
  END IF;
  IF pg_get_functiondef('public.integracao_log_listar(integer)'::regprocedure) ~ '_integracao_(exige|pode)_secao\(|_integracao_exige_aba\(' THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_log_listar NAO deveria ser tocada (Log fica na base)' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
             AND p.proname IN ('integracao_listar','integracao_previa')
             AND pg_get_functiondef(p.oid) ~ '_integracao_exige_secao\(') THEN
    RAISE EXCEPTION 'integracao_perm_abas: integracao_listar/previa nao deveria usar _integracao_exige_secao' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

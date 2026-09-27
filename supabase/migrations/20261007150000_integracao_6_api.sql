-- Integração + API — 6/6: CONFIGURAÇÕES, CHAVES, ACESSOS e as 2 FASES DA API (spec §5, §7; P-64 A, P-66 A, P-67 A,
-- P-69 A, P-81 A, P-82 A; R7, R11, V4, n3, n4, N11, N12). Só funções.
-- Super admin (v4 — "campos API e chaves e acessos, somente super admin"; substitui a P-66 A nesse ponto): salvar campos
-- (rev + log 'campos'), salvar config da API (faixas; log 'config_api'), chaves (SHA-256; a chave aparece 1× — D17),
-- acessos, "Ver resposta de exemplo" (N12: não registra acesso nem conta no limite).
-- Rota da API (SÓ service_role): _integracao_ler (transação 1: chave por HASH, loja ativa, bloqueio por IP (D18), limite
-- por chave sob pg_advisory_xact_lock + RESERVA do acesso (V4), página por PRODUTO com cursor (D21), colunas = união
-- dos retratos (D6), modo teste = só exemplos (P-82 A)); _integracao_confirmar (transação 2: reconfere chave/loja,
-- FOR UPDATE, marca integrado SÓ o que ainda está integrável com a MESMA assinatura, log 'integrado' com a chave);
-- _integracao_limpar (≤ 500 linhas de 90+ dias da loja, só quem não entregou — n4/D20). Chave errada NUNCA dá RAISE
-- (nota 9): devolve status e registra AGREGADO por IP/minuto (D19).
-- Contagens: +13 funções | +0 gatilhos. Inverso: supabase/rollback/20261007150000_integracao_6_api_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_6: aplique a migration 5 antes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_colunas(_campos text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'chaves', coalesce(jsonb_agg(u.x ORDER BY u.n), '[]'::jsonb),
    'rotulos', coalesce(jsonb_agg(public._integracao_rotulos() ->> u.x ORDER BY u.n), '[]'::jsonb))
    FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
   WHERE u.x = ANY(coalesce(_campos, '{}'::text[]))
$function$;

CREATE OR REPLACE FUNCTION public._integracao_exemplo(_campos text[], _pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[] := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                            WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  v_pag integer := least(greatest(coalesce(_pagina, 1), 1), 2);
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_ref text;
  v_nome text;
  v_desc text;
  v_base jsonb;
  v_linha jsonb;
  v_linhas jsonb;
  v_tam text;
BEGIN
  -- P-82 A: produtos FICTÍCIOS no formato real (mesmas colunas marcadas da loja), 2 por página, 2 páginas. NUNCA lê produto.
  FOR v_i IN ((v_pag - 1) * 2 + 1)..((v_pag - 1) * 2 + 2) LOOP
    v_ref := 'EXPL' || lpad(v_i::text, 4, '0');
    v_nome := 'Produto Exemplo ' || v_i;
    v_desc := 'Descrição de exemplo do produto ' || v_i || '.';
    v_base := jsonb_build_object('nome', v_nome, 'ref_sku', v_ref, 'preco_anterior', '109.90', 'preco_venda', '99.90',
      'peso', '0.300', 'ncm', '6109.10.00', 'preco_custo', '42.00', 'cor_base', NULL, 'cor_apelido', NULL, 'tamanho', NULL,
      'titulo', v_nome || ' - exemplo', 'descricao', v_desc, 'keywords', 'exemplo, teste', 'metatag', v_desc,
      'comprimento', '60', 'largura', '40', 'altura', '2');
    v_linhas := jsonb_build_array(jsonb_build_object('tipo', 'produto', 'valores',
      (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '["exemplo"]'::jsonb ELSE coalesce(v_base -> u.x, 'null'::jsonb) END
                                 ORDER BY u.n), '[]'::jsonb)
         FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    FOREACH v_tam IN ARRAY ARRAY['P', 'M'] LOOP
      v_linha := v_base || jsonb_build_object('nome', v_nome || ' ' || v_tam, 'ref_sku', v_ref || '-COR-' || v_tam,
        'cor_base', 'Cor Exemplo', 'cor_apelido', 'Apelido Exemplo', 'tamanho', v_tam);
      v_linhas := v_linhas || jsonb_build_array(jsonb_build_object('tipo', 'variante', 'valores',
        (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '[]'::jsonb ELSE coalesce(v_linha -> u.x, 'null'::jsonb) END
                                   ORDER BY u.n), '[]'::jsonb)
           FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object('modelo_id', 'exemplo-' || lpad(v_i::text, 4, '0'),
      'estado', 'teste', 'assinatura', NULL, 'integrado_em', NULL, 'linhas', v_linhas));
  END LOOP;
  RETURN jsonb_build_object('produtos', v_out, 'proximo_cursor',
    CASE WHEN v_pag = 1 THEN to_jsonb(encode(convert_to('{"exemplo": 2}', 'UTF8'), 'base64')) ELSE 'null'::jsonb END);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_valores(_l public.integracao_linhas, _chaves text[], _campos_produto text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- valores na ordem de _chaves; campo fora do retrato DESTE produto = null (D6); foto = lista de caminhos (D5)
  SELECT coalesce(jsonb_agg(CASE WHEN NOT (u.k = ANY(coalesce(_campos_produto, '{}'::text[]))) THEN 'null'::jsonb
    ELSE coalesce(CASE u.k
      WHEN 'nome' THEN to_jsonb(_l.nome) WHEN 'ref_sku' THEN to_jsonb(_l.ref_sku)
      WHEN 'preco_anterior' THEN to_jsonb(_l.preco_anterior) WHEN 'preco_venda' THEN to_jsonb(_l.preco_venda)
      WHEN 'peso' THEN to_jsonb(_l.peso) WHEN 'ncm' THEN to_jsonb(_l.ncm) WHEN 'preco_custo' THEN to_jsonb(_l.preco_custo)
      WHEN 'cor_base' THEN to_jsonb(_l.cor_base) WHEN 'cor_apelido' THEN to_jsonb(_l.cor_apelido)
      WHEN 'tamanho' THEN to_jsonb(_l.tamanho) WHEN 'titulo' THEN to_jsonb(_l.titulo)
      WHEN 'descricao' THEN to_jsonb(_l.descricao) WHEN 'keywords' THEN to_jsonb(_l.keywords)
      WHEN 'metatag' THEN to_jsonb(_l.metatag) WHEN 'comprimento' THEN to_jsonb(_l.comprimento)
      WHEN 'largura' THEN to_jsonb(_l.largura) WHEN 'altura' THEN to_jsonb(_l.altura)
      WHEN 'foto' THEN to_jsonb(coalesce(_l.fotos, '{}'::text[]))
    END, 'null'::jsonb) END ORDER BY u.n), '[]'::jsonb)
    FROM unnest(_chaves) WITH ORDINALITY AS u(k, n)
$function$;

CREATE OR REPLACE FUNCTION public.integracao_salvar_config(_campos text[], _rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
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
$function$;

CREATE OR REPLACE FUNCTION public.integracao_salvar_config_api(_valores jsonb, _rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
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
$function$;

CREATE OR REPLACE FUNCTION public.integracao_chaves_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
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
$function$;

CREATE OR REPLACE FUNCTION public.integracao_chave_criar(_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
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
$function$;

CREATE OR REPLACE FUNCTION public.integracao_chave_revogar(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
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
$function$;

CREATE OR REPLACE FUNCTION public.integracao_acessos_listar(_limite integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
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
$function$;

CREATE OR REPLACE FUNCTION public.integracao_exemplo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
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
$function$;

CREATE OR REPLACE FUNCTION public._integracao_ler(_chave_hash text, _incluir_integrados boolean, _cursor text,
  _limite integer, _modo text, _ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text := left(coalesce(nullif(btrim(coalesce(_ip, '')), ''), 'desconhecido'), 64);
  v_min timestamptz := date_trunc('minute', now());
  k public.integracao_chaves%ROWTYPE;
  v_achou boolean;
  v_cfg public.integracao_config;
  v_ativo boolean;
  v_loja text;
  v_limiar integer;
  v_erradas integer;
  v_usadas integer;
  v_mais_velho timestamptz;
  v_retry integer;
  v_acesso uuid;
  v_cur jsonb := '{}'::jsonb;
  v_depois uuid;
  v_pag integer;
  v_lim integer;
  v_mais boolean;
  v_pedidos integer;
  v_ultimo_id uuid;
  v_campos text[];
  v_cols jsonb;
  v_prods jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_linhas integer;
BEGIN
  IF _modo IS NULL OR _modo NOT IN ('normal', 'teste') THEN
    RETURN jsonb_build_object('status', 'parametro_invalido');
  END IF;
  IF nullif(btrim(coalesce(_cursor, '')), '') IS NOT NULL THEN
    BEGIN
      v_cur := convert_from(decode(_cursor, 'base64'), 'UTF8')::jsonb;
      v_depois := (v_cur ->> 'depois')::uuid;
      v_pag := (v_cur ->> 'exemplo')::integer;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'parametro_invalido');
    END;
    -- ruling do controlador, G-migration fix 1 #G4 (A-M7): cursor do OUTRO modo (ex.: {"exemplo":n} usado com
    -- modo=normal, ou {"depois":...} usado com modo=teste) tem que dar o MESMO parametro_invalido — nunca "voltar
    -- à página 1" em silêncio (v_depois/v_pag ficam NULL quando a chave do cursor não bate com o modo pedido, e
    -- sem esta checagem o código seguia como se nenhum cursor tivesse sido mandado).
    IF (_modo = 'normal' AND v_depois IS NULL) OR (_modo = 'teste' AND v_pag IS NULL) THEN
      RETURN jsonb_build_object('status', 'parametro_invalido');
    END IF;
  END IF;
  SELECT * INTO k FROM public.integracao_chaves WHERE hash = lower(coalesce(_chave_hash, '')) AND revogada_em IS NULL;
  v_achou := FOUND;
  -- D18 (revisto no G-plano do plano): o bloqueio por IP vale SÓ para chave ERRADA/revogada — a chave válida nunca é bloqueada
  -- por IP (192 bits: força bruta inviável; um IP compartilhado não derruba o ERP de outra loja). Limiar = o MENOR
  -- bloqueio_tentativas entre as lojas (padrão 10), porque a loja de uma chave errada é desconhecida.
  IF NOT v_achou THEN
    SELECT coalesce(min(c.bloqueio_tentativas), 10) INTO v_limiar FROM public.integracao_config c;
    SELECT coalesce(sum(a.tentativas), 0), min(a.minuto) INTO v_erradas, v_mais_velho FROM public.integracao_acessos a
     WHERE a.agregado = 'inv:' || v_ip AND a.minuto > now() - interval '10 minutes';
    IF v_erradas >= v_limiar THEN
      INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
      VALUES (NULL, NULL, v_ip, _modo, 'ip_bloqueado', 'blq:' || v_ip, v_min, 1)
      ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
      v_retry := greatest(1, ceil(extract(epoch FROM (v_mais_velho + interval '10 minutes' - now())))::integer);
      RETURN jsonb_build_object('status', 'ip_bloqueado', 'retry_after', v_retry);
    END IF;
  END IF;
  IF NOT v_achou THEN
    -- nota 9: NUNCA RAISE aqui — o registro agregado tem de ficar (D19)
    INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
    VALUES (NULL, NULL, v_ip, _modo, 'chave_invalida', 'inv:' || v_ip, v_min, 1)
    ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
    RETURN jsonb_build_object('status', 'chave_invalida');
  END IF;
  v_cfg := public._integracao_cfg(k.tenant_id);
  SELECT t.ativo, t.nome INTO v_ativo, v_loja FROM public.tenants t WHERE t.id = k.tenant_id;
  IF NOT coalesce(v_ativo, false) THEN
    INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
    VALUES (k.tenant_id, k.id, v_ip, _modo, 'loja_inativa', 'ina:' || k.id::text, v_min, 1)
    ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
    RETURN jsonb_build_object('status', 'loja_inativa', 'tenant_id', k.tenant_id);
  END IF;
  -- R7/V4: limite POR CHAVE contado e RESERVADO sob a trava da chave (rajada paralela não fura); 429 não conta.
  -- revisão T6 #8 (Minor #8): hashtextextended (64-bit, mesmo padrão de integracao_marcar/sku_modelo) em vez de
  -- hashtext (32-bit) — evita compartilhar o namespace de 32 bits com outras travas do sistema.
  PERFORM pg_advisory_xact_lock(hashtextextended('integracao_chave:' || k.id::text, 0));
  SELECT count(*), min(a.criado_em) INTO v_usadas, v_mais_velho FROM public.integracao_acessos a
   WHERE a.chave_id = k.id AND a.agregado IS NULL AND a.criado_em > now() - interval '60 seconds';
  IF v_usadas >= v_cfg.limite_por_minuto THEN
    INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
    VALUES (k.tenant_id, k.id, v_ip, _modo, 'limite_excedido', 'lim:' || k.id::text, v_min, 1)
    ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
    v_retry := greatest(1, ceil(extract(epoch FROM (v_mais_velho + interval '60 seconds' - now())))::integer);
    RETURN jsonb_build_object('status', 'limite_excedido', 'retry_after', v_retry, 'tenant_id', k.tenant_id);
  END IF;
  INSERT INTO public.integracao_acessos (tenant_id, chave_id, ip, modo, status)
  VALUES (k.tenant_id, k.id, v_ip, _modo, 'reservado') RETURNING id INTO v_acesso;
  UPDATE public.integracao_chaves SET ultimo_uso_em = now() WHERE id = k.id;

  IF _modo = 'teste' THEN
    -- P-82 A: só EXEMPLOS; não chama _integracao_confirmar; registrado como teste e contou no limite
    v_ex := public._integracao_exemplo(v_cfg.campos, coalesce(v_pag, 1));
    v_cols := public._integracao_colunas(v_cfg.campos);
    SELECT coalesce(sum(jsonb_array_length(p.x -> 'linhas')), 0) INTO v_linhas FROM jsonb_array_elements(v_ex -> 'produtos') AS p(x);
    UPDATE public.integracao_acessos
       SET status = 'teste', linhas = v_linhas, detalhe = jsonb_build_object('exemplos', jsonb_array_length(v_ex -> 'produtos')),
           concluido_em = now()
     WHERE id = v_acesso;
    RETURN jsonb_build_object('status', 'ok', 'modo', 'teste', 'acesso_id', v_acesso, 'chave_id', k.id, 'tenant_id', k.tenant_id,
      'loja', jsonb_build_object('id', k.tenant_id, 'nome', v_loja), 'colunas', v_cols -> 'rotulos',
      'chaves_colunas', v_cols -> 'chaves', 'produtos', v_ex -> 'produtos', 'proximo_cursor', v_ex -> 'proximo_cursor',
      'validade_foto_dias', v_cfg.validade_foto_dias,
      -- D39 (P-89 A): tamanho desta página (exemplo = 2 por página) + o máximo da loja HOJE
      'pagina', jsonb_build_object('limite', 2, 'maximo', v_cfg.max_por_pagina));
  END IF;

  -- D21: página por PRODUTO (um produto nunca é partido), keyset por integracao_produtos.id.
  -- revisão T6 #3 (Minor #3, re-review round 1 — a 1ª rodada NÃO fechou a janela: v_sel e v_prods ainda eram 2
  -- SELECTs/2 fotos separadas sob READ COMMITTED). Fix real desta rodada: TODA a página (seleção com keyset,
  -- corte do "tem mais", união de campos e jsonb_agg de linhas) roda numa ÚNICA instrução com CTEs — uma foto só.
  -- Isso fecha a janela A-B-A (voltar apaga linhas + marcar recria com a MESMA assinatura entre 2 statements
  -- separados não pode mais acontecer, pois não há 2 statements) SEM adicionar nenhuma trava nova (nenhum FOR
  -- SHARE/FOR UPDATE em integracao_produtos aqui — evita qualquer necessidade de reanalisar ordem de lock contra
  -- marcar/voltar/desfazer e os gatilhos do espelho). `pedidos` (a reserva/contagem no acesso) é derivado do
  -- MESMO resultado (agg_pagina.n), não de uma leitura à parte. Formato de saída idêntico ao de antes (mesmas
  -- chaves, mesma ordem por id, mesmo tipo de cada valor).
  v_lim := least(greatest(coalesce(_limite, v_cfg.max_por_pagina), 1), v_cfg.max_por_pagina);
  WITH pagina AS (
    SELECT ip.id, ip.modelo_id, ip.estado, ip.assinatura, ip.integrado_em, ip.campos
      FROM public.integracao_produtos ip
     WHERE ip.tenant_id = k.tenant_id
       AND (ip.estado = 'integravel' OR (coalesce(_incluir_integrados, false) AND ip.estado = 'integrado'))
       AND (v_depois IS NULL OR ip.id > v_depois)
     ORDER BY ip.id
     LIMIT v_lim + 1
  ), pagina_trim AS (
    SELECT p.*, count(*) OVER () AS n_total
      FROM pagina p
     ORDER BY p.id
     LIMIT v_lim
  ), campos_uniao AS (
    SELECT ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                  WHERE EXISTS (SELECT 1 FROM pagina_trim pt WHERE u.x = ANY(pt.campos))
                  ORDER BY u.n) AS campos
  ), com_linhas AS (
    SELECT pt.id, pt.modelo_id, pt.estado, pt.assinatura, pt.integrado_em, pt.n_total,
           coalesce(ln.linhas, '[]'::jsonb) AS linhas
      FROM pagina_trim pt
      CROSS JOIN campos_uniao cu
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('tipo', l.tipo, 'loja_nome', l.loja_nome,
                 'valores', public._integracao_valores(l, cu.campos, pt.campos)) ORDER BY l.ordem) AS linhas
          FROM public.integracao_linhas l
         WHERE l.modelo_id = pt.modelo_id) ln ON true
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('modelo_id', cl.modelo_id, 'estado', cl.estado,
                                               'assinatura', cl.assinatura, 'integrado_em', cl.integrado_em,
                                               'linhas', cl.linhas) ORDER BY cl.id), '[]'::jsonb),
         coalesce(max(cl.n_total), 0) > v_lim, coalesce(count(*), 0),
         (array_agg(cl.id ORDER BY cl.id DESC))[1],
         coalesce((SELECT cu.campos FROM campos_uniao cu), '{}'::text[])
    INTO v_prods, v_mais, v_pedidos, v_ultimo_id, v_campos
    FROM com_linhas cl;
  v_cols := public._integracao_colunas(v_campos);
  UPDATE public.integracao_acessos SET detalhe = jsonb_build_object('pedidos', v_pedidos) WHERE id = v_acesso;
  RETURN jsonb_build_object('status', 'ok', 'modo', 'normal', 'acesso_id', v_acesso, 'chave_id', k.id, 'tenant_id', k.tenant_id,
    'loja', jsonb_build_object('id', k.tenant_id, 'nome', v_loja), 'colunas', v_cols -> 'rotulos',
    'chaves_colunas', v_cols -> 'chaves', 'produtos', v_prods,
    'proximo_cursor', CASE WHEN v_mais AND v_ultimo_id IS NOT NULL
      THEN to_jsonb(encode(convert_to(jsonb_build_object('depois', v_ultimo_id)::text, 'UTF8'), 'base64'))
      ELSE 'null'::jsonb END,
    'validade_foto_dias', v_cfg.validade_foto_dias,
    -- D39 (P-89 A): o programa do dev se ajusta sozinho se a loja mudar o "Máximo de produtos por página"
    'pagina', jsonb_build_object('limite', v_lim, 'maximo', v_cfg.max_por_pagina));
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_confirmar(_chave_id uuid, _acesso_id uuid, _entrega jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k public.integracao_chaves%ROWTYPE;
  v_ativo boolean;
  v_ids uuid[];
  v_conf jsonb := '[]'::jsonb;
  v_conf_ids uuid[] := '{}'::uuid[];
  v_novos integer := 0;
  v_relidos integer := 0;
  v_agora timestamptz := now();
  v_acesso_ok boolean;
  r record;
BEGIN
  -- nota 9: reconfere a chave e a loja de cada produto (a entrega é a 2ª fase INTERNA da rota, não um ack do ERP)
  SELECT * INTO k FROM public.integracao_chaves WHERE id = _chave_id;
  IF NOT FOUND OR k.revogada_em IS NOT NULL THEN
    -- revisão T6 #4 (Minor #4) + re-review round 1 (residual): filtra por chave_id E status = 'reservado' também
    -- aqui — sem isso, um _acesso_id de OUTRA chave (ou agregado, chave_id NULL) seria fechado por engano quando
    -- _chave_id não bate mais (chave revogada no meio), e um RETRY depois de a chave já ter sido revogada (mas o
    -- acesso já estava 'ok' de uma 1ª confirmação bem-sucedida) reescreveria esse 'ok' pra 'chave_invalida'.
    UPDATE public.integracao_acessos SET status = 'chave_invalida', concluido_em = now()
     WHERE id = _acesso_id AND chave_id = _chave_id AND status = 'reservado';
    RETURN jsonb_build_object('status', 'chave_invalida', 'confirmados', '[]'::jsonb);
  END IF;
  SELECT t.ativo INTO v_ativo FROM public.tenants t WHERE t.id = k.tenant_id;
  IF NOT coalesce(v_ativo, false) THEN
    -- re-review round 1 (residual do #4): idem — só rebaixa um acesso ainda RESERVADO; um retry depois da loja
    -- ficar inativa não reescreve um acesso já 'ok'. produtos_entregues/detalhe permanecem intocados nos 2 casos.
    UPDATE public.integracao_acessos SET status = 'loja_inativa', concluido_em = now()
     WHERE id = _acesso_id AND chave_id = k.id AND status = 'reservado';
    RETURN jsonb_build_object('status', 'loja_inativa', 'confirmados', '[]'::jsonb);
  END IF;
  -- revisão T6 #4 (Minor #4): só fecha um acesso que ainda está RESERVADO (fase 1 concluída, aguardando a fase 2) e é
  -- modo 'normal' da MESMA chave — trava a linha FOR UPDATE para não competir com outra confirmação da mesma reserva.
  -- Uma chamada retry (já 'ok'), um acesso em modo 'teste' (nunca chama confirmar) ou de outra chave não confirmam
  -- nada e devolvem parametro_invalido, sem reescrever produtos_entregues/detalhe nem RAISE 22P02 num id de exemplo.
  SELECT true INTO v_acesso_ok FROM public.integracao_acessos a
   WHERE a.id = _acesso_id AND a.chave_id = _chave_id AND a.status = 'reservado' AND a.modo = 'normal'
   FOR UPDATE;
  IF NOT coalesce(v_acesso_ok, false) THEN
    RETURN jsonb_build_object('status', 'parametro_invalido', 'confirmados', '[]'::jsonb);
  END IF;
  -- ruling do controlador, G-migration fix 1 #G5 (B-M6): modelo_id de _entrega validado com a MESMA regex de uuid
  -- balanceada da T7 (integracao_marcar/integracao_salvar) ANTES do ::uuid abaixo — sem isso, um modelo_id sem
  -- cara de uuid vindo da rota estourava 22P02 cru (HTTP 500) em vez de seguir o contrato de erro da função
  -- (parametro_invalido, o mesmo já usado 2 linhas acima para um acesso/chave que não bate).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_entrega -> 'produtos', '[]'::jsonb)) AS e(x)
              WHERE jsonb_typeof(e.x -> 'modelo_id') IS DISTINCT FROM 'string'
                 OR NOT (e.x ->> 'modelo_id' ~* '^(\{[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}|[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$')) THEN
    RETURN jsonb_build_object('status', 'parametro_invalido', 'confirmados', '[]'::jsonb);
  END IF;
  v_ids := ARRAY(SELECT DISTINCT (e.x ->> 'modelo_id')::uuid
                   FROM jsonb_array_elements(coalesce(_entrega -> 'produtos', '[]'::jsonb)) AS e(x) ORDER BY 1);
  PERFORM 1 FROM public.integracao_produtos ip
   WHERE ip.modelo_id = ANY(v_ids) AND ip.tenant_id = k.tenant_id ORDER BY ip.modelo_id FOR UPDATE;
  FOR r IN
    SELECT DISTINCT ON (ip.modelo_id) ip.id, ip.modelo_id, ip.estado, ip.assinatura, ip.integrado_em, e.x ->> 'assinatura' AS ass
      FROM jsonb_array_elements(coalesce(_entrega -> 'produtos', '[]'::jsonb)) AS e(x)
      JOIN public.integracao_produtos ip ON ip.modelo_id = (e.x ->> 'modelo_id')::uuid AND ip.tenant_id = k.tenant_id
     ORDER BY ip.modelo_id
  LOOP
    IF r.estado = 'integravel' AND r.assinatura = r.ass THEN
      UPDATE public.integracao_produtos
         SET estado = 'integrado', integrado_em = v_agora, integrado_chave_id = k.id, rev = rev + 1, atualizado_em = now()
       WHERE id = r.id;
      UPDATE public.integracao_linhas SET integrado_em = v_agora WHERE modelo_id = r.modelo_id;
      PERFORM public._integracao_logar(k.tenant_id, 'integrado', r.modelo_id,
        jsonb_build_object('chave', k.nome, 'final', k.final, 'acesso_id', _acesso_id),
        format('Chave "%s" ····%s', k.nome, k.final));
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('modelo_id', r.modelo_id, 'integrado_em', v_agora));
      v_conf_ids := v_conf_ids || r.modelo_id;
      v_novos := v_novos + 1;
    ELSIF r.estado = 'integrado' AND r.assinatura = r.ass THEN
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('modelo_id', r.modelo_id, 'integrado_em', r.integrado_em));
      v_conf_ids := v_conf_ids || r.modelo_id;
      v_relidos := v_relidos + 1;
    END IF;
  END LOOP;
  UPDATE public.integracao_acessos
     SET status = 'ok', produtos_entregues = v_novos + v_relidos,
         linhas = (SELECT count(*) FROM public.integracao_linhas l WHERE l.modelo_id = ANY(v_conf_ids)),
         detalhe = detalhe || jsonb_build_object('novos', v_novos, 'relidos', v_relidos,
                     'fotos_descartadas', coalesce((_entrega ->> 'fotos_descartadas')::integer, 0),
                     'fotos_ausentes', coalesce((_entrega ->> 'fotos_ausentes')::integer, 0)),
         concluido_em = now()
   WHERE id = _acesso_id AND chave_id = k.id;
  RETURN jsonb_build_object('status', 'ok', 'confirmados', v_conf);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_limpar(_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- n4/D20: ≤ 500 linhas por chamada, SÓ da loja pedida (NULL = as agregadas sem loja), SÓ quem NÃO entregou produto.
  -- revisão T6 #2 (Important #2): o predicado antigo de igualdade nula-segura para _tenant não era indexável — 2
  -- ramos ESTÁTICOS (tenant_id = _tenant OU tenant_id IS NULL) usam o índice idx_integracao_acessos_tenant
  -- (tenant_id, criado_em DESC); a rota chama isto a cada request (todo tráfego de chave errada cai no ramo NULL),
  -- então um seq scan crescente era custo por-request.
  IF _tenant IS NULL THEN
    WITH alvo AS (
      SELECT a.id FROM public.integracao_acessos a
       WHERE a.tenant_id IS NULL AND a.criado_em < now() - interval '90 days' AND a.produtos_entregues = 0
       ORDER BY a.criado_em
       LIMIT 500)
    DELETE FROM public.integracao_acessos a USING alvo WHERE a.id = alvo.id;
  ELSE
    WITH alvo AS (
      SELECT a.id FROM public.integracao_acessos a
       WHERE a.tenant_id = _tenant AND a.criado_em < now() - interval '90 days' AND a.produtos_entregues = 0
       ORDER BY a.criado_em
       LIMIT 500)
    DELETE FROM public.integracao_acessos a USING alvo WHERE a.id = alvo.id;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_colunas(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_exemplo(text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_valores(public.integracao_linhas, text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_ler(text, boolean, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_confirmar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_limpar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._integracao_ler(text, boolean, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._integracao_confirmar(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._integracao_limpar(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.integracao_salvar_config(text[], integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_salvar_config_api(jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_chaves_listar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_chave_criar(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_chave_revogar(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_acessos_listar(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_exemplo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_salvar_config(text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_salvar_config_api(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_chaves_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_chave_criar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_chave_revogar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_acessos_listar(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_exemplo() TO authenticated;

DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._integracao_ler(text,boolean,text,integer,text,text)', 'public._integracao_confirmar(uuid,uuid,jsonb)',
                            'public._integracao_limpar(uuid)'] LOOP
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_6: ACL da rota errada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ruling do controlador, G-migration fix 1 #G9 (A-M4 + B-M5): faltava conferir `anon` nos 3 helpers internos
  -- (mesma classe do Minor #5 da T4 — o default ACL do Postgres concede EXECUTE em função nova a anon direto;
  -- authenticated/public sozinhos não fecham o invariante 9).
  FOREACH f IN ARRAY ARRAY['public._integracao_colunas(text[])', 'public._integracao_exemplo(text[],integer)',
                            'public._integracao_valores(public.integracao_linhas,text[],text[])'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_6: % executavel (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

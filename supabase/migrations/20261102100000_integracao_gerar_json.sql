-- Integração › Produtos › "Gerar JSON" (entrega MANUAL = integração; dono 04/out). Plano
-- .superpowers/sdd/2026-10-04-gerar-json/plan.md (§3 T1; os RULINGS do §8 PREVALECEM — Q4: teto = MENOR entre 100 e o
-- "Máximo de produtos por página" da loja; Q6: `pagina: {limite, maximo: teto}` + `proximo_cursor: null`, mesmo formato da API).
-- O que muda (SÓ isto; NENHUMA função existente é redefinida — `_integracao_ler` md5 1ac58b34 encadeado segue intocada):
--   • CHECK integracao_acessos_modo_chk ampliado para ('normal','teste','manual') (D4; precedente: status ampliado na A2).
--     AccessExclusive em integracao_acessos por um instante (tabela pequena — limpeza de 90 dias); lock_timeout 1500 ms.
--   • public.integracao_gerar_json_ler(_modelo_ids uuid[], _loja uuid) — NOVA, fase 1. SECURITY DEFINER, search_path=public,
--     `_integracao_exige(true)` (P-107 A: super admin ou quem ELE deu `integracao` editar; NÃO `_seg_exige_pagina`, em que admin
--     fura). `_loja` = loja ativa (senão P0001 gerar_json_loja_mudou:); 1..teto ids sem repetir e sem NULL (gerar_json_itens:);
--     todos da loja ativa (gerar_json_loja:, sem reservar nada); limite por minuto da loja contado SÓ sobre as gerações
--     manuais (gerar_json_limite:). Classifica: integrável não reprovado e integrado entram; não integrável/sem linha
--     ('nao_integravel'), integrável reprovado ('reprovado') e retrato com preco_custo para quem não vê custos ('sem_custo',
--     P-75 A por produto) ficam no `fora`. Página = ESPELHO da CTE de `_integracao_ler` (mesmas auxiliares
--     `_integracao_layout/_valores/_colunas`), trocando só a seleção (lista de ids em vez de keyset). Reserva em
--     integracao_acessos (modo 'manual', chave_id NULL, detalhe.usuario_id/quem/pedidos/produtos). Sem elegível: não reserva.
--   • public.integracao_gerar_json_confirmar(_acesso_id uuid, _entrega jsonb) — NOVA, fase 2 (espelho de
--     `_integracao_confirmar`): só a reserva manual da MESMA loja, do MESMO usuário, ainda 'reservado' e com < 10 min; só os ids
--     reservados; mesma assinatura. Integrável → integrado (integrado_chave_id NULL = manual; Log 'integrado' com a PESSOA,
--     detalhe {manual, acesso_id, novo}); integrado → reexportação (nada muda; Log 'integrado' {manual, acesso_id,
--     reexportacao}); P-75 A conferida de novo. Nenhuma escrita em `modelos` (nenhuma GUC da S1/S2 em jogo).
--   • public._integracao_gerar_json_teto(_tenant uuid) — NOVA, auxiliar INTERNA (sql STABLE, search_path=public, EXECUTE
--     revogado dos 3 — inv. 9): FONTE ÚNICA do teto = least(100, `_integracao_cfg(_tenant).max_por_pagina`) (Ruling Q4). O
--     `integracao_gerar_json_ler` e a RPC abaixo chamam ESTA função (não podem divergir).
--   • public.integracao_gerar_json_teto() — NOVA (fix round 2 / review T2 I1): o teto da loja ATIVA para a tela de TODOS que
--     VEEM a Integração (`_integracao_exige(false)`: super admin ou quem ELE deu `integracao` ver/editar — P-107 A; admin da loja
--     não passa sozinho). STABLE, SECURITY DEFINER, search_path=public. Não é dado sensível. `integracao_config_ler` NÃO muda.
--   • ACL: EXECUTE das 3 RPCs só para authenticated (REVOKE de PUBLIC/anon — inv. 9; risco residual aceito no plano §0).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.integracao_gerar_json_ler(uuid[],uuid)          NOVA 5ba46a17792ddaba7a6e13e1cb1a101d
--     (aceita tambem 4b96da8c8d2b529d4fbcf99e52c1dc9f = neutralizada pelo _down, e 7a76ace85f5620dbec943c34a3890e4c /
--      4cb3ccc80a10701e66d0ce9fb1e585ad = textos das rodadas 0/1 da T1, que so existiram na copia local - reaplicar a ida por
--      cima deles os substitui)
--   public.integracao_gerar_json_confirmar(uuid,jsonb)     NOVA e53973ef946a10dded322143f036508d
--     (aceita tambem 78ccc308fdfc2456b2fee148d0c61287 = neutralizada pelo _down)
--   public.integracao_gerar_json_teto()                    NOVA 30f17a039fe5bbfba9b23752e5946adf
--     (aceita tambem 70f3950776d0c28f0dbf7c59b2240a21 = neutralizada pelo _down)
--   public._integracao_gerar_json_teto(uuid)               NOVA ee92e7f38ba221f774f70a1addc2ad23 (o _down nao a toca; inerte)
--   dep (intocadas — o corpo novo espelha/chama estas):
--     public._integracao_ler(text,boolean,text,integer,text,text)      1ac58b343e992fefe0062dac512e11eb
--     public._integracao_confirmar(uuid,uuid,jsonb)                     ede617dcdca6fb562a63ed06c31b9914
--     public._integracao_valores(integracao_linhas,text[],text[])       7d094ada6982728a4dfdc96077d51367
--     public._integracao_colunas(text[])                                6bc153aa8d1c205a927ed19b29c7dcda
--     public._integracao_cfg(uuid)                                      db865044a6b9f875c8c920b82f6b9974
--     public._integracao_exige(boolean)                                 8b908a5cf45d86e636a31f6284c5193e
--     public._integracao_logar(uuid,text,uuid,jsonb,text)               52b347ee02742906c19765c46e8cfec4
--     public._integracao_quem()                                         e5acdaffc65808965e4b295ae53406f2
--     public._pode_ver_custos()                                         dec16016064c55ab101c67e82e715681
-- ====================================================================================
-- Sem DROP, sem gatilho, sem policy, sem tocar auth/storage. Idempotente (a guarda aceita antes OU depois OU a volta parcial).
-- Banco ANTES do site: site velho + banco novo = ok (ninguém chama as RPCs novas); site novo + banco velho = o botão falha com
-- mensagem (PGRST202) e nada é integrado (a fase 1 não roda).
-- Volta (LIFO): SITE primeiro; depois supabase/rollback/20261102100000_integracao_gerar_json_down.sql (NEUTRALIZA as 3 RPCs — CREATE
-- OR REPLACE, sem trava de tabela; o CHECK ampliado fica, inerte) e, opcional/separado/horário calmo,
-- supabase/rollback/20261102100000_integracao_gerar_json_down_drop.sql (apaga os acessos 'manual' com confirmação, volta o
-- CHECK, DROP das 4 funções). É o 1º da LIFO: este _down roda PRIMEIRO, antes de toda a cadeia S2..S6 (20261101250000_down → …) —
-- não há dependência técnica com ela (nenhuma S redefine as 9 dependências), é só a ordem inversa da aplicação; e ANTES dos
-- inversos da A2 (20261030130000) e da volta de emergência da Integração (volta-producao.sh: incluir este _down/_down_drop
-- no início; sem eles o DROP TABLE de integracao_acessos deixa as 2 RPCs órfãs, 42883 ao chamar). Produto
-- integrado manualmente SEGUE integrado depois da volta (o Desfazer do super admin é o caminho por produto).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- 55P03/40P01 = rodar o arquivo de novo.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
  v_chk text;
  d record;
BEGIN
  IF to_regclass('public.integracao_acessos') IS NULL OR to_regclass('public.integracao_produtos') IS NULL
     OR to_regclass('public.integracao_linhas') IS NULL OR to_regclass('public.integracao_log') IS NULL THEN
    RAISE EXCEPTION 'gerar_json: tabelas da Integracao ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'gerar_json: exige a Release A2 (_integracao_ler_loja ausente)' USING ERRCODE = 'P0001';
  END IF;
  FOR d IN
    SELECT * FROM (VALUES
      ('public._integracao_ler(text,boolean,text,integer,text,text)', '1ac58b343e992fefe0062dac512e11eb'),
      ('public._integracao_confirmar(uuid,uuid,jsonb)', 'ede617dcdca6fb562a63ed06c31b9914'),
      ('public._integracao_valores(integracao_linhas,text[],text[])', '7d094ada6982728a4dfdc96077d51367'),
      ('public._integracao_colunas(text[])', '6bc153aa8d1c205a927ed19b29c7dcda'),
      ('public._integracao_cfg(uuid)', 'db865044a6b9f875c8c920b82f6b9974'),
      ('public._integracao_exige(boolean)', '8b908a5cf45d86e636a31f6284c5193e'),
      ('public._integracao_logar(uuid,text,uuid,jsonb,text)', '52b347ee02742906c19765c46e8cfec4'),
      ('public._integracao_quem()', 'e5acdaffc65808965e4b295ae53406f2'),
      ('public._pode_ver_custos()', 'dec16016064c55ab101c67e82e715681')) AS t(f, m)
  LOOP
    v := md5(pg_get_functiondef(to_regprocedure(d.f)));
    IF v IS DISTINCT FROM d.m THEN
      RAISE EXCEPTION 'gerar_json: dependencia % com texto inesperado (md5 %) - refazer o plano', d.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_gerar_json_ler(uuid[],uuid)')));
  -- 7a76ace8/4cb3ccc8 = textos das rodadas 0/1 da T1 (so na copia local; fix rounds 1 e 2 trocaram o texto)
  IF v IS NOT NULL AND v NOT IN ('5ba46a17792ddaba7a6e13e1cb1a101d', '4b96da8c8d2b529d4fbcf99e52c1dc9f', '7a76ace85f5620dbec943c34a3890e4c',
                                  '4cb3ccc80a10701e66d0ce9fb1e585ad') THEN
    RAISE EXCEPTION 'gerar_json: public.integracao_gerar_json_ler ja existe com outro texto (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_gerar_json_confirmar(uuid,jsonb)')));
  IF v IS NOT NULL AND v NOT IN ('e53973ef946a10dded322143f036508d', '78ccc308fdfc2456b2fee148d0c61287') THEN
    RAISE EXCEPTION 'gerar_json: public.integracao_gerar_json_confirmar ja existe com outro texto (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_gerar_json_teto()')));
  IF v IS NOT NULL AND v NOT IN ('30f17a039fe5bbfba9b23752e5946adf', '70f3950776d0c28f0dbf7c59b2240a21') THEN
    RAISE EXCEPTION 'gerar_json: public.integracao_gerar_json_teto ja existe com outro texto (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._integracao_gerar_json_teto(uuid)')));
  IF v IS NOT NULL AND v <> 'ee92e7f38ba221f774f70a1addc2ad23' THEN
    RAISE EXCEPTION 'gerar_json: public._integracao_gerar_json_teto ja existe com outro texto (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_chk FROM pg_constraint c
   WHERE c.conrelid = 'public.integracao_acessos'::regclass AND c.conname = 'integracao_acessos_modo_chk';
  IF v_chk IS DISTINCT FROM 'CHECK ((modo = ANY (ARRAY[''normal''::text, ''teste''::text])))'
     AND v_chk IS DISTINCT FROM 'CHECK ((modo = ANY (ARRAY[''normal''::text, ''teste''::text, ''manual''::text])))' THEN
    RAISE EXCEPTION 'gerar_json: CHECK integracao_acessos_modo_chk inesperado: %', coalesce(v_chk, 'ausente') USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER TABLE public.integracao_acessos DROP CONSTRAINT IF EXISTS integracao_acessos_modo_chk;
ALTER TABLE public.integracao_acessos ADD CONSTRAINT integracao_acessos_modo_chk CHECK (modo IN ('normal', 'teste', 'manual'));

CREATE OR REPLACE FUNCTION public._integracao_gerar_json_teto(_tenant uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- FONTE UNICA do teto do Gerar JSON (Ruling Q4): menor entre 100 e o maximo de produtos por pagina da loja (P-89 A).
  -- Usada por integracao_gerar_json_ler (recusa acima) e por integracao_gerar_json_teto (tela) - nao podem divergir.
  SELECT least(100, (public._integracao_cfg(_tenant)).max_por_pagina)
$function$;

CREATE OR REPLACE FUNCTION public.integracao_gerar_json_ler(_modelo_ids uuid[], _loja uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_cfg public.integracao_config;
  v_teto integer;
  v_ids uuid[];
  v_ver boolean;
  v_loja text;
  v_usadas integer;
  v_mais_velho timestamptz;
  v_entram uuid[];
  v_fora jsonb;
  v_prods jsonb := '[]'::jsonb;
  v_pagina_ids uuid[];
  v_campos text[];
  v_cols jsonb;
  v_acesso uuid;
BEGIN
  -- Gerar JSON, fase 1 (plano 2026-10-04-gerar-json). D7: _integracao_exige(true) (P-107 A), NAO _seg_exige_pagina.
  IF _loja IS NULL OR _loja <> v_tenant THEN
    RAISE EXCEPTION 'gerar_json_loja_mudou: loja ativa diferente' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);
  -- Ruling Q4: teto = MENOR entre 100 e o maximo de produtos por pagina da loja (P-89 A) - fonte unica compartilhada
  v_teto := public._integracao_gerar_json_teto(v_tenant);
  IF _modelo_ids IS NULL OR coalesce(array_ndims(_modelo_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'gerar_json_itens: envie de 1 a % produtos', v_teto USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(_modelo_ids) > v_teto OR array_position(_modelo_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'gerar_json_itens: envie de 1 a % produtos', v_teto USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(DISTINCT u.x) FROM unnest(_modelo_ids) AS u(x)) <> cardinality(_modelo_ids) THEN
    RAISE EXCEPTION 'gerar_json_itens: produto repetido' USING ERRCODE = 'P0001';
  END IF;
  v_ids := ARRAY(SELECT u.x FROM unnest(_modelo_ids) AS u(x) ORDER BY 1);
  -- todos da loja ativa (sem reservar nada e sem revelar nome)
  IF (SELECT count(*) FROM public.modelos m WHERE m.id = ANY(v_ids) AND m.tenant_id = v_tenant) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'gerar_json_loja: produto nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
  v_ver := public._pode_ver_custos();
  SELECT t.nome INTO v_loja FROM public.tenants t WHERE t.id = v_tenant;
  -- D9: limite por minuto da loja, contado SO sobre as geracoes MANUAIS (chave_id NULL: nao consome o limite da chave do ERP)
  PERFORM pg_advisory_xact_lock(hashtextextended('integracao_manual:' || v_tenant::text, 0));
  SELECT count(*), min(a.criado_em) INTO v_usadas, v_mais_velho FROM public.integracao_acessos a
   WHERE a.tenant_id = v_tenant AND a.modo = 'manual' AND a.agregado IS NULL AND a.criado_em > now() - interval '60 seconds';
  IF v_usadas >= v_cfg.limite_por_minuto THEN
    RAISE EXCEPTION 'gerar_json_limite: aguarde % s',
      greatest(1, ceil(extract(epoch FROM (v_mais_velho + interval '60 seconds' - now())))::integer) USING ERRCODE = 'P0001';
  END IF;
  -- D1/D2/D6: classificacao (MESMA expressao de reprovado do _integracao_ler; integrado reprovado CONTINUA entrando)
  WITH cl AS (
    SELECT m.id, m.nome, m.ref,
           CASE WHEN coalesce(ip.estado, 'nao_integravel') = 'nao_integravel' THEN 'nao_integravel'
                WHEN ip.estado = 'integravel'
                     AND (coalesce(m.status_planejamento, '') = 'reprovado'
                          OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado') THEN 'reprovado'
                WHEN 'preco_custo' = ANY(ip.campos) AND NOT v_ver THEN 'sem_custo'
           END AS motivo
      FROM public.modelos m
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id AND ip.tenant_id = v_tenant
     WHERE m.id = ANY(v_ids) AND m.tenant_id = v_tenant
  )
  SELECT coalesce(array_agg(cl.id ORDER BY cl.id) FILTER (WHERE cl.motivo IS NULL), '{}'::uuid[]),
         jsonb_agg(jsonb_build_object('modelo_id', cl.id, 'nome', cl.nome, 'ref', cl.ref, 'motivo', cl.motivo)
                   ORDER BY cl.nome, cl.id) FILTER (WHERE cl.motivo IS NOT NULL)
    INTO v_entram, v_fora
    FROM cl;
  -- ESPELHO de _integracao_ler (1ac58b34): mudar la => mudar aqui (anti-drift: integracao-11-gerar-json.test.ts)
  -- Troca SO a selecao (`pagina`): lista de ids em vez de keyset (sem LIMIT/pagina_trim/n_total). O estado, o reprovado (mesma
  -- expressao/JOIN do _integracao_ler) e o custo sao reconferidos NA MESMA FOTO da pagina: quem mudou entre a classificacao e
  -- aqui (voltou, desfeito, reprovado) nao sai no arquivo - vai para o `fora` como 'mudou' logo abaixo.
  WITH pagina AS (
    SELECT ip.id, ip.modelo_id, ip.estado, ip.assinatura, ip.integrado_em, ip.campos
      FROM public.integracao_produtos ip
      JOIN public.modelos m ON m.id = ip.modelo_id
     WHERE ip.tenant_id = v_tenant
       AND ip.modelo_id = ANY(v_entram)
       AND ip.estado IN ('integravel', 'integrado')
       AND NOT (ip.estado = 'integravel'
                AND (coalesce(m.status_planejamento, '') = 'reprovado'
                     OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado'))
       AND NOT ('preco_custo' = ANY(ip.campos) AND NOT v_ver)
  ), campos_uniao AS (
    SELECT ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                  WHERE EXISTS (SELECT 1 FROM pagina pt WHERE u.x = ANY(pt.campos))
                  ORDER BY u.n) AS campos
  ), com_linhas AS (
    SELECT pt.id, pt.modelo_id, pt.estado, pt.assinatura, pt.integrado_em,
           coalesce(ln.linhas, '[]'::jsonb) AS linhas
      FROM pagina pt
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
         coalesce(array_agg(cl.modelo_id ORDER BY cl.modelo_id), '{}'::uuid[]),
         coalesce((SELECT cu.campos FROM campos_uniao cu), '{}'::text[])
    INTO v_prods, v_pagina_ids, v_campos
    FROM com_linhas cl;
  IF cardinality(v_pagina_ids) < cardinality(v_entram) THEN
    SELECT coalesce(v_fora, '[]'::jsonb)
           || coalesce(jsonb_agg(jsonb_build_object('modelo_id', m.id, 'nome', m.nome, 'ref', m.ref, 'motivo', 'mudou')
                                 ORDER BY m.nome, m.id), '[]'::jsonb)
      INTO v_fora
      FROM public.modelos m
     WHERE m.id = ANY(v_entram) AND NOT (m.id = ANY(v_pagina_ids));
    v_entram := v_pagina_ids;
  END IF;
  IF cardinality(v_entram) = 0 THEN
    -- nenhum elegivel: NAO grava acesso
    RETURN jsonb_build_object('status', 'ok', 'modo', 'manual', 'acesso_id', NULL, 'chave_id', NULL, 'tenant_id', v_tenant,
      'loja', jsonb_build_object('id', v_tenant, 'nome', v_loja), 'colunas', '[]'::jsonb, 'chaves_colunas', '[]'::jsonb,
      'produtos', '[]'::jsonb, 'proximo_cursor', NULL, 'validade_foto_dias', v_cfg.validade_foto_dias,
      'pagina', jsonb_build_object('limite', 0, 'maximo', v_teto), 'fora', coalesce(v_fora, '[]'::jsonb));
  END IF;
  -- reserva (D10): so a MESMA loja e o MESMO usuario confirmam, so estes ids, em ate 10 min
  INSERT INTO public.integracao_acessos (tenant_id, chave_id, ip, modo, status, detalhe)
  VALUES (v_tenant, NULL, NULL, 'manual', 'reservado',
          jsonb_build_object('usuario_id', auth.uid(), 'quem', public._integracao_quem(),
                             'pedidos', cardinality(v_entram), 'produtos', to_jsonb(v_entram)))
  RETURNING id INTO v_acesso;
  v_cols := public._integracao_colunas(v_campos);
  RETURN jsonb_build_object('status', 'ok', 'modo', 'manual', 'acesso_id', v_acesso, 'chave_id', NULL, 'tenant_id', v_tenant,
    'loja', jsonb_build_object('id', v_tenant, 'nome', v_loja), 'colunas', v_cols -> 'rotulos',
    'chaves_colunas', v_cols -> 'chaves', 'produtos', v_prods, 'proximo_cursor', NULL,
    'validade_foto_dias', v_cfg.validade_foto_dias,
    -- Ruling Q6: mesmo formato da API (limite = produtos desta geracao; maximo = teto)
    'pagina', jsonb_build_object('limite', cardinality(v_entram), 'maximo', v_teto),
    'fora', coalesce(v_fora, '[]'::jsonb));
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_gerar_json_confirmar(_acesso_id uuid, _entrega jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_ver boolean := public._pode_ver_custos();
  v_reserva public.integracao_acessos%ROWTYPE;
  v_reservados uuid[];
  v_produtos jsonb;
  v_ids uuid[];
  v_conf jsonb := '[]'::jsonb;
  v_conf_ids uuid[] := '{}'::uuid[];
  v_novos integer := 0;
  v_relidos integer := 0;
  v_agora timestamptz := now();
  v_desc integer;
  v_aus integer;
  r record;
BEGIN
  -- Gerar JSON, fase 2 (ESPELHO de _integracao_confirmar). So a reserva MANUAL desta loja, deste usuario, ainda reservada e
  -- com menos de 10 min (pega retry, reserva de outro usuario/loja, de chave da API e reserva velha).
  SELECT * INTO v_reserva FROM public.integracao_acessos a
   WHERE a.id = _acesso_id AND a.tenant_id = v_tenant AND a.chave_id IS NULL AND a.modo = 'manual' AND a.status = 'reservado'
     AND a.detalhe ->> 'usuario_id' = auth.uid()::text AND a.criado_em > now() - interval '10 minutes'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'parametro_invalido', 'confirmados', '[]'::jsonb);
  END IF;
  -- mesma validacao do _integracao_confirmar (sem 22P02/22023 cru); _entrega tem de ser objeto
  IF _entrega IS NULL OR jsonb_typeof(_entrega) <> 'object'
     OR (_entrega ? 'produtos' AND jsonb_typeof(_entrega -> 'produtos') <> 'array') THEN
    RETURN jsonb_build_object('status', 'parametro_invalido', 'confirmados', '[]'::jsonb);
  END IF;
  v_produtos := coalesce(_entrega -> 'produtos', '[]'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_produtos) AS e(x)
              WHERE jsonb_typeof(e.x) IS DISTINCT FROM 'object'
                 OR jsonb_typeof(e.x -> 'modelo_id') IS DISTINCT FROM 'string'
                 OR NOT (e.x ->> 'modelo_id' ~* '^(\{[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}|[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$')) THEN
    RETURN jsonb_build_object('status', 'parametro_invalido', 'confirmados', '[]'::jsonb);
  END IF;
  -- contadores das fotos: so numero inteiro em faixa conta; o resto vira 0 (sem 22P02/22003 cru)
  v_desc := CASE WHEN jsonb_typeof(_entrega -> 'fotos_descartadas') = 'number'
                 THEN CASE WHEN (_entrega ->> 'fotos_descartadas')::numeric BETWEEN 0 AND 2147483647
                           THEN trunc((_entrega ->> 'fotos_descartadas')::numeric)::integer ELSE 0 END
                 ELSE 0 END;
  v_aus := CASE WHEN jsonb_typeof(_entrega -> 'fotos_ausentes') = 'number'
                THEN CASE WHEN (_entrega ->> 'fotos_ausentes')::numeric BETWEEN 0 AND 2147483647
                          THEN trunc((_entrega ->> 'fotos_ausentes')::numeric)::integer ELSE 0 END
                ELSE 0 END;
  -- so os ids RESERVADOS na fase 1 (entrega INTERSECAO reserva)
  v_reservados := ARRAY(SELECT t.x::uuid FROM jsonb_array_elements_text(coalesce(v_reserva.detalhe -> 'produtos', '[]'::jsonb)) AS t(x));
  v_ids := ARRAY(SELECT DISTINCT (e.x ->> 'modelo_id')::uuid
                   FROM jsonb_array_elements(v_produtos) AS e(x)
                  WHERE (e.x ->> 'modelo_id')::uuid = ANY(v_reservados)
                  ORDER BY 1);
  PERFORM 1 FROM public.integracao_produtos ip
   WHERE ip.modelo_id = ANY(v_ids) AND ip.tenant_id = v_tenant ORDER BY ip.modelo_id FOR UPDATE;
  FOR r IN
    SELECT DISTINCT ON (ip.modelo_id) ip.id, ip.modelo_id, ip.estado, ip.assinatura, ip.integrado_em, ip.campos,
           e.x ->> 'assinatura' AS ass
      FROM jsonb_array_elements(v_produtos) AS e(x)
      JOIN public.integracao_produtos ip ON ip.modelo_id = (e.x ->> 'modelo_id')::uuid AND ip.tenant_id = v_tenant
     WHERE ip.modelo_id = ANY(v_ids)
     ORDER BY ip.modelo_id
  LOOP
    -- P-75 A conferida de novo (a permissao de custo pode ter caido entre as fases)
    IF 'preco_custo' = ANY(r.campos) AND NOT v_ver THEN
      CONTINUE;
    END IF;
    IF r.estado = 'integravel' AND r.assinatura = r.ass THEN
      UPDATE public.integracao_produtos
         SET estado = 'integrado', integrado_em = v_agora, integrado_chave_id = NULL, rev = rev + 1, atualizado_em = now()
       WHERE id = r.id;
      UPDATE public.integracao_linhas SET integrado_em = v_agora WHERE modelo_id = r.modelo_id;
      PERFORM public._integracao_logar(v_tenant, 'integrado', r.modelo_id,
        jsonb_build_object('manual', true, 'acesso_id', _acesso_id, 'novo', true), NULL::text);
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('modelo_id', r.modelo_id, 'integrado_em', v_agora));
      v_conf_ids := v_conf_ids || r.modelo_id;
      v_novos := v_novos + 1;
    ELSIF r.estado = 'integrado' AND r.assinatura = r.ass THEN
      -- D3: reexportacao - nada muda (estado, integrado_em, rev, linhas); fica registrada no Log
      PERFORM public._integracao_logar(v_tenant, 'integrado', r.modelo_id,
        jsonb_build_object('manual', true, 'acesso_id', _acesso_id, 'reexportacao', true), NULL::text);
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('modelo_id', r.modelo_id, 'integrado_em', r.integrado_em));
      v_conf_ids := v_conf_ids || r.modelo_id;
      v_relidos := v_relidos + 1;
    END IF;
  END LOOP;
  UPDATE public.integracao_acessos
     SET status = 'ok', produtos_entregues = v_novos + v_relidos,
         linhas = (SELECT count(*) FROM public.integracao_linhas l WHERE l.modelo_id = ANY(v_conf_ids)),
         detalhe = detalhe || jsonb_build_object('novos', v_novos, 'relidos', v_relidos,
                     'fotos_descartadas', v_desc, 'fotos_ausentes', v_aus, 'confirmados', to_jsonb(v_conf_ids)),
         concluido_em = now()
   WHERE id = _acesso_id;
  RETURN jsonb_build_object('status', 'ok', 'confirmados', v_conf, 'novos', v_novos, 'relidos', v_relidos);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_gerar_json_teto()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Teto do Gerar JSON da loja ATIVA para a tela (fix round 2 / review T2 I1). Quem VE a Integracao (_integracao_exige(false):
  -- P-107 A). Mesma fonte do integracao_gerar_json_ler (_integracao_gerar_json_teto) - a tela nunca promete mais que o banco aceita.
  RETURN public._integracao_gerar_json_teto(public._integracao_exige(false));
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_gerar_json_teto(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_gerar_json_teto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_gerar_json_teto() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_gerar_json_ler(uuid[], uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_gerar_json_confirmar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_gerar_json_ler(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_gerar_json_confirmar(uuid, jsonb) TO authenticated;

DO $pos$
DECLARE
  d record;
  v text;
BEGIN
  FOR d IN
    SELECT * FROM (VALUES
      ('public.integracao_gerar_json_ler(uuid[],uuid)', '5ba46a17792ddaba7a6e13e1cb1a101d'),
      ('public.integracao_gerar_json_confirmar(uuid,jsonb)', 'e53973ef946a10dded322143f036508d'),
      ('public.integracao_gerar_json_teto()', '30f17a039fe5bbfba9b23752e5946adf')) AS t(f, m)
  LOOP
    v := md5(pg_get_functiondef(to_regprocedure(d.f)));
    IF v IS DISTINCT FROM d.m THEN
      RAISE EXCEPTION 'gerar_json: pos-condicao falhou em % (md5 %)', d.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(d.f))
       OR (SELECT p.proconfig FROM pg_proc p WHERE p.oid = to_regprocedure(d.f)) IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION 'gerar_json: % sem SECURITY DEFINER ou search_path=public', d.f USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', d.f, 'EXECUTE') OR NOT has_function_privilege('authenticated', d.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM aclexplode((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(d.f))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR (SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(d.f)) IS NULL THEN
      RAISE EXCEPTION 'gerar_json: ACL inesperada em % (authenticated sim; PUBLIC/anon nao - inv. 9)', d.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- auxiliar interna do teto: md5, sem EXECUTE para PUBLIC/anon/authenticated (inv. 9)
  IF md5(pg_get_functiondef(to_regprocedure('public._integracao_gerar_json_teto(uuid)'))) IS DISTINCT FROM 'ee92e7f38ba221f774f70a1addc2ad23' THEN
    RAISE EXCEPTION 'gerar_json: pos-condicao falhou em public._integracao_gerar_json_teto' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public._integracao_gerar_json_teto(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._integracao_gerar_json_teto(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode((SELECT p.proacl FROM pg_proc p
                 WHERE p.oid = to_regprocedure('public._integracao_gerar_json_teto(uuid)'))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR (SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure('public._integracao_gerar_json_teto(uuid)')) IS NULL THEN
    RAISE EXCEPTION 'gerar_json: ACL inesperada em public._integracao_gerar_json_teto (revogado dos 3 - inv. 9)' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.integracao_acessos'::regclass AND c.conname = 'integracao_acessos_modo_chk')
     IS DISTINCT FROM 'CHECK ((modo = ANY (ARRAY[''normal''::text, ''teste''::text, ''manual''::text])))' THEN
    RAISE EXCEPTION 'gerar_json: pos-condicao falhou no CHECK de modo de integracao_acessos' USING ERRCODE = 'P0001';
  END IF;
  FOR d IN
    SELECT * FROM (VALUES
      ('public._integracao_ler(text,boolean,text,integer,text,text)', '1ac58b343e992fefe0062dac512e11eb'),
      ('public._integracao_confirmar(uuid,uuid,jsonb)', 'ede617dcdca6fb562a63ed06c31b9914'),
      ('public._integracao_valores(integracao_linhas,text[],text[])', '7d094ada6982728a4dfdc96077d51367'),
      ('public._integracao_colunas(text[])', '6bc153aa8d1c205a927ed19b29c7dcda'),
      ('public._integracao_cfg(uuid)', 'db865044a6b9f875c8c920b82f6b9974'),
      ('public._integracao_exige(boolean)', '8b908a5cf45d86e636a31f6284c5193e'),
      ('public._integracao_logar(uuid,text,uuid,jsonb,text)', '52b347ee02742906c19765c46e8cfec4'),
      ('public._integracao_quem()', 'e5acdaffc65808965e4b295ae53406f2'),
      ('public._pode_ver_custos()', 'dec16016064c55ab101c67e82e715681')) AS t(f, m)
  LOOP
    IF md5(pg_get_functiondef(to_regprocedure(d.f))) IS DISTINCT FROM d.m THEN
      RAISE EXCEPTION 'gerar_json: dependencia % mudou (nao deveria)', d.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

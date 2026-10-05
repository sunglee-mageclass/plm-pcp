-- Urgentes R2 T10 - "Insumos padrao" da loja na CRIACAO do card interno (P-306 B: todos os jeitos de criar card interno).
-- GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a2.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-a.md (Task 10; R2; Rulings A10, A12, A14; A11 virou B pela P-306).
-- O que muda:
--   1) NOVA public._insumos_padrao_aplicar(uuid) RETURNS integer (helper interno; plpgsql, SECURITY DEFINER, search_path=public,
--      EXECUTE revogado de PUBLIC, anon, authenticated): le tenant_config.insumos_padrao da loja DO CARD, RE-VALIDA cada item (a
--      coluna pode ter sido gravada crua pelo admin da loja - ignora item sem forma, insumo de outra loja/apagado, consumo fora de
--      0..9999, par repetido; cor fora das variantes do insumo vira sem cor; no maximo 20 linhas) e grava as linhas em
--      modelo_etiquetas SO se o card e interno e ainda nao tem nenhuma. NUNCA derruba a criacao: erro vira WARNING (ASCII) e 0.
--   2) NOVA public.salvar_insumos_iniciais(uuid, jsonb) RETURNS integer (RPC do cliente; DEFINER; EXECUTE so authenticated e
--      service_role): login -> modulo Criacao -> pagina Planejamento OU Desenvolvimento -> card da loja (FOR UPDATE) -> so interno
--      -> so sem insumos -> valida a lista (<= 20; insumo/cor DA LOJA; consumo numero 0..9999, <= 4 casas; Perda % opcional
--      0..100, <= 2 casas, ausente = 0) e grava. Recusas: 42501
--      nao_autenticado:/modulo_desligado:/sem_permissao_pagina:, P0001 nao_encontrado: modelo / insumos_iniciais_so_interno: /
--      insumos_iniciais_ja_existem: / insumos_iniciais_invalidos: (ASCII; a tela traduz). Usada pelo "+ Novo" (Dialog) e pelo
--      "Criar varios cards" (front, tarefa propria).
--   3) _plan_tecido_criar_card_core (Plan. Tecido "Criar card" e "Criar cards" - o lote chama este core por vaga) e
--      importar_modelo_linha (Importar dados, so no ramo que CRIA o card) passam a chamar o helper logo depois de criar o card
--      (troca EXATA sobre o vivo, ancora 1x; ACL/DEFINER/search_path preservados).
--   NAO mudam (conferido): otb_confirmar/otb_confirmar_pv (so marcam a colecao; nao criam card desde 20260721100000), Duplicar/Nova
--   versao (INSERT do cliente; copiam da origem), Replicar (_replicar_cards_plan_tecido_core, _replicar_produtos_*), revenda e
--   importado (_criar_card_produto_*), criar_card_simulacao (simulador do OTB, tela removida).
-- Efeito: loja com lista vazia (todas hoje) = nada muda. Custo das linhas novas: a fila de custo calcula no COMMIT (inv. 15).
-- Trava: SO catalogo (CREATE OR REPLACE FUNCTION; nenhuma trava de tabela - medido no teste por diferenca de pg_locks). Qualquer hora.
-- Idempotente (a guarda aceita o texto de antes OU o de depois; funcoes novas ausentes, vivas ou neutras).
-- ATENCAO (LIFO): enquanto esta migration estiver viva RECUSAM pela guarda md5 - desfazer ESTA antes:
--   supabase/rollback/20261014100000_tamanho_em_cards_down.sql (_plan_tecido_criar_card_core fceac02c)
--   supabase/rollback/20261101190000_seg_s3d_gates_planejamento_down.sql (importar_modelo_linha db0c3dcb)
--   supabase/migrations/20261014100000_tamanho_em_cards.sql (_plan_tecido_criar_card_core fceac02c)
--   supabase/migrations/20261019300000_custo_previsto_servidor.sql (_plan_tecido_criar_card_core fceac02c)
--   supabase/migrations/20261101190000_seg_s3d_gates_planejamento.sql (importar_modelo_linha db0c3dcb)
--   e os _down_drop que varrem quem cita: 20261103174000_down_drop (insumos_padrao), S3a 20261101100000_down_drop
--   (_seg_exige_pagina) e Mod 20261103100000_down_drop (_exige_modulos).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._plan_tecido_criar_card_core(uuid,uuid,jsonb)
--     ANTES  fceac02c52bd0b29a33856dc9e0f9b11
--     DEPOIS 5814a5907981617a1b7c731941177143
--   public.importar_modelo_linha(jsonb,jsonb)
--     ANTES  db0c3dcbd90ded80d210b96747e01cb1
--     DEPOIS 4c53027d97a3b2a60108098fe8e1849a
--   public._insumos_padrao_aplicar(uuid)  (NOVA)  DEPOIS 8e51a47dadb9b56970e2903f2bf2624f  NEUTRO fa0d3ce7bb39628db1a6d33c46f4d289
--   public.salvar_insumos_iniciais(uuid,jsonb)  (NOVA)  DEPOIS 44da042744bc302a7b129201de93aeac  NEUTRO 9a0c13cdab6ca7720c6669b964faa052
--   exige a 20261103174000 viva: public.salvar_config_loja(uuid,jsonb,jsonb,boolean) = 27fdf9f2c9b2d1fe49577e9d30eaa574 e a coluna tenant_config.insumos_padrao.
-- ====================================================================================
-- Volta: supabase/rollback/20261103175000_urg_r2_insumos_iniciais_down.sql (devolve os 2 textos de ANTES e NEUTRALIZA as 2 novas; sem trava de tabela) - ANTES do
-- 20261103174000_down. DROP das 2 novas: supabase/rollback/20261103175000_urg_r2_insumos_iniciais_down_drop.sql (opcional, depois). Linhas de insumo ja gravadas FICAM.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'insumos_padrao' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'urg_r2_175000: a 20261103174000 (tenant_config.insumos_padrao) nao esta aplicada - aplique-a antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._seg_exige_pagina(text[])') IS NULL OR to_regprocedure('public._exige_modulos(text[])') IS NULL THEN
    RAISE EXCEPTION 'urg_r2_175000: portoes _seg_exige_pagina/_exige_modulos ausentes (S3a/Modularidade)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)', 'fceac02c52bd0b29a33856dc9e0f9b11', '5814a5907981617a1b7c731941177143'),
      ('public.importar_modelo_linha(jsonb,jsonb)', 'db0c3dcbd90ded80d210b96747e01cb1', '4c53027d97a3b2a60108098fe8e1849a')
    ) AS x(fn, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.fn)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'urg_r2_175000: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.fn, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._insumos_padrao_aplicar(uuid)', '8e51a47dadb9b56970e2903f2bf2624f', 'fa0d3ce7bb39628db1a6d33c46f4d289'),
      ('public.salvar_insumos_iniciais(uuid,jsonb)', '44da042744bc302a7b129201de93aeac', '9a0c13cdab6ca7720c6669b964faa052')
    ) AS x(fn, depois, neutro) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.fn)));
    IF v IS NOT NULL AND v NOT IN (r.depois, r.neutro) THEN
      RAISE EXCEPTION 'urg_r2_175000: % ja existe com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.fn, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._insumos_padrao_aplicar(_modelo_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R2] lista "Insumos padrao" da loja (tenant_config.insumos_padrao) vira o BOM de insumo (modelo_etiquetas) do card INTERNO
-- recem-criado pelo SERVIDOR (P-306 B: Plan. Tecido "Criar card"/"Criar cards" e Importar dados), logo depois do INSERT do card,
-- na mesma transacao. So age se o card e origem='interno' e ainda NAO tem nenhuma linha em modelo_etiquetas (nunca apaga nem soma).
-- A coluna pode ter sido gravada CRUA (UPDATE direto do admin da loja, fora de salvar_config_loja): RE-VALIDA cada item e IGNORA o
-- que nao serve - item que nao e objeto; insumo que nao e texto uuid ou nao e de etiquetas DA LOJA DO CARD (outra loja, apagado);
-- consumo que nao e numero JSON de 0 a 9999 com no maximo 4 casas; par (insumo, cor) repetido (fica o 1o). Cor que nao e texto uuid de uma cor DA LOJA
-- presente nas variantes do insumo entra como SEM cor (mesma regra do pre-preenchimento da tela). No maximo 20 linhas (limite do
-- editor), na ordem da lista; numero = posicao, perda 0, custo 0 (a fila de custo calcula no COMMIT).
-- NUNCA derruba a criacao do card: o laco + INSERT ficam num sub-bloco que engole qualquer erro, vira WARNING e devolve 0 (o card
-- nasce sem os insumos; a pessoa adiciona na secao Insumos). Devolve quantas linhas gravou.
-- Custo: as checagens so-leitura (card interno, lista da loja nao vazia, card sem linhas) vem ANTES do sub-bloco e SEM trava de
-- linha - lista vazia (ou card que nao se aplica) = 3 SELECTs, sem subtransacao nem XID (um "Criar cards" de dezenas de vagas nao
-- enche o cache de subtransacoes). Sem FOR UPDATE: os chamadores acabaram de inserir o card nesta transacao (invisivel as outras).
-- Le no maximo 200 itens da lista (lista crua gigante gravada por UPDATE direto nao pesa em toda criacao de card).
DECLARE
  v_tenant uuid;
  v_origem text;
  v_lista jsonb;
  v_it jsonb;
  v_e uuid;
  v_c uuid;
  v_ct text;
  v_q numeric;
  v_par text;
  v_pares text[] := ARRAY[]::text[];
  v_es uuid[] := ARRAY[]::uuid[];
  v_cs uuid[] := ARRAY[]::uuid[];
  v_qs numeric[] := ARRAY[]::numeric[];
BEGIN
  -- checagens so-leitura, FORA do sub-bloco (sem subtransacao/XID) e sem trava de linha
  SELECT m.tenant_id, m.origem INTO v_tenant, v_origem
    FROM public.modelos m
   WHERE m.id = _modelo_id;
  IF v_tenant IS NULL OR v_origem IS DISTINCT FROM 'interno' THEN
    RETURN 0;
  END IF;
  SELECT tc.insumos_padrao INTO v_lista FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;
  IF jsonb_typeof(v_lista) IS DISTINCT FROM 'array' THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(v_lista) = 0 THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.modelo_etiquetas me WHERE me.modelo_id = _modelo_id) THEN
    RETURN 0;
  END IF;
  BEGIN
    FOR v_it IN
      SELECT a.value FROM jsonb_array_elements(v_lista) WITH ORDINALITY AS a(value, ord) ORDER BY a.ord LIMIT 200
    LOOP
      EXIT WHEN cardinality(v_es) >= 20;
      CONTINUE WHEN jsonb_typeof(v_it) IS DISTINCT FROM 'object';
      -- insumo: texto uuid de etiquetas da loja do card
      CONTINUE WHEN jsonb_typeof(v_it -> 'etiqueta_id') IS DISTINCT FROM 'string';
      CONTINUE WHEN (v_it ->> 'etiqueta_id') !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$';
      v_e := (v_it ->> 'etiqueta_id')::uuid;
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.etiquetas e WHERE e.id = v_e AND e.tenant_id = v_tenant);
      -- consumo: numero JSON de 0 a 9999, no maximo 4 casas (a mesma regra da Config da Loja)
      CONTINUE WHEN jsonb_typeof(v_it -> 'consumo') IS DISTINCT FROM 'number';
      v_q := (v_it ->> 'consumo')::numeric;
      CONTINUE WHEN v_q < 0 OR v_q > 9999;
      CONTINUE WHEN v_q <> round(v_q, 4);
      -- cor: so vale uuid de uma cor da loja presente nas variantes do insumo; senao, sem cor
      v_c := NULL;
      v_ct := CASE WHEN jsonb_typeof(v_it -> 'cor_id') = 'string' THEN v_it ->> 'cor_id' END;
      IF v_ct ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        IF EXISTS (SELECT 1 FROM public.cores co WHERE co.id = v_ct::uuid AND co.tenant_id = v_tenant)
           AND EXISTS (SELECT 1 FROM public.variantes_etiqueta ve WHERE ve.etiqueta_id = v_e AND ve.cor_id = v_ct::uuid) THEN
          v_c := v_ct::uuid;
        END IF;
      END IF;
      -- par (insumo, cor) repetido: fica o 1o
      v_par := v_e::text || '|' || coalesce(v_c::text, '');
      CONTINUE WHEN v_par = ANY (v_pares);
      v_pares := array_append(v_pares, v_par);
      v_es := array_append(v_es, v_e);
      v_cs := array_append(v_cs, v_c);
      v_qs := array_append(v_qs, v_q);
    END LOOP;
    IF cardinality(v_es) = 0 THEN
      RETURN 0;
    END IF;
    INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
    SELECT v_tenant, _modelo_id, u.e, u.c, u.o::integer, u.q, 0, 0
      FROM unnest(v_es, v_cs, v_qs) WITH ORDINALITY AS u(e, c, q, o)
     ORDER BY u.o;
    RETURN cardinality(v_es);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'insumos padrao nao aplicados ao card % (SQLSTATE %): %', _modelo_id, SQLSTATE,
      regexp_replace(SQLERRM, '[^ -~]', '?', 'g');
    RETURN 0;
  END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._insumos_padrao_aplicar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_insumos_iniciais(_modelo_id uuid, _linhas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R2] BOM INICIAL de insumo (modelo_etiquetas) do card INTERNO novo, gravado pelo CLIENTE logo depois do INSERT do card: o 1o
-- Salvar do Dialog "Novo Modelo" (linhas pre-preenchidas pela lista "Insumos padrao" da loja e ajustadas na tela) e "Criar varios
-- cards" (P-306 B). Portoes: login; modulo Criacao (_exige_modulos); pagina Planejamento OU Desenvolvimento (_seg_exige_pagina - BOM
-- inicial, precedente M1 da S3c), ANTES de qualquer busca. So card DA LOJA (senao nao_encontrado), so interno, so SEM nenhuma linha
-- de insumo (nunca apaga nem soma). Linhas: lista de ate 20 (limite do editor) de {etiqueta_id: insumo DA LOJA, cor_id: ausente,
-- null, "" ou cor DA LOJA, consumo: numero JSON de 0 a 9999 com no maximo 4 casas, loss_percent (Perda %, opcional): ausente/null = 0,
-- numero JSON de 0 a 100 com no maximo 2 casas (as casas das colunas de modelo_etiquetas)}; numero = posicao, custo 0 (a fila de custo
-- calcula no COMMIT;
-- o gatilho de pagina de modelo_etiquetas so morde o papel do cliente e o B3 dele confere a loja de novo). Recusas ASCII com prefixo
-- (a tela traduz). Devolve quantas linhas gravou.
DECLARE
  v_tenant uuid;
  v_origem text;
  v_it jsonb;
  v_i integer;
  v_ct text;
  v_es uuid[] := ARRAY[]::uuid[];
  v_cs uuid[] := ARRAY[]::uuid[];
  v_qs numeric[] := ARRAY[]::numeric[];
  v_ls numeric[] := ARRAY[]::numeric[];
  v_l numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('criacao');
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento');
  SELECT m.tenant_id, m.origem INTO v_tenant, v_origem
    FROM public.modelos m
   WHERE m.id = _modelo_id
     AND m.tenant_id = public.get_user_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0001';
  END IF;
  IF v_origem IS DISTINCT FROM 'interno' THEN
    RAISE EXCEPTION 'insumos_iniciais_so_interno: o card nao e interno' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.modelo_etiquetas me WHERE me.modelo_id = _modelo_id) THEN
    RAISE EXCEPTION 'insumos_iniciais_ja_existem: o card ja tem insumos' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_linhas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'insumos_iniciais_invalidos: precisa ser uma lista' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(_linhas) > 20 THEN
    RAISE EXCEPTION 'insumos_iniciais_invalidos: no maximo 20 linhas (veio %)', jsonb_array_length(_linhas) USING ERRCODE = 'P0001';
  END IF;
  FOR v_it, v_i IN
    SELECT a.value, a.ord::integer FROM jsonb_array_elements(_linhas) WITH ORDINALITY AS a(value, ord) ORDER BY a.ord
  LOOP
    IF jsonb_typeof(v_it) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: formato invalido', v_i USING ERRCODE = 'P0001';
    END IF;
    -- insumo: texto uuid de etiquetas da loja
    IF jsonb_typeof(v_it -> 'etiqueta_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: insumo nao encontrado nesta loja', v_i USING ERRCODE = 'P0001';
    END IF;
    IF (v_it ->> 'etiqueta_id') !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: insumo nao encontrado nesta loja', v_i USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.etiquetas e WHERE e.id = (v_it ->> 'etiqueta_id')::uuid AND e.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: insumo nao encontrado nesta loja', v_i USING ERRCODE = 'P0001';
    END IF;
    -- cor: ausente, null ou "" = sem cor; texto nao vazio = uuid de cores da loja; outro tipo = recusa
    v_ct := NULL;
    IF jsonb_typeof(v_it -> 'cor_id') = 'string' AND (v_it ->> 'cor_id') <> '' THEN
      v_ct := v_it ->> 'cor_id';
      IF v_ct !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: cor nao encontrada nesta loja', v_i USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.cores co WHERE co.id = v_ct::uuid AND co.tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: cor nao encontrada nesta loja', v_i USING ERRCODE = 'P0001';
      END IF;
    ELSIF jsonb_typeof(v_it -> 'cor_id') IS NOT NULL AND jsonb_typeof(v_it -> 'cor_id') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: cor nao encontrada nesta loja', v_i USING ERRCODE = 'P0001';
    END IF;
    -- consumo: numero JSON de 0 a 9999
    IF jsonb_typeof(v_it -> 'consumo') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: consumo precisa ser um numero de 0 a 9999', v_i USING ERRCODE = 'P0001';
    END IF;
    IF (v_it ->> 'consumo')::numeric < 0 OR (v_it ->> 'consumo')::numeric > 9999 THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: consumo precisa ser um numero de 0 a 9999', v_i USING ERRCODE = 'P0001';
    END IF;
    IF (v_it ->> 'consumo')::numeric <> round((v_it ->> 'consumo')::numeric, 4) THEN
      RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: consumo com no maximo 4 casas decimais', v_i USING ERRCODE = 'P0001';
    END IF;
    -- perda (opcional): ausente ou null = 0; numero JSON de 0 a 100 com no maximo 2 casas (loss_percent numeric(10,2))
    v_l := 0;
    IF coalesce(jsonb_typeof(v_it -> 'loss_percent'), 'null') <> 'null' THEN
      IF jsonb_typeof(v_it -> 'loss_percent') <> 'number' THEN
        RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: perda precisa ser um numero de 0 a 100', v_i USING ERRCODE = 'P0001';
      END IF;
      v_l := (v_it ->> 'loss_percent')::numeric;
      IF v_l < 0 OR v_l > 100 THEN
        RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: perda precisa ser um numero de 0 a 100', v_i USING ERRCODE = 'P0001';
      END IF;
      IF v_l <> round(v_l, 2) THEN
        RAISE EXCEPTION 'insumos_iniciais_invalidos: linha %: perda com no maximo 2 casas decimais', v_i USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_es := array_append(v_es, (v_it ->> 'etiqueta_id')::uuid);
    v_cs := array_append(v_cs, v_ct::uuid);
    v_qs := array_append(v_qs, (v_it ->> 'consumo')::numeric);
    v_ls := array_append(v_ls, v_l);
  END LOOP;
  IF cardinality(v_es) = 0 THEN
    RETURN 0;
  END IF;
  INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
  SELECT v_tenant, _modelo_id, u.e, u.c, u.o::integer, u.q, u.l, 0
    FROM unnest(v_es, v_cs, v_qs, v_ls) WITH ORDINALITY AS u(e, c, q, l, o)
   ORDER BY u.o;
  RETURN cardinality(v_es);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.salvar_insumos_iniciais(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_insumos_iniciais(uuid,jsonb) TO authenticated, service_role;

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

  -- [urg R2] insumos padrao da loja (P-306 B): o card interno novo nasce com a lista da Config da Loja na secao Insumos
  -- (re-validada; nunca derruba a criacao - ver _insumos_padrao_aplicar).
  perform public._insumos_padrao_aplicar(v_mid);

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

  -- [urg R2] insumos padrao da loja (P-306 B): o card interno criado pela importacao nasce com a lista da Config da Loja na
  -- secao Insumos (re-validada; nunca derruba a importacao - ver _insumos_padrao_aplicar).
  PERFORM public._insumos_padrao_aplicar(v_id);

  RETURN jsonb_build_object('modelo_id', v_id, 'acao', 'criado');
END $function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)', '5814a5907981617a1b7c731941177143'),
      ('public.importar_modelo_linha(jsonb,jsonb)', '4c53027d97a3b2a60108098fe8e1849a'),
      ('public._insumos_padrao_aplicar(uuid)', '8e51a47dadb9b56970e2903f2bf2624f'),
      ('public.salvar_insumos_iniciais(uuid,jsonb)', '44da042744bc302a7b129201de93aeac')
    ) AS x(fn, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r2_175000: pos-condicao falhou no texto de % (esperado %)', r.fn, r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._insumos_padrao_aplicar(uuid)') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public._insumos_padrao_aplicar(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._insumos_padrao_aplicar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'urg_r2_175000: pos-condicao falhou na ACL/secdef/search_path de public._insumos_padrao_aplicar(uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_insumos_iniciais(uuid,jsonb)') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.salvar_insumos_iniciais(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.salvar_insumos_iniciais(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.salvar_insumos_iniciais(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'urg_r2_175000: pos-condicao falhou na ACL/secdef/search_path de public.salvar_insumos_iniciais(uuid,jsonb)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)') AND p.prosecdef
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
    RAISE EXCEPTION 'urg_r2_175000: pos-condicao falhou na ACL/secdef/search_path de public._plan_tecido_criar_card_core(uuid,uuid,jsonb)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.importar_modelo_linha(jsonb,jsonb)') AND p.prosecdef
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
    RAISE EXCEPTION 'urg_r2_175000: pos-condicao falhou na ACL/secdef/search_path de public.importar_modelo_linha(jsonb,jsonb)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

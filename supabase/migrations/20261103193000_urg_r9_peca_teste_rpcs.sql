-- Urgentes R9b - RPCs da Peca Teste (leitura da secao, Salvar com rev/P0409/CAS do fornecedor na mesma txn, quadro de Etapas). GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 2 / R9b; Rulings 2, 7-12, 17, 20, 33) + spec-r9.md + revisao T1 (achados 1 e 6).
-- O que muda (so catalogo: CREATE FUNCTION + GRANT/REVOKE; nenhum dado):
--   1) helper NOVO _peca_teste_aprovada(linha, tipo, fornecedor da linha) - PREDICADO UNICO de 'peca teste aprovada' (tentativa
--      atual 'aprovado' E fornecedor congelado na decisao = o da linha; revisao T1, achado 1). Core (REVOKE dos 3).
--   2) leitura da secao: peca_teste_modelo (wrapper: modulo Criacao; sem VER criacao_planejamento:peca_teste = NULL) ->
--      _peca_teste_trilhas_core (core). Nunca devolve valor da M.O.
--   3) Salvar: salvar_peca_teste (wrapper: login, modulo Criacao, portao S3 da SECAO criacao_planejamento:peca_teste) ->
--      _salvar_peca_teste_core (core): chave do card PRIMEIRO, linhas de M.O. e tentativas FOR UPDATE, rev por tentativa (P0409),
--      reprovada imutavel, decisao congela o fornecedor da linha, fornecedor por compare-and-set NA MESMA transacao (reabre a M.O.),
--      updated_at = now() em toda escrita.
--   4) quadro: peca_teste_quadro (wrapper: modulo Etapas PL; sem VER producao_etapas = []) -> _peca_teste_quadro_core (core).
--   5) funcao EXISTENTE redefinida: fn_peca_teste_trava_fornecedor (da r9a) passa a usar o predicado unico.
-- Em tempo de uso: o Salvar da Peca Teste pega a chave do card -> espera (ms) um Enviar a Explosao / aprovar M.O. / Salvar da
-- M.O. abertos no mesmo card, e vice-versa. Trocar o fornecedor pela Peca Teste reabre a M.O. (o rollup derruba
-- modelos.custo_terceirizados_aprovado -> a regressao do kanban manual existente roda).
-- Trava (MEDIDA na copia local, supautils carregado, diferenca de pg_locks numa txn REVERTIDA, arquivo inteiro; 1a vez e
-- reaplicada): ~6-11 ms, SO catalogo (CREATE OR REPLACE FUNCTION + GRANT/REVOKE). Relacoes: AccessShareLock em
-- modelo_peca_teste_tentativas (validacao do corpo do helper LANGUAGE sql) e em information_schema.columns (guarda) - so
-- esperam DDL nessas tabelas; NENHUMA trava de escrita; NADA em auth/storage/realtime. Qualquer hora. 55P03 = nada mudou,
-- rodar de novo. Idempotente (2a vez = mesmos md5).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_peca_teste_trava_fornecedor()
--     ANTES  eda05ebed95f51f554afe210a5f28c89
--     DEPOIS 982769d4384a04d9a35d53db654667da
--   public._peca_teste_aprovada(uuid,uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 417fa9850a5a52204f62476818dc408c
--   public._peca_teste_trilhas_core(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 5ae0f7025744d63508d7617e6e3a7487
--   public.peca_teste_modelo(uuid) (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS 9f5e9a528d3cac6deaf3c34133f5d56b
--     NEUTRO 693da711ec898bdbbc078439ecd1c46e (_down)
--   public._salvar_peca_teste_core(uuid,jsonb,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS eccde92e1c6687045f8f7c9ae61caf8f
--   public.salvar_peca_teste(uuid,jsonb,jsonb) (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS 74edd9a64f98101476de545ac8361a81
--     NEUTRO 4c501cdcdbf99aed1da1aef6d82f853f (_down)
--   public._peca_teste_quadro_core(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 6e191644f2fb4acfea04e4ff76a6f5de
--     NEUTRO 1821c151ef5963eb95d90167c75ba249 (_down)
--   public.peca_teste_quadro() (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS ad45b8479fb46de11ea265b7ef5a728a
--     NEUTRO d208d91fc9846fd221da953481966968 (_down)
--   dependencias FIXADAS (nao redefinidas):
--     public._exige_modulos(text[]) b1d4958f65df2c593366926e2b56903e
--     public._seg_exige_pagina(text[]) 85eff0037e61fdecefb46154ac9479d2
--     public.user_can_view(text) 643c9aa7ef41d52e3193b1e1561e1375
--     public.enforce_servico_mo_aprovacao() 1643b69db26e2034905866356b80232e
--     public._modelo_colecao_rotulo(uuid,uuid,text) e9220bc3a67b82ddcd768b8ad5a81a46
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103193000_urg_r9_peca_teste_rpcs_down.sql - DEPOIS dos _down da 196000..194000 e ANTES do 20261103192000_down
-- (que RECUSA enquanto esta estiver viva: a trava nao esta no texto da r9a). DROP das 7 funcoes novas: supabase/rollback/20261103193000_urg_r9_peca_teste_rpcs_down_drop.sql
-- (opcional, depois; recusa enquanto outra funcao - ex.: o _avaliar_condicoes_kanban_core da 194000 - citar alguma delas).
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
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '982769d4384a04d9a35d53db654667da')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r9b: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- dependencias FIXADAS (nao redefinidas aqui): o texto de hoje
  FOR r IN SELECT * FROM (VALUES
      ('public._exige_modulos(text[])', 'b1d4958f65df2c593366926e2b56903e'),
      ('public._seg_exige_pagina(text[])', '85eff0037e61fdecefb46154ac9479d2'),
      ('public.user_can_view(text)', '643c9aa7ef41d52e3193b1e1561e1375'),
      ('public.enforce_servico_mo_aprovacao()', '1643b69db26e2034905866356b80232e'),
      ('public._modelo_colecao_rotulo(uuid,uuid,text)', 'e9220bc3a67b82ddcd768b8ad5a81a46')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9b: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado'
                      AND column_name = 'exige_peca_teste') THEN
    RAISE EXCEPTION 'urg_r9b: exige a 20261103192000 (urg R9a) aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- funcoes NOVAS deste bloco: ausentes, ja com o texto de DEPOIS ou no NEUTRO do _down (ciclo ida -> _down -> ida)
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_aprovada(uuid,uuid,uuid)', '417fa9850a5a52204f62476818dc408c', '417fa9850a5a52204f62476818dc408c', false),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', '5ae0f7025744d63508d7617e6e3a7487', false),
      ('public.peca_teste_modelo(uuid)', '9f5e9a528d3cac6deaf3c34133f5d56b', '693da711ec898bdbbc078439ecd1c46e', true),
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e1c6687045f8f7c9ae61caf8f', 'eccde92e1c6687045f8f7c9ae61caf8f', false),
      ('public.salvar_peca_teste(uuid,jsonb,jsonb)', '74edd9a64f98101476de545ac8361a81', '4c501cdcdbf99aed1da1aef6d82f853f', true),
      ('public._peca_teste_quadro_core(uuid)', '6e191644f2fb4acfea04e4ff76a6f5de', '1821c151ef5963eb95d90167c75ba249', false),
      ('public.peca_teste_quadro()', 'ad45b8479fb46de11ea265b7ef5a728a', 'd208d91fc9846fd221da953481966968', true)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r9b: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) funcoes NOVAS (texto canonico; wrapper = authenticated executa, PUBLIC/anon nao; core = REVOKE dos 3)
CREATE OR REPLACE FUNCTION public._peca_teste_aprovada(_mo_linha_id uuid, _categoria_id uuid, _empresa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r9b] PREDICADO UNICO de "peca teste aprovada" de uma trilha (linha de M.O. x tipo de servico): a tentativa ATUAL (maior
  -- numero) esta 'aprovado' E o fornecedor congelado na decisao = o fornecedor ATUAL da linha (_empresa_id). Revisao T1, achado 1:
  -- trocar o tipo da linha ou o switch exige_peca_teste ida-e-volta com o fornecedor trocado no meio NAO transfere a aprovacao a
  -- quem nunca fez a peca. Sem tentativa = false. Nao olha o switch nem a M.O. aprovada (o chamador decide). Usado pela trava de
  -- fornecedor, pelas leituras da secao e do quadro e pela condicao do kanban (194000). EXECUTE so postgres/service_role.
  SELECT coalesce((SELECT t.aprovacao = 'aprovado' AND t.empresa_id IS NOT DISTINCT FROM _empresa_id
                     FROM public.modelo_peca_teste_tentativas t
                    WHERE t.mo_linha_id = _mo_linha_id AND t.categoria_terceirizado_id = _categoria_id
                    ORDER BY t.numero DESC LIMIT 1), false)
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_aprovada(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_trilhas_core(_tenant uuid, _modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] secao Peca Teste do card: trilhas = linhas de M.O. do card cujo tipo (da MESMA loja) exige peca teste, na ordem da
  -- M.O. (ct.ordem, ct.nome, created_at, id); tentativas = as da trilha (linha x tipo ATUAL), numero ASC; "aprovada" = o predicado
  -- unico (_peca_teste_aprovada, com o fornecedor da linha). "outros" = as demais linhas COM tipo (so servico + fornecedor; Ruling
  -- 33). NUNCA devolve valor da M.O. Card de outra loja / inexistente = NULL.
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = _tenant) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'trilhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'mo_linha_id', s.id,
               'categoria_id', s.categoria_terceirizado_id,
               'categoria_nome', ct.nome,
               'empresa_id', s.empresa_id,
               'empresa_nome', e.nome_fantasia,
               'mo_aprovado', s.aprovado,
               'aprovada', public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id),
               'tentativas', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', t.id, 'numero', t.numero, 'empresa_id', t.empresa_id, 'empresa_nome', te.nome_fantasia,
                          'data_saida', t.data_saida, 'data_entrada', t.data_entrada, 'aprovacao', t.aprovacao,
                          'decidido_em', t.decidido_em, 'rev', t.rev) ORDER BY t.numero)
                   FROM public.modelo_peca_teste_tentativas t
                   LEFT JOIN public.empresas te ON te.id = t.empresa_id AND te.tenant_id = _tenant
                  WHERE t.mo_linha_id = s.id AND t.categoria_terceirizado_id = s.categoria_terceirizado_id AND t.tenant_id = _tenant
               ), '[]'::jsonb)
             ) ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb),
    'outros', coalesce((
      SELECT jsonb_agg(jsonb_build_object('categoria_nome', ct.nome, 'empresa_nome', e.nome_fantasia)
             ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND NOT ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb));
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_trilhas_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.peca_teste_modelo(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] leitura da secao Peca Teste (Ruling 17): modulo Criacao; sem VER a secao criacao_planejamento:peca_teste = NULL (a
  -- tela esconde a secao, como modelo_mo_resumo devolve {}); card de outra loja = NULL.
  PERFORM public._exige_modulos('criacao');
  IF NOT public.user_can_view('criacao_planejamento:peca_teste') THEN
    RETURN NULL;
  END IF;
  RETURN public._peca_teste_trilhas_core(public.get_user_tenant_id(), _modelo_id);
END $function$;
REVOKE EXECUTE ON FUNCTION public.peca_teste_modelo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peca_teste_modelo(uuid) TO authenticated;

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
  v_forns jsonb;
  v_ids uuid[];
  tr jsonb;
  tt jsonb;
  v_linha uuid;
  v_cat uuid;
  v_forn uuid;
  v_t public.modelo_peca_teste_tentativas%ROWTYPE;
  v_id uuid;
  v_num integer;
  v_saida date;
  v_entrada date;
  v_aprov text;
  v_max integer;
  v_ult text;
  v_novo uuid;
  v_base uuid;
  v_congela uuid;
BEGIN
  -- [urg r9b] Salvar da secao Peca Teste (grava SO no Salvar do card; payload = so as trilhas tocadas, delta). Ordem:
  -- (1) card da loja + formato; (2) chave do card PRIMEIRO (a mesma 1a chave do Enviar a Explosao, do aprovar M.O., do Salvar da M.O.
  -- e do excluir_cad; a Peca Teste nao toca CAD/blocos); (3) linhas de M.O. FOR UPDATE (ordem de id) - sumiu/tipo mudou/switch
  -- desligado = P0409; (4) tentativas FOR UPDATE (ordem de id), aplicadas (existentes primeiro, novas por numero); (5) fornecedor da
  -- linha por compare-and-set, na MESMA transacao (reabre a M.O. pelo gatilho; a trava morde se a atual, ja com o passo 4, estiver
  -- aprovada). Toda escrita grava updated_at = now() (revisao T1, achado 6). Decisao (aprovar/reprovar) congela em empresa_id o
  -- fornecedor da linha ANTES da troca deste mesmo Salvar (Ruling 8; revisao T1, achado 1) - CONFERIDO contra o que a pessoa viu
  -- (_rev_base.fornecedor da linha, obrigatorio em toda decisao; revisao T2, achados 1 e 2) e nunca vazio (achado 3). A trilha e
  -- conferida pelo TIPO ATUAL da linha (categoria_id obrigatorio; outro = P0409) e tentativa nova nunca nasce decidida (T6, achado 1).
  IF NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'peca_teste_modelo: nao encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_trilhas) IS DISTINCT FROM 'array' OR jsonb_typeof(_rev_base) IS DISTINCT FROM 'object'
     OR jsonb_typeof(coalesce(_rev_base->'tentativas', '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(coalesce(_rev_base->'fornecedor', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'peca_teste_formato: _trilhas tem de ser lista e _rev_base objeto' USING ERRCODE = 'P0001';
  END IF;
  v_revs := coalesce(_rev_base->'tentativas', '{}'::jsonb);
  v_forns := coalesce(_rev_base->'fornecedor', '{}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x
              WHERE jsonb_typeof(x) <> 'object'
                 OR coalesce(x->>'mo_linha_id', '') !~ v_uuid
                 OR coalesce(x->>'categoria_id', '') !~ v_uuid
                 OR jsonb_typeof(coalesce(x->'tentativas', '[]'::jsonb)) <> 'array'
                 OR (x ? 'empresa_id' AND jsonb_typeof(x->'empresa_id') NOT IN ('string', 'null'))
                 OR (x ? 'empresa_id' AND x->>'empresa_id' IS NOT NULL AND x->>'empresa_id' !~ v_uuid))
     OR (SELECT count(*) <> count(DISTINCT lower(x->>'mo_linha_id')) FROM jsonb_array_elements(_trilhas) x) THEN
    RAISE EXCEPTION 'peca_teste_formato: trilha invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE jsonb_typeof(t) <> 'object'
                 OR (t->>'id' IS NOT NULL AND t->>'id' !~ v_uuid)
                 OR (t->>'id' IS NULL AND coalesce(t->>'numero', '') !~ '^[1-9][0-9]{0,5}$')
                 OR coalesce(t->>'data_saida', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'data_entrada', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'aprovacao', 'aprovado') !~ '^(aprovado|reprovado)$')
     OR (SELECT count(t->>'id') <> count(DISTINCT lower(t->>'id'))
           FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t) THEN
    RAISE EXCEPTION 'peca_teste_formato: tentativa invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  -- tentativa NOVA nunca nasce decidida (revisao T6, achado 1: um payload velho/mesclado de uma linha cujo TIPO mudou levava a
  -- aprovacao do tipo antigo para a trilha nova): decide-se so a tentativa ja GRAVADA (que tem id da trilha atual; com as 2 datas
  -- no Salvar da decisao - peca_teste_sem_datas abaixo)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE t->>'id' IS NULL AND t->>'aprovacao' IS NOT NULL) THEN
    RAISE EXCEPTION 'peca_teste_sem_datas: tentativa nova nao nasce aprovada ou reprovada - salve as datas antes de decidir' USING ERRCODE = 'P0001';
  END IF;
  -- data no formato mas inexistente (ex.: 2026-02-30) = o mesmo P0001 com prefixo (nao o 22008 cru)
  BEGIN
    PERFORM count((t->>'data_saida')::date) + count((t->>'data_entrada')::date)
       FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'peca_teste_formato: data invalida' USING ERRCODE = 'P0001';
  END;

  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  SELECT coalesce(array_agg((x->>'mo_linha_id')::uuid), '{}'::uuid[]) INTO v_ids FROM jsonb_array_elements(_trilhas) x;
  PERFORM 1 FROM public.modelo_servico_mo s
    WHERE s.id = ANY(v_ids) AND s.modelo_id = _modelo_id AND s.tenant_id = v_tenant
    ORDER BY s.id FOR UPDATE;
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    IF NOT EXISTS (SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = v_tenant
                                                           AND ct.exige_peca_teste
                    WHERE s.id = (tr->>'mo_linha_id')::uuid AND s.modelo_id = _modelo_id AND s.tenant_id = v_tenant
                      AND s.categoria_terceirizado_id = (tr->>'categoria_id')::uuid) THEN
      RAISE EXCEPTION 'peca_teste_desatualizada: servico da mao de obra mudou' USING ERRCODE = 'P0409';
    END IF;
  END LOOP;
  PERFORM 1 FROM public.modelo_peca_teste_tentativas t WHERE t.mo_linha_id = ANY(v_ids) ORDER BY t.id FOR UPDATE;

  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    v_linha := (tr->>'mo_linha_id')::uuid;
    v_cat := (tr->>'categoria_id')::uuid;
    SELECT s.empresa_id INTO v_forn FROM public.modelo_servico_mo s WHERE s.id = v_linha;  -- ANTES da troca deste Salvar
    v_congela := v_forn;
    -- DECISAO (nova com aprovacao, ou existente cuja aprovacao muda para aprovado/reprovado): o fornecedor que a pessoa viu
    -- (_rev_base.fornecedor) tem de ser o da linha; a peca e decidida para ELE (revisao T2, achados 1-3)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x
                LEFT JOIN public.modelo_peca_teste_tentativas t ON t.id = (x->>'id')::uuid
               WHERE x->>'aprovacao' IS NOT NULL AND (x->>'id' IS NULL OR t.aprovacao IS DISTINCT FROM x->>'aprovacao')) THEN
      IF NOT (v_forns ? v_linha::text) OR jsonb_typeof(v_forns->v_linha::text) NOT IN ('string', 'null')
         OR (v_forns->>v_linha::text IS NOT NULL AND v_forns->>v_linha::text !~ v_uuid) THEN
        RAISE EXCEPTION 'peca_teste_formato: aprovar ou reprovar exige _rev_base.fornecedor da linha' USING ERRCODE = 'P0001';
      END IF;
      v_base := (v_forns->>v_linha::text)::uuid;
      IF v_base IS DISTINCT FROM v_forn THEN
        IF tr ? 'empresa_id' AND (tr->>'empresa_id')::uuid IS NOT DISTINCT FROM v_forn THEN
          -- a troca DESTE Salvar ja foi gravada (o Salvar da M.O. rodou antes): decide sobre o fornecedor de ANTES (Ruling 8) -
          -- aprovar + trocar juntos = o mesmo P0001 da trava; reprovar congela o de antes (quem fez a peca)
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x
                      LEFT JOIN public.modelo_peca_teste_tentativas t ON t.id = (x->>'id')::uuid
                     WHERE x->>'aprovacao' = 'aprovado' AND (x->>'id' IS NULL OR t.aprovacao IS DISTINCT FROM 'aprovado')) THEN
            RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
          END IF;
          -- a base vem do cliente: so congela fornecedor de SERVICO desta loja (revisao T2, achado 8; o mesmo criterio da troca)
          IF v_base IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empresas e
                                                 WHERE e.id = v_base AND e.tenant_id = v_tenant AND e.tipo = 'servico') THEN
            RAISE EXCEPTION 'peca_teste_fornecedor_invalido: fornecedor de servico invalido' USING ERRCODE = 'P0001';
          END IF;
          v_congela := v_base;
        ELSE
          RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
        END IF;
      END IF;
      IF v_congela IS NULL THEN
        RAISE EXCEPTION 'peca_teste_sem_fornecedor: defina o fornecedor da M.O. antes de aprovar ou reprovar a peca teste'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    -- tentativas EXISTENTES (id): rev = a base; reprovada = so leitura; aprovada mantida = datas travadas; tudo vazio = DELETE
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NOT NULL LOOP
      v_id := (tt->>'id')::uuid;
      SELECT * INTO v_t FROM public.modelo_peca_teste_tentativas t
       WHERE t.id = v_id AND t.mo_linha_id = v_linha AND t.categoria_terceirizado_id = v_cat AND t.tenant_id = v_tenant;
      IF NOT FOUND OR coalesce(v_revs->>v_id::text, '') !~ '^[0-9]{1,9}$' OR v_t.rev <> (v_revs->>v_id::text)::integer THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_aprov := tt->>'aprovacao';
      -- reprovada (o CHECK da tabela so aceita aprovado/reprovado; sem o literal: o anti-drift da Mod T4 reserva o literal reprovado ao
      -- status do card)
      IF v_t.aprovacao IS NOT NULL AND v_t.aprovacao <> 'aprovado' THEN
        IF v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada OR v_aprov IS DISTINCT FROM v_t.aprovacao THEN
          RAISE EXCEPTION 'peca_teste_historico: tentativa reprovada e so leitura' USING ERRCODE = 'P0001';
        END IF;
        CONTINUE;
      END IF;
      IF v_t.aprovacao = 'aprovado' AND v_aprov = 'aprovado'
         AND (v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada) THEN
        RAISE EXCEPTION 'peca_teste_aprovada_travada: datas da peca aprovada nao mudam (desfaca a aprovacao antes)' USING ERRCODE = 'P0001';
      END IF;
      IF v_saida IS NULL AND v_entrada IS NULL AND v_aprov IS NULL THEN
        DELETE FROM public.modelo_peca_teste_tentativas WHERE id = v_id;  -- volta a VIRTUAL
        CONTINUE;
      END IF;
      IF v_aprov IS NOT NULL AND (v_saida IS NULL OR v_entrada IS NULL) THEN
        RAISE EXCEPTION 'peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada' USING ERRCODE = 'P0001';
      END IF;
      IF v_saida IS NOT DISTINCT FROM v_t.data_saida AND v_entrada IS NOT DISTINCT FROM v_t.data_entrada
         AND v_aprov IS NOT DISTINCT FROM v_t.aprovacao THEN
        CONTINUE;  -- nada mudou: nao sobe o rev
      END IF;
      UPDATE public.modelo_peca_teste_tentativas t
         SET data_saida = v_saida,
             data_entrada = v_entrada,
             aprovacao = v_aprov,
             decidido_em = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN now() ELSE t.decidido_em END,
             decidido_por = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN v_uid ELSE t.decidido_por END,
             -- decidir congela o fornecedor; aprovado -> reprovado guarda o de quem fez a peca (o congelado); desfazer limpa
             empresa_id = CASE WHEN v_aprov IS NULL THEN NULL
                               WHEN v_t.aprovacao IS NULL THEN v_congela
                               WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN coalesce(t.empresa_id, v_congela)
                               ELSE t.empresa_id END,
             updated_at = now()
       WHERE t.id = v_id;
    END LOOP;
    -- tentativas NOVAS (id nulo), por numero: so a proxima depois de uma reprovada (ou a 1a); so nulos = ignora
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NULL
               ORDER BY (x->>'numero')::integer LOOP
      v_num := (tt->>'numero')::integer;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_aprov := tt->>'aprovacao';
      IF v_saida IS NULL AND v_entrada IS NULL AND v_aprov IS NULL THEN
        CONTINUE;
      END IF;
      SELECT t.numero, t.aprovacao INTO v_max, v_ult FROM public.modelo_peca_teste_tentativas t
       WHERE t.mo_linha_id = v_linha AND t.categoria_terceirizado_id = v_cat ORDER BY t.numero DESC LIMIT 1;
      IF NOT FOUND THEN
        v_max := 0;      -- nenhuma tentativa: a nova e a 1a
      ELSIF v_ult IS NULL OR v_ult = 'aprovado' THEN
        v_max := NULL;   -- a atual nao foi reprovada: nao ha "proxima" (outra pessoa ja lancou a tentativa)
      END IF;
      IF v_max IS NULL OR v_num <> v_max + 1 THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
      IF v_aprov IS NOT NULL AND (v_saida IS NULL OR v_entrada IS NULL) THEN
        RAISE EXCEPTION 'peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        INSERT INTO public.modelo_peca_teste_tentativas
          (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao,
           decidido_em, decidido_por, created_by, updated_at)
        VALUES (v_tenant, _modelo_id, v_linha, v_cat, v_num, CASE WHEN v_aprov IS NOT NULL THEN v_congela END, v_saida, v_entrada, v_aprov,
                CASE WHEN v_aprov IS NOT NULL THEN now() END, CASE WHEN v_aprov IS NOT NULL THEN v_uid END, v_uid, now());
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END;
    END LOOP;
  END LOOP;

  -- fornecedor da linha (so as trilhas com a chave empresa_id): compare-and-set idempotente (Ruling 9)
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x WHERE x ? 'empresa_id' LOOP
    v_linha := (tr->>'mo_linha_id')::uuid;
    v_novo := (tr->>'empresa_id')::uuid;
    SELECT s.empresa_id INTO v_forn FROM public.modelo_servico_mo s WHERE s.id = v_linha;
    IF v_forn IS NOT DISTINCT FROM v_novo THEN
      CONTINUE;  -- o Salvar da M.O. ja gravou o mesmo (ou nada mudou)
    END IF;
    IF NOT (v_forns ? v_linha::text) OR jsonb_typeof(v_forns->v_linha::text) NOT IN ('string', 'null')
       OR (v_forns->>v_linha::text IS NOT NULL AND v_forns->>v_linha::text !~ v_uuid) THEN
      RAISE EXCEPTION 'peca_teste_formato: falta _rev_base.fornecedor da linha' USING ERRCODE = 'P0001';
    END IF;
    v_base := (v_forns->>v_linha::text)::uuid;
    IF v_forn IS DISTINCT FROM v_base THEN
      RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
    END IF;
    IF v_novo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = v_novo AND e.tenant_id = v_tenant AND e.tipo = 'servico') THEN
      RAISE EXCEPTION 'peca_teste_fornecedor_invalido: fornecedor de servico invalido' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.modelo_servico_mo SET empresa_id = v_novo, updated_at = now() WHERE id = v_linha;
  END LOOP;
END $function$;
REVOKE EXECUTE ON FUNCTION public._salvar_peca_teste_core(uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_peca_teste(_modelo_id uuid, _trilhas jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] Salvar da secao Peca Teste: login, modulo Criacao, portao S3 da SECAO (EDITAR criacao_planejamento:peca_teste; P-325 A:
  -- quem so tem a secao troca o fornecedor sem aprovar M.O. nem ver custos), depois o core.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'peca_teste_sem_login: nao autenticado' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('criacao');
  PERFORM public._seg_exige_pagina('criacao_planejamento:peca_teste');
  PERFORM public._salvar_peca_teste_core(_modelo_id, _trilhas, _rev_base);
END $function$;
REVOKE EXECUTE ON FUNCTION public.salvar_peca_teste(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_peca_teste(uuid,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_quadro_core(_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] coluna Peca Teste do quadro PCP > Etapas: 1 item por card NAO lancado da loja com >= 1 trilha (tipo exigindo) cuja
  -- tentativa atual esta "em_teste" (tem data de saida, sem decisao) ou "aprovada" (o predicado unico, com o fornecedor da linha);
  -- card Reprovado fica fora.
  -- O item traz TODAS as trilhas exigindo do card (as demais com status "pendente": virtual, reprovada, so com entrada, ou aprovada
  -- com outro fornecedor) para o front decidir "aprovada so se todas" (Ruling 20). O filtro "e PL" fica no front (isServicoPL).
  RETURN coalesce((
    WITH tr AS (
      SELECT s.modelo_id, s.id AS linha, ct.ordem, ct.nome AS cat_nome, s.created_at, e.nome_fantasia AS emp_nome,
             a.aprovacao, a.data_saida,
             public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id) AS ok
        FROM public.modelo_servico_mo s
        JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = _tenant AND NOT m.lancado
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
        LEFT JOIN LATERAL (SELECT t.aprovacao, t.data_saida FROM public.modelo_peca_teste_tentativas t
                            WHERE t.mo_linha_id = s.id AND t.categoria_terceirizado_id = s.categoria_terceirizado_id
                            ORDER BY t.numero DESC LIMIT 1) a ON true
    ), st AS (
      SELECT tr.*, CASE WHEN tr.ok THEN 'aprovada'
                        WHEN tr.aprovacao IS NULL AND tr.data_saida IS NOT NULL THEN 'em_teste'
                        ELSE 'pendente' END AS status
        FROM tr
    )
    SELECT jsonb_agg(jsonb_build_object(
             'modelo_id', m.id,
             'ref', m.ref,
             'nome', m.nome,
             'origem', m.origem,
             'colecao', public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao),
             'fotos_fontes', jsonb_build_array(m.fotos_modelo[1], m.desenho_tecnico_url, m.croqui_url),
             'explodido', EXISTS (SELECT 1 FROM public.cad k WHERE k.modelo_id = m.id AND k.enviado_corte),
             'trilhas', (SELECT jsonb_agg(jsonb_build_object('categoria_nome', x.cat_nome, 'empresa_nome', x.emp_nome,
                                                             'status', x.status,
                                                             'data_saida', CASE WHEN x.status = 'pendente' THEN NULL ELSE x.data_saida END)
                                          ORDER BY x.ordem, x.cat_nome, x.created_at, x.linha)
                           FROM st x WHERE x.modelo_id = m.id)
           ) ORDER BY m.ref NULLS LAST, m.nome, m.id)
      FROM public.modelos m
     WHERE m.tenant_id = _tenant AND NOT m.lancado
       -- card Reprovado (Dev OU Planejamento; o predicado canonico) sai do quadro (revisao T2, achado 6)
       AND NOT (lower(coalesce(m.status_desenvolvimento, '')) = 'reprovado' OR lower(coalesce(m.status_planejamento, '')) = 'reprovado')
       AND EXISTS (SELECT 1 FROM st x WHERE x.modelo_id = m.id AND x.status <> 'pendente')
  ), '[]'::jsonb);
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_quadro_core(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.peca_teste_quadro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] coluna Peca Teste do quadro PCP > Etapas, alimentada pela secao do card (Ruling 17/20): modulo Etapas PL; sem VER
  -- producao_etapas = [].
  PERFORM public._exige_modulos('etapas_pl');
  IF NOT public.user_can_view('producao_etapas') THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public._peca_teste_quadro_core(public.get_user_tenant_id());
END $function$;
REVOKE EXECUTE ON FUNCTION public.peca_teste_quadro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peca_teste_quadro() TO authenticated;

-- 2) funcoes EXISTENTES redefinidas (troca exata sobre o texto de ANTES)
CREATE OR REPLACE FUNCTION public.fn_peca_teste_trava_fornecedor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9a] P-312/spec: peca aprovada trava o fornecedor da tentativa = o da linha de M.O. (vale p/ o Salvar da M.O. e da Peca Teste).
  -- So morde com o tipo ainda exigindo peca teste (switch desligado = trilha escondida, nada travado).
  IF EXISTS (SELECT 1 FROM public.categorias_terceirizado c WHERE c.id = OLD.categoria_terceirizado_id AND c.exige_peca_teste)
     -- [urg r9b] (revisao T1, achado 1) a aprovada so trava com o fornecedor CONGELADO na decisao = o da linha (o predicado unico
     -- _peca_teste_aprovada, o mesmo da condicao do kanban e das leituras): aprovada "de outro fornecedor" nao vale nem trava.
     AND public._peca_teste_aprovada(OLD.id, OLD.categoria_terceirizado_id, OLD.empresa_id) THEN
    RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_trava_fornecedor()', '982769d4384a04d9a35d53db654667da', '{postgres=X/postgres,service_role=X/postgres}', false, true)
    ) AS x(f, m, acl, w, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9b: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.w
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9b: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_aprovada(uuid,uuid,uuid)', '417fa9850a5a52204f62476818dc408c', '417fa9850a5a52204f62476818dc408c', false),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', '5ae0f7025744d63508d7617e6e3a7487', false),
      ('public.peca_teste_modelo(uuid)', '9f5e9a528d3cac6deaf3c34133f5d56b', '693da711ec898bdbbc078439ecd1c46e', true),
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e1c6687045f8f7c9ae61caf8f', 'eccde92e1c6687045f8f7c9ae61caf8f', false),
      ('public.salvar_peca_teste(uuid,jsonb,jsonb)', '74edd9a64f98101476de545ac8361a81', '4c501cdcdbf99aed1da1aef6d82f853f', true),
      ('public._peca_teste_quadro_core(uuid)', '6e191644f2fb4acfea04e4ff76a6f5de', '1821c151ef5963eb95d90167c75ba249', false),
      ('public.peca_teste_quadro()', 'ad45b8479fb46de11ea265b7ef5a728a', 'd208d91fc9846fd221da953481966968', true)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r9b: pos-condicao falhou em % (nova; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public'
                     AND coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x), '') = CASE WHEN r.w AND true THEN 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres' ELSE 'postgres=X/postgres,service_role=X/postgres' END)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (r.w AND true)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9b: pos-condicao falhou na ACL/secdef/search_path de % (nova)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;

-- Achados MEDIOS, release R15a - P-214 B (dono 01/out): os "Faltou estoque" (cad.deficit_corte) que JA existem em producao
-- sao completados DE UMA VEZ no deploy, com a lista APROVADA pelo dono (precedente: correcao unica da release 8, P-166 A).
-- ESTA MIGRATION NAO COMPLETA NADA SOZINHA: so cria as pecas. O kit roda, DEPOIS da ida da R15a (o helper P-203 da
-- 20261025300000 tem de estar no ar) e da aprovacao do dono:
--   1. supabase/consultas/r15_deficit_corte_previa.sql  -> lista EXATA (cad|variante|metros), hash e esperado por loja;
--   2. o dono aprova;
--   3. BEGIN;
--      SET LOCAL app.confirmo_completar_faltas = 'sim';
--      SELECT public._p214_completar_faltas('<esperado aprovado, jsonb>'::jsonb, '<hash aprovado>');
--      COMMIT;
-- Objetos:
--   _bkp_p214_deficit (RLS sem policy, REVOKE ALL): 1 linha por cad tocado - lote, hash, deficit_corte antes/depois e os ids
--     das baixas criadas. A volta (_down) usa esta tabela; ela fica.
--   _p214_executar(): roda o helper _completar_deficit_corte_variante para TODA loja x variante com cad em deficit (trava do
--     corte de cada loja antes, com espera ate 3 s) e devolve o que foi baixado: linhas 'cad_id|variante_id|metros'
--     (round 4, ordem cad, variante), hash = md5 das linhas unidas por quebra de linha (lista vazia = md5('') =
--     d41d8cd98f00b204e9800998ecf8427e), esperado = {tenant_id: {cads, metros}}. Helper ocupado/adiado = P0001.
--   _p214_previa(): a MESMA conta num sub-bloco SEMPRE desfeito - previa exata (o helper de verdade, sem drift), nada fica.
--   _p214_completar_faltas(_esperado jsonb, _hash text, _tenant uuid DEFAULT NULL): exige SET LOCAL app.confirmo_completar_faltas='sim'; mesmo hash ja
--     aplicado (lote nao desfeito) = nada (idempotente); confere hash E contagens por loja de AGORA com os aprovados
--     (diferente = P0001 ASCII, nada fica); grava o backup; Auditoria: as linhas de audit_log das baixas e dos cad tocados
--     (gravadas pelo fn_audit com o autor da sessao do kit, sem JWT = vazio) ficam com user_nome 'Sistema' e descricao
--     'Sistema: correcao do sistema (P-214) - ...', + 1 linha-resumo por loja (dados.p214 = lote, hash, contagens);
--     RAISE NOTICE com as contagens.
--   As 3 funcoes: SECURITY DEFINER, EXECUTE revogado de PUBLIC, anon, authenticated e service_role (so o kit, como postgres).
-- Copia 54422 (01/out): 0 cad em deficit -> lista vazia, hash d41d8cd98f00b204e9800998ecf8427e, esperado {} (rodar = nada).
--
-- FIX ROUND 1 (revisao da P-214 B, 02/out): B-P1 a previa (consultas/r15_deficit_corte_previa.sql) chama _p214_previa UMA
--   vez (tabela temporaria) - lista e hash da MESMA rodada; B-P2 o _down pega a trava do corte da loja e FOR UPDATE no cad
--   antes de conferir; B-P3 a marca 'Sistema' so reescreve linhas de audit_log NASCIDAS na chamada (ids que nao existiam antes
--   dela) das baixas criadas / cad tocados - linha de usuario na mesma transacao fica; B-P4 REVOKE ALL na sequencia
--   _bkp_p214_deficit_id_seq (o REVOKE da tabela nao alcanca a sequencia da identidade; _bkp_custo_previsto nao tem
--   sequencia - nada a fazer na release 8); B-P6 o _down marca as linhas dele como 'Sistema: volta da correcao (P-214)';
--   B-P5 parametro opcional _tenant nas 3 funcoes (rodar loja a loja).
-- ORCAMENTO (B-P5): o helper P-203 tem orcamento de 4 s contados do inicio do comando (statement_timestamp()); na correcao o
--   comando e o SELECT do kit inteiro (esperas da trava de cada loja + todas as variantes). Lista grande em producao =
--   P0001 p214_helper_nao_rodou (adiado) - falha segura, nada fica. A previa de producao (mesma conta) mostra isso antes.
--   Saida: rodar previa + aprovacao + correcao LOJA A LOJA (_p214_previa(<tenant>) / _p214_completar_faltas(.., .., <tenant>)).
-- ROTEIRO / LIFO DO KIT (K1, K2, INFO da revisao):
--   IDA: 20261025100000 -> 20261025150000 -> 20261025200000 -> 20261025300000 -> 20261025310000 -> [previa -> aprovacao do
--     dono -> correcao P-214, LOGO depois da ida da 300000 e ANTES de liberar o site: senao o proprio P-203 completa parte dos
--     deficits no meio, com o autor = quem salvou a OC, e nao 'Sistema'] -> ... -> LEVES 20261028120000 (L6).
--     A correcao roda SOZINHA na transacao, sem JWT: BEGIN; SET LOCAL app.confirmo_completar_faltas='sim';
--     SELECT public._p214_completar_faltas('<esperado>'::jsonb, '<hash>'[, '<tenant>']); COMMIT;
--   Previa e execucao podem dar hash diferente sem ninguem mexer (FIFO desempata por created_at, igual para os itens da mesma
--     OC): o hash recusa (falha segura) - gerar a previa de novo.
--   VOLTA (LIFO): L6 _down (+ _down_drop se a volta da R15a for ate o drop: o _down_drop da 300000 exige os gatilhos de
--     ocs_tecido_itens sem os da L6) -> 310000 _down (dados) -> 310000 _down_drop (opcional) -> 300000 _down -> 300000
--     _down_drop -> 200000 _down -> 150000 _down -> 100000 _down.
--   FREIO DE EMERGENCIA: o _down da 300000 so neutraliza fn_completar_deficit_corte; com a L6 no ar,
--     fn_completar_deficit_corte_artigo e _reverter_ajuste_estoque_core continuam chamando o helper - o freio do kit TEM de
--     incluir o _down da L6 (ou neutralizar o helper).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._completar_deficit_corte_variante(uuid,uuid)  70a91eef1ac40cce86ff7da8e6b14c7f  INTOCADA (20261025300000, fix round 1)
--   public._p214_executar(uuid)                         NOVA: ausente ou e4210696604d2988ddd014ebd1bea61e (este arquivo)
--   public._p214_previa(uuid)                           NOVA: ausente ou d3afed7c86501dfcc77c2b3281e09d22 (este arquivo)
--   public._p214_completar_faltas(jsonb,text,uuid)       NOVA: ausente ou 727d640a3e3cfc4fafcd385aeb5fe583 (este arquivo)
-- =====================================================================================================================
-- Travas: CREATE TABLE + CREATE FUNCTION (nada em tabela existente). Volta: supabase/rollback/20261025310000_..._down.sql
-- (desfaz os lotes aplicados: apaga SO as baixas criadas por eles e devolve o deficit_corte) e _down_drop (DROP das 3
-- funcoes; a tabela de backup fica). LIFO: o _down roda ANTES do inverso da 20261025300000.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
BEGIN
  IF to_regprocedure('public._completar_deficit_corte_variante(uuid,uuid)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public._completar_deficit_corte_variante(uuid,uuid)'))) <> '70a91eef1ac40cce86ff7da8e6b14c7f' THEN
    RAISE EXCEPTION 'medios_r15a_p214: o helper P-203 nao esta com o texto da 20261025300000 (fix round 1) - aplicar a R15a antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._p214_executar()') IS NOT NULL OR to_regprocedure('public._p214_previa()') IS NOT NULL
     OR to_regprocedure('public._p214_completar_faltas(jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'medios_r15a_p214: texto do round 0 (sem _tenant) no banco - rodar o _down + _down_drop da 20261025310000 antes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._p214_executar(uuid)', 'e4210696604d2988ddd014ebd1bea61e'),
      ('public._p214_previa(uuid)', 'd3afed7c86501dfcc77c2b3281e09d22'),
      ('public._p214_completar_faltas(jsonb,text,uuid)', '727d640a3e3cfc4fafcd385aeb5fe583')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure(r.s))) <> r.m THEN
      RAISE EXCEPTION 'medios_r15a_p214: % existe com outro texto - outra frente mexeu', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE TABLE IF NOT EXISTS public._bkp_p214_deficit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote uuid NOT NULL,
  hash text NOT NULL,
  tenant_id uuid,
  cad_id uuid NOT NULL,
  deficit_antes jsonb,
  deficit_depois jsonb,
  baixa_ids uuid[] NOT NULL DEFAULT '{}',
  criado_at timestamptz NOT NULL DEFAULT now(),
  revertido_at timestamptz
);
ALTER TABLE public._bkp_p214_deficit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_p214_deficit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public._bkp_p214_deficit_id_seq FROM PUBLIC, anon, authenticated, service_role;   -- B-P4

CREATE OR REPLACE FUNCTION public._p214_executar(_tenant uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '3s'
AS $function$
-- [medios R15a P-214 B] Roda o _completar_deficit_corte_variante (P-203) para TODA loja x variante que tem cad enviado ao
-- corte com deficit_corte, e devolve o que de fato foi baixado: {linhas, hash, esperado, cads, baixa_ids, antes}.
--   linhas  = textos 'cad_id|variante_id|metros' (metros = round(soma das baixas novas do cad na variante, 4)), em ordem;
--   hash    = md5(linhas unidas por quebra de linha) - lista vazia = md5('');
--   esperado= {tenant_id: {cads, metros}} (metros = round(soma, 4) em texto).
-- Pega antes a trava do corte de cada loja envolvida (pg_advisory_xact_lock, ESPERA ate lock_timeout 3 s): ninguem corta no
-- meio e o helper (que usa a versao try) nunca acha a loja ocupada. Helper ocupado/adiado = P0001 (nada fica).
-- NAO e chamada direto: _p214_previa() desfaz tudo; _p214_completar_faltas() confere e grava.
-- _tenant (opcional, fix round 1 B-P5): so essa loja (lista grande demais para o orcamento do helper = rodar loja a loja).
DECLARE
  r record;
  v jsonb;
  v_antes jsonb;
  v_baixas_antes uuid[];
  v_linhas text[];
  v_esperado jsonb;
  v_ids uuid[];
  v_cads uuid[];
BEGIN
  SELECT COALESCE(array_agg(cd.id ORDER BY cd.id), ARRAY[]::uuid[]),
         COALESCE(jsonb_object_agg(cd.id::text, cd.deficit_corte), '{}'::jsonb)
    INTO v_cads, v_antes
    FROM public.cad cd
   WHERE cd.enviado_corte
     AND (_tenant IS NULL OR cd.tenant_id = _tenant)
     AND (CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array' THEN jsonb_array_length(cd.deficit_corte) > 0 ELSE false END);
  SELECT COALESCE(array_agg(b.id), ARRAY[]::uuid[]) INTO v_baixas_antes
    FROM public.estoque_tecido_baixas b WHERE b.cad_id = ANY (v_cads);

  FOR r IN SELECT DISTINCT cd.tenant_id FROM public.cad cd WHERE cd.id = ANY (v_cads) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtext('corte_tenant:' || r.tenant_id::text));
  END LOOP;

  FOR r IN
    SELECT DISTINCT cd.tenant_id, ctv.variante_tecido_id AS vid
      FROM public.cad cd
      JOIN public.cad_tecidos ct ON ct.cad_id = cd.id
      JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
     WHERE cd.id = ANY (v_cads) AND ctv.variante_tecido_id IS NOT NULL
     ORDER BY 1, 2
  LOOP
    v := public._completar_deficit_corte_variante(r.tenant_id, r.vid);
    IF COALESCE((v->>'ocupado')::boolean, false) OR COALESCE((v->>'adiado')::boolean, false) THEN
      RAISE EXCEPTION 'p214_helper_nao_rodou: loja % variante % (%)', r.tenant_id, r.vid, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  WITH novas AS (
    SELECT b.id, b.tenant_id, b.cad_id, b.variante_tecido_id, b.quantidade
      FROM public.estoque_tecido_baixas b
     WHERE b.cad_id = ANY (v_cads) AND NOT (b.id = ANY (v_baixas_antes))
  ), por_cad AS (
    SELECT tenant_id, cad_id, variante_tecido_id, round(SUM(quantidade), 4) AS m FROM novas GROUP BY 1, 2, 3
  ), por_loja AS (
    SELECT tenant_id, count(DISTINCT cad_id) AS cads, round(SUM(m), 4) AS m FROM por_cad GROUP BY 1
  )
  SELECT (SELECT COALESCE(array_agg(cad_id::text || '|' || variante_tecido_id::text || '|' || m::text
                                    ORDER BY cad_id::text, variante_tecido_id::text), ARRAY[]::text[]) FROM por_cad),
         (SELECT COALESCE(jsonb_object_agg(tenant_id::text, jsonb_build_object('cads', cads, 'metros', m::text)), '{}'::jsonb) FROM por_loja),
         (SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM novas)
    INTO v_linhas, v_esperado, v_ids;

  RETURN jsonb_build_object(
    'linhas', to_jsonb(v_linhas),
    'hash', md5(array_to_string(v_linhas, E'\n')),
    'esperado', v_esperado,
    'baixa_ids', to_jsonb(v_ids),
    'antes', v_antes);
END;
$function$;

CREATE OR REPLACE FUNCTION public._p214_previa(_tenant uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R15a P-214 B] PREVIA EXATA, sem gravar nada: roda _p214_executar() (o helper de verdade) num sub-bloco que e
-- SEMPRE desfeito no fim (RAISE de sentinela + EXCEPTION) e devolve {linhas, hash, esperado}: o que a correcao unica
-- faria AGORA. Usada por supabase/consultas/r15_deficit_corte_previa.sql (que ainda termina em ROLLBACK).
DECLARE
  v jsonb;
BEGIN
  BEGIN
    v := public._p214_executar(_tenant);
    RAISE EXCEPTION 'p214_previa_desfaz' USING ERRCODE = 'P0R14';
  EXCEPTION WHEN SQLSTATE 'P0R14' THEN
    NULL;  -- tudo o que o helper gravou foi desfeito; v ficou
  END;
  RETURN jsonb_build_object('linhas', v->'linhas', 'hash', v->>'hash', 'esperado', v->'esperado');
END;
$function$;

CREATE OR REPLACE FUNCTION public._p214_completar_faltas(_esperado jsonb, _hash text, _tenant uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R15a P-214 B, dono 01/out] CORRECAO UNICA: completa os "Faltou estoque" que JA existem, com a lista APROVADA.
-- So roda com SET LOCAL app.confirmo_completar_faltas = 'sim' na mesma transacao. Confere hash e contagens por loja da
-- lista de AGORA (= _p214_previa) contra as aprovadas; diferente = P0001 e nada fica. Mesmo hash ja aplicado (lote nao
-- desfeito) = nada a fazer (idempotente). Grava o lote em _bkp_p214_deficit (deficit antes/depois por cad + ids das baixas
-- criadas) e marca a Auditoria: as linhas de audit_log das baixas e dos cad tocados ficam com user_nome 'Sistema' e a
-- descricao prefixada 'Sistema: correcao do sistema (P-214) - ', + 1 linha-resumo por loja.
-- [fix round 1] B-P3: so as linhas de audit_log NASCIDAS nesta chamada (ids de audit_log que nao existiam antes dela) e
-- das baixas criadas / cad tocados - uma linha de usuario na mesma transacao NAO e reescrita. B-P5: _tenant opcional
-- (rodar loja a loja quando a lista e grande demais para o orcamento de 4 s do helper).
DECLARE
  v jsonb;
  v_lote uuid := gen_random_uuid();
  v_cads uuid[];
  v_ids uuid[];
  v_n int;
  v_aud_antes uuid[];
  r record;
BEGIN
  IF current_setting('app.confirmo_completar_faltas', true) IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION 'p214_sem_confirmacao: rode com SET LOCAL app.confirmo_completar_faltas = sim' USING ERRCODE = 'P0001';
  END IF;
  IF _hash IS NULL OR _esperado IS NULL OR jsonb_typeof(_esperado) <> 'object' THEN
    RAISE EXCEPTION 'p214_parametros: informe o esperado (objeto) e o hash aprovados' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public._bkp_p214_deficit k WHERE k.hash = _hash AND k.revertido_at IS NULL
              AND (_tenant IS NULL OR k.tenant_id = _tenant))
     AND _hash <> md5('') THEN
    RAISE NOTICE 'p214: lista % ja aplicada (lote nao desfeito) - nada a fazer', _hash;
    RETURN jsonb_build_object('ja_aplicado', true, 'cads', 0, 'metros', 0);
  END IF;

  -- (B-P3) linhas de audit_log desta transacao que ja existiam ANTES desta chamada: nunca sao reescritas
  SELECT COALESCE(array_agg(a.id), ARRAY[]::uuid[]) INTO v_aud_antes
    FROM public.audit_log a WHERE a.created_at = now() AND a.tabela IN ('cad', 'estoque_tecido_baixas');

  v := public._p214_executar(_tenant);
  IF v->>'hash' IS DISTINCT FROM _hash OR (v->'esperado') IS DISTINCT FROM _esperado THEN
    RAISE EXCEPTION 'p214_lista_mudou: hash de agora % (aprovado %), contagens de agora % (aprovadas %) - regerar a previa e aprovar de novo',
      v->>'hash', _hash, v->'esperado', _esperado USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT split_part(l, '|', 1)::uuid), ARRAY[]::uuid[])
    INTO v_cads FROM jsonb_array_elements_text(v->'linhas') l;
  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_ids FROM jsonb_array_elements_text(v->'baixa_ids') x;
  v_n := cardinality(v_cads);

  INSERT INTO public._bkp_p214_deficit (lote, hash, tenant_id, cad_id, deficit_antes, deficit_depois, baixa_ids)
  SELECT v_lote, _hash, cd.tenant_id, cd.id, v->'antes'->(cd.id::text), cd.deficit_corte,
         ARRAY(SELECT b.id FROM public.estoque_tecido_baixas b WHERE b.cad_id = cd.id AND b.id = ANY (v_ids) ORDER BY b.id)
    FROM public.cad cd WHERE cd.id = ANY (v_cads);

  -- Auditoria: quem gravou foi o sistema (P-214), nao a sessao do kit
  UPDATE public.audit_log a
     SET user_nome = 'Sistema',
         descricao = 'Sistema: correcao do sistema (P-214) - ' || COALESCE(a.descricao, '')
   WHERE a.created_at = now()
     AND NOT (a.id = ANY (v_aud_antes))
     AND ((a.tabela = 'estoque_tecido_baixas' AND a.registro_id = ANY (v_ids))
          OR (a.tabela = 'cad' AND a.registro_id = ANY (v_cads)));
  FOR r IN SELECT key AS tenant_id, value FROM jsonb_each(v->'esperado') LOOP
    INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
    VALUES (r.tenant_id::uuid, NULL, 'Sistema', 'editar', 'CAD', 'cad', NULL,
            'Sistema: correcao do sistema (P-214) - faltas do corte completadas: ' || (r.value->>'cads') || ' corte(s), '
              || (r.value->>'metros') || ' m',
            jsonb_build_object('p214', jsonb_build_object('lote', v_lote, 'hash', _hash, 'cads', r.value->'cads',
                                                          'metros', r.value->'metros')));
  END LOOP;

  RAISE NOTICE 'p214: % corte(s) completado(s), % baixa(s), hash %, por loja %', v_n, cardinality(v_ids), _hash, v->'esperado';
  RETURN jsonb_build_object('lote', v_lote, 'cads', v_n, 'baixas', cardinality(v_ids), 'hash', _hash, 'esperado', v->'esperado');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._p214_executar(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._p214_previa(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._p214_completar_faltas(jsonb,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._p214_executar(uuid)', 'e4210696604d2988ddd014ebd1bea61e'),
      ('public._p214_previa(uuid)', 'd3afed7c86501dfcc77c2b3281e09d22'),
      ('public._p214_completar_faltas(jsonb,text,uuid)', '727d640a3e3cfc4fafcd385aeb5fe583')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r15a_p214: pos-condicao falhou - % nao ficou com o texto deste arquivo', r.s USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.s, 'EXECUTE') OR has_function_privilege('authenticated', r.s, 'EXECUTE')
       OR has_function_privilege('service_role', r.s, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15a_p214: % ficou executavel por PUBLIC/anon/authenticated/service_role (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public._bkp_p214_deficit', 'SELECT') OR has_table_privilege('anon', 'public._bkp_p214_deficit', 'SELECT') THEN
    RAISE EXCEPTION 'medios_r15a_p214: _bkp_p214_deficit legivel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF has_sequence_privilege('anon', 'public._bkp_p214_deficit_id_seq', 'USAGE,SELECT,UPDATE')
     OR has_sequence_privilege('authenticated', 'public._bkp_p214_deficit_id_seq', 'USAGE,SELECT,UPDATE')
     OR has_sequence_privilege('service_role', 'public._bkp_p214_deficit_id_seq', 'USAGE,SELECT,UPDATE') THEN
    RAISE EXCEPTION 'medios_r15a_p214: sequencia _bkp_p214_deficit_id_seq com privilegio para anon/authenticated/service_role (B-P4)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

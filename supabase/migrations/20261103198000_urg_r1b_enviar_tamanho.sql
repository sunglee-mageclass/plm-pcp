-- Urgentes R1b - correcao UNICA do "a enviar" (cad_etiquetas.quantidade_enviar) dos insumos vinculados a UM tamanho que ja
-- estavam na Explosao antes da Onda 1 (P-337 A, 06/out). GERADO por .superpowers/sdd/2026-10-06-r1b/gerar/gerar.py (nunca editar a mao; rode o gerador de novo).
-- Brief: .superpowers/sdd/2026-10-06-r1b/brief.md (padrao da 170500 / P-166 / I3c: lista aprovada + hash + GUC + backup + volta).
-- Por que: a R1 (170000/171000) faz a Explosao mostrar a "necessaria" = consumo x pecas DO TAMANHO (linhaInsumoExplosao), mas o
-- "a enviar" e GRAVADO; nos CADs ja na Explosao antes do deploy ele ficou = consumo x grade TOTAL (Ruling A6: sem retroatividade).
-- Esta migration NAO muda dado e NAO redefine nenhuma funcao existente: cria
--   1) public._bkp_urg_r1b_enviar (backup antes/depois por linha de cad_etiquetas; RLS ligada SEM policy; REVOKE ALL de PUBLIC, anon,
--      authenticated, service_role);
--   2) _urg_r1b_enviar_previa() (STABLE, DEFINER): a lista com o veredito por linha (grade do CAD que nao fecha = grade_incompleta,
--      NAO elegivel), a linha canonica e aviso/info (so informativos) - lida pelo Passo 0 do kit em
--      supabase/consultas/urg_r1b_enviar_previa.sql;
--   3) _urg_r1b_enviar_rodar(_aprovado jsonb, _hash text, _n int) (DEFINER): a correcao, que o KIT roda com a lista aprovada:
--        psql -X -v ON_ERROR_STOP=1 -v lista=... -v hash=... -v n=... -f supabase/consultas/urg_r1b_enviar_rodar.sql
--      (UM comando nao interativo: BEGIN, timeouts, SET LOCAL app.confirmo_enviar_tamanho = 'sim', SELECT _rodar(...), COMMIT)
--      (sem a GUC recusa; hash/n da lista de agora diferentes do aprovado = P0001 lista_mudou e nada grava; grava SO os aprovados
--      que ainda passam; trava card -> CAD -> cad -> cad_etiquetas como a R4; idempotente).
-- As 2 funcoes: SECURITY DEFINER, search_path=public, EXECUTE revogado de PUBLIC, anon, authenticated. Usam SO os helpers da
-- 20261103170000 (_insumo_tamanho_de, _insumo_pecas, _grade_mapa_cad) - a regra do vinculo nao e reimplementada.
-- Efeito DA CORRECAO (nao desta migration): so CAD NAO enviado ao PCP muda; estoque/extrato nao mudam (a baixa de insumo e o
-- estoque_mov_log so leem CAD enviado); sobe o rev do CAD (Explosao aberta recarrega via P0409) e enfileira o kanban do card.
-- Trava desta migration: so catalogo e a tabela NOVA (CREATE TABLE/FUNCTION; AccessShare em cad_etiquetas, cad, etiquetas, modelos,
-- cad_grades pela validacao do corpo SQL da previa - nao bloqueia leitura nem escrita). MEDIDO na copia (por diferenca de
-- pg_locks): nada em auth/storage/realtime. Qualquer hora. Idempotente.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._urg_r1b_enviar_previa()  DEPOIS 1158cdbfeaf90192295dfc9f4fdd9295  NEUTRO db45b0b5ef1f5d901d6d916231d7b922
--   public._urg_r1b_enviar_rodar(jsonb,text,integer)  DEPOIS a2e58118486c39206fbcf31f192f1e06  NEUTRO ee1f3f18beed61a257e00937e543ac29
--   (ANTES: ausentes) - exige a 20261103170000 viva (md5 dos 4 helpers usados conferidos abaixo)
-- ====================================================================================
-- Volta (LIFO): supabase/rollback/20261103198000_urg_r1b_enviar_tamanho_down.sql (devolve o "antes" SO onde ainda vale o "depois" e o
-- CAD segue fora do PCP, relata o resto e NEUTRALIZA as 2 funcoes; a tabela de backup fica). DROP:
-- supabase/rollback/20261103198000_urg_r1b_enviar_tamanho_down_drop.sql (opcional, depois; apagar o backup com linhas exige
-- a GUC app.confirmo_apagar_backup_enviar_tamanho = 'sim' na SESSAO: PGOPTIONS='-c app.confirmo_apagar_backup_enviar_tamanho=sim'
-- psql ... -f <_down_drop> - o arquivo abre o proprio BEGIN, um SET LOCAL de fora nao vale).
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
      ('public._insumo_tamanho_efetivo(text,text,boolean)', 'c3cdade8a88d585492eeb6a01205ce3e'),
      ('public._insumo_pecas(text,jsonb,numeric)', '2e1b701be975366933e9ad704cb25c18'),
      ('public._insumo_tamanho_de(uuid)', '46fd6f65599f7de2d3ab12777fefa7d1'),
      ('public._grade_mapa_cad(uuid,boolean)', '44224a78f86abff7ac18f8e2051a7067')
    ) AS x(f, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r1b_198000: % ausente ou com texto inesperado - a 20261103170000 tem de estar viva', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                   AND column_name = 'tamanho_vinculado' AND data_type = 'text') THEN
    RAISE EXCEPTION 'urg_r1b_198000: coluna etiquetas.tamanho_vinculado ausente - a 20261103170000 tem de estar viva' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._urg_r1b_enviar_previa()', '1158cdbfeaf90192295dfc9f4fdd9295', 'db45b0b5ef1f5d901d6d916231d7b922'),
      ('public._urg_r1b_enviar_rodar(jsonb,text,integer)', 'a2e58118486c39206fbcf31f192f1e06', 'ee1f3f18beed61a257e00937e543ac29')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r1b_198000: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public._bkp_urg_r1b_enviar') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = to_regclass('public._bkp_urg_r1b_enviar') AND a.attnum > 0 AND NOT a.attisdropped)
         IS DISTINCT FROM 'id:bigint:true,cad_etiqueta_id:uuid:true,cad_id:uuid:true,tenant_id:uuid:true,antes:numeric:true,depois:numeric:true,rodado_em:timestamp with time zone:true,restaurado_em:timestamp with time zone:false' THEN
    RAISE EXCEPTION 'urg_r1b_198000: public._bkp_urg_r1b_enviar ja existe com outro formato' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE TABLE IF NOT EXISTS public._bkp_urg_r1b_enviar (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cad_etiqueta_id uuid        NOT NULL,
  cad_id          uuid        NOT NULL,
  tenant_id       uuid        NOT NULL,
  antes           numeric     NOT NULL,
  depois          numeric     NOT NULL,
  rodado_em       timestamptz NOT NULL DEFAULT now(),
  restaurado_em   timestamptz
);
COMMENT ON TABLE public._bkp_urg_r1b_enviar IS
  'Correcao unica do a enviar dos insumos vinculados a um tamanho (urg R1b, P-337 A, 20261103198000): quantidade_enviar de cada linha de cad_etiquetas ANTES e DEPOIS de _urg_r1b_enviar_rodar. O _down devolve o antes onde ainda vale o depois (CAD fora do PCP) e marca restaurado_em (cada gravacao volta uma vez so). RLS sem policy e sem grant: so o dono (postgres) le.';
ALTER TABLE public._bkp_urg_r1b_enviar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_urg_r1b_enviar FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public._bkp_urg_r1b_enviar_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._urg_r1b_enviar_previa()
 RETURNS TABLE(tenant_id uuid, cad_id uuid, cad_etiqueta_id uuid, modelo_id uuid, modelo text, insumo text, tamanho text, consumo numeric, total numeric, pecas numeric, antigo numeric, necessaria numeric, atual numeric, antes numeric, depois numeric, elegivel boolean, motivo text, situacao text, aviso text, info text, linha text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r1b] lista da correcao unica do "a enviar" dos insumos vinculados a UM tamanho (P-337 A). Universo: toda linha de
  -- cad_etiquetas (todas as lojas) cujo insumo tem tamanho_vinculado nao vazio. ELEGIVEL = todas:
  --   (0) CAD de modelo INTERNO (revenda/importado: a Explosao mostra a grade PEDIDA e a materializacao da A7 usa a RECEBIDA -
  --       sem paridade provada => revenda_importado_sem_paridade); CAD com modelo (cad_sem_modelo); insumo da mesma loja do CAD;
  --   (1) CAD NAO enviado ao PCP (enviado_ao_pcp);
  --   (2) vinculo EFETIVO pelo helper da 170000 (_insumo_tamanho_de; insumo com tamanho proprio => sem_vinculo_efetivo);
  --   (2a) grade do CAD COERENTE (grade_incompleta): toda linha de cad_grades tem soma das celulas validas (numero >= 0 em texto, a
  --        regra de celula dos helpers) = grade_total_planejada, tolerancia 0,0001 - grade so com total (sem celulas) ou que nao fecha
  --        deixa as pecas do tamanho DESCONHECIDAS (nao 0): nao corrige; quando a grade for completada no Sheet, o Salvar pos-R1
  --        regrava o "a enviar" pela regra nova. So "fora da grade" com grade coerente (o modelo nao tem a peca) pode ir a 0;
  --   (2b) enviar_por_tamanho vazio (enviar_por_tamanho_preenchido) e "a enviar" gravado (a_enviar_vazio: a Explosao ja mostra
  --        a necessaria nova como padrao);
  --   (3) "a enviar" = o AUTOMATICO ANTIGO round(consumo x grade total planejada do CAD, 2) (o Sheet/Dev gravavam round4(consumo x
  --       soma de grade_total) no salvar_cad_completo, que grava as MESMAS linhas em cad_grades; a coluna e numeric(10,2); a Explosao
  --       sem edicao regrava o mesmo) - tolerancia 0,0001 (editado_a_mao);
  --   (4) depois = round(consumo x pecas do tamanho, 2): pecas = _insumo_pecas(_insumo_tamanho_de, _grade_mapa_cad(cad, false), soma de
  --       grade_total_planejada) - a "necessaria" da Explosao (linhaInsumoExplosao: grades_planejadas/grade_total_planejada do CAD);
  --   (5) antes <> depois (ja_no_valor_novo - conferido ANTES do (3): linha ja no valor novo nao conta como editada a mao).
  -- antes = o valor gravado; se a linha ja foi corrigida (gravacao EM VIGOR no backup e o valor de hoje = o "depois" dela) antes = o
  -- "antes" do backup e situacao = ja_corrigido: a lista (e o hash) seguem iguais depois da correcao => 2a execucao = 0 (idempotente).
  -- aviso (SO informativo, fora do hash): fora_da_grade (tamanho sem pecas na grade do CAD => depois 0) | grade_sem_celulas (grade so
  -- com total, sem celula por tamanho; com a regra (2a) so aparece em linha NAO elegivel).
  -- info (SO informativo, fora do hash): editado_a_mao => gravado x automatico antigo (e, se o gravado e consumo x N inteiro, "parece
  -- automatico de outra grade": grade mudou depois sem regravar o CAD - corrigir pelo Sheet); grade_incompleta => as variantes que nao
  -- fecham (celulas x total).
  -- linha = tenant_id|cad_id|cad_etiqueta_id|modelo (ref ou nome)|insumo|tamanho|antes|depois (2 casas); o hash aprovado = md5 das
  -- linhas elegiveis unidas por quebra de linha na ordem (tenant_id, cad_id, cad_etiqueta_id). Previa: supabase/consultas/urg_r1b_enviar_previa.sql.
  WITH base AS (
    SELECT c.tenant_id,
           ce.cad_id,
           ce.id AS cad_etiqueta_id,
           c.modelo_id,
           m.id AS m_id,
           coalesce(nullif(btrim(CAST(m.ref AS text)), ''), CAST(m.nome AS text), '') AS modelo,
           coalesce(CAST(e.nome AS text), '') AS insumo,
           e.tenant_id AS etq_tenant,
           coalesce(m.origem, 'interno') AS origem,
           coalesce(c.enviado_corte, false) AS enviado,
           public._insumo_tamanho_de(ce.etiqueta_id) AS tam,
           coalesce(ce.consumo, 0) AS consumo,
           ce.quantidade_enviar AS atual,
           coalesce(ce.enviar_por_tamanho, '{}'::jsonb) AS ept,
           (SELECT coalesce(sum(coalesce(g.grade_total_planejada, 0)), 0) FROM public.cad_grades g WHERE g.cad_id = ce.cad_id) AS total,
           public._grade_mapa_cad(ce.cad_id, false) AS mapa,
           (SELECT string_agg('variante ' || g.variante_numero || ': celulas ' || trim_scale(s.soma) || ' de total '
                              || coalesce(g.grade_total_planejada, 0), '; ' ORDER BY g.variante_numero)
              FROM public.cad_grades g
              CROSS JOIN LATERAL (SELECT coalesce(sum(kv.value::numeric), 0) AS soma
                                    FROM jsonb_each_text(CASE WHEN jsonb_typeof(g.grades_planejadas) = 'object'
                                                              THEN g.grades_planejadas ELSE '{}'::jsonb END) kv
                                   WHERE kv.value ~ '^[0-9]+(\.[0-9]+)?$') s
             WHERE g.cad_id = ce.cad_id AND abs(s.soma - coalesce(g.grade_total_planejada, 0)) > 0.0001) AS grade_furo,
           k.antes AS k_antes,
           k.depois AS k_depois
      FROM public.cad_etiquetas ce
      JOIN public.cad c ON c.id = ce.cad_id
      JOIN public.etiquetas e ON e.id = ce.etiqueta_id
      LEFT JOIN public.modelos m ON m.id = c.modelo_id
      LEFT JOIN LATERAL (SELECT b.antes, b.depois
                           FROM public._bkp_urg_r1b_enviar b
                          WHERE b.cad_etiqueta_id = ce.id AND b.restaurado_em IS NULL
                          ORDER BY b.rodado_em DESC, b.id DESC
                          LIMIT 1) k ON true
     WHERE nullif(btrim(e.tamanho_vinculado), '') IS NOT NULL
  ), calc AS (
    SELECT b.*,
           public._insumo_pecas(b.tam, b.mapa, b.total) AS pecas,
           round(b.consumo * b.total, 2) AS antigo,
           b.consumo * public._insumo_pecas(b.tam, b.mapa, b.total) AS necessaria,
           round(b.consumo * public._insumo_pecas(b.tam, b.mapa, b.total), 2) AS depois,
           (b.k_depois IS NOT NULL AND b.atual IS NOT DISTINCT FROM b.k_depois) AS corrigido,
           CASE WHEN b.k_depois IS NOT NULL AND b.atual IS NOT DISTINCT FROM b.k_depois THEN b.k_antes ELSE b.atual END AS antes
      FROM base b
  ), cls AS (
    SELECT x.*,
           CASE WHEN x.modelo_id IS NULL OR x.m_id IS NULL THEN 'cad_sem_modelo'
                WHEN x.etq_tenant IS DISTINCT FROM x.tenant_id THEN 'insumo_de_outra_loja'
                WHEN x.origem <> 'interno' THEN 'revenda_importado_sem_paridade'
                WHEN x.enviado THEN 'enviado_ao_pcp'
                WHEN x.tam IS NULL THEN 'sem_vinculo_efetivo'
                WHEN x.grade_furo IS NOT NULL THEN 'grade_incompleta'
                WHEN x.ept <> '{}'::jsonb THEN 'enviar_por_tamanho_preenchido'
                WHEN x.antes IS NULL THEN 'a_enviar_vazio'
                WHEN abs(x.antes - x.depois) <= 0.0001 THEN 'ja_no_valor_novo'
                WHEN abs(x.antes - x.antigo) > 0.0001 THEN 'editado_a_mao'
           END AS motivo
      FROM calc x
  )
  SELECT c.tenant_id, c.cad_id, c.cad_etiqueta_id, c.modelo_id, c.modelo, c.insumo, c.tam, c.consumo, c.total, c.pecas,
         c.antigo, c.necessaria, c.atual, c.antes, c.depois,
         c.motivo IS NULL,
         c.motivo,
         CASE WHEN c.motivo IS NOT NULL THEN NULL WHEN c.corrigido THEN 'ja_corrigido' ELSE 'a_corrigir' END,
         CASE WHEN c.tam IS NOT NULL AND c.total > 0 AND c.pecas = 0
              THEN CASE WHEN c.mapa = '{}'::jsonb THEN 'grade_sem_celulas' ELSE 'fora_da_grade' END END,
         CASE WHEN c.motivo = 'editado_a_mao'
              THEN 'gravado ' || CAST(round(c.antes, 2) AS text) || ' x automatico antigo ' || CAST(c.antigo AS text)
                   || CASE WHEN c.consumo > 0 AND mod(c.antes, c.consumo) = 0
                           THEN ' (= consumo x ' || trim_scale(c.antes / c.consumo) || ' pecas: parece automatico de outra grade)'
                           ELSE '' END
              WHEN c.motivo = 'grade_incompleta' THEN c.grade_furo END,
         coalesce(CAST(c.tenant_id AS text), '') || '|' || CAST(c.cad_id AS text) || '|' || CAST(c.cad_etiqueta_id AS text) || '|'
           || c.modelo || '|' || c.insumo || '|' || coalesce(c.tam, '') || '|' || coalesce(CAST(round(c.antes, 2) AS text), '') || '|'
           || CAST(c.depois AS text)
    FROM cls c
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1b_enviar_previa() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._urg_r1b_enviar_rodar(_aprovado jsonb, _hash text, _n integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r1b] correcao UNICA do "a enviar" (cad_etiquetas.quantidade_enviar) dos insumos vinculados a UM tamanho (P-337 A), SO com a
-- lista aprovada pelo dono (padrao da 170500 / P-166):
--   BEGIN, SET LOCAL app.confirmo_enviar_tamanho = 'sim', SELECT _urg_r1b_enviar_rodar(<linhas>, <hash_lista>, <n>), COMMIT -
--   SEMPRE pelo rodador NAO interativo supabase/consultas/urg_r1b_enviar_rodar.sql (psql -f, com idle_in_transaction/statement/lock
--   timeouts): as travas abaixo (inclusive SHARE em variantes_etiqueta de TODAS as lojas) nao podem ficar presas numa txn aberta.
-- _aprovado = array jsonb das linhas canonicas aprovadas (todas ou parte das elegiveis da previa); _hash/_n = o hash_lista e o n da
-- previa INTEIRA. 1) sem a GUC: recusa. 2) travas, na ORDEM UNICA da R4 (anti-deadlock): advisory do CARD
-- (hashtext('cad:modelo_id:'||modelo_id), por modelo_id) -> advisory do CAD (hashtext(cad_id), por cad_id) -> linhas de cad FOR
-- UPDATE -> linhas de cad_etiquetas FOR UPDATE (os CADs candidatos: internos, nao enviados ao PCP, com insumo vinculado) ->
-- variantes_etiqueta SHARE -> etiquetas vinculadas FOR SHARE (a regra do vinculo nao muda no meio). 3) recalcula a lista de agora e
-- confere hash e n: divergiu = P0001 lista_mudou (nada grava). 4) linha aprovada fora da lista de agora = P0001 fora_da_lista.
-- 5) grava SO os aprovados ainda elegiveis, a_corrigir, sem gravacao EM VIGOR no backup e com o valor de hoje = o "antes" da
-- linha (quantidade_enviar := depois), com backup antes/depois em _bkp_urg_r1b_enviar.
-- Devolve {gravados, pulados:[{id, motivo}], hash, n}; motivo = o da lista | nao_aprovado | ja_corrigido_antes (gravacao em vigor no
-- backup: nunca corrige de novo o que a pessoa mexeu depois). Idempotente: a 2a execucao grava 0.
-- Gatilhos de cad_etiquetas que disparam: trg_colab_bump_cad_etq (rev do CAD sobe: Explosao aberta leva P0409 no proximo Salvar e
-- recarrega), trg_kanban_fila_upd (enfileira o card), trg_estoque_mov_log_upd (SO loga CAD enviado ao PCP - aqui nenhum: estoque
-- e extrato nao mudam; a baixa de insumo so le cad_etiquetas de CAD enviado).
DECLARE
  v_aprov text[];
  v_cads uuid[];
  v_hash text;
  v_n integer;
  v_fora integer;
  v_fora_ids text;
  v_gravados integer := 0;
  v_pulados jsonb;
BEGIN
  IF coalesce(current_setting('app.confirmo_enviar_tamanho', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'confirmacao_ausente: rode dentro de BEGIN com SET LOCAL app.confirmo_enviar_tamanho = sim'
      USING ERRCODE = 'P0001';
  END IF;
  IF _aprovado IS NULL OR jsonb_typeof(_aprovado) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_aprovado) x WHERE jsonb_typeof(x) <> 'string') THEN
    RAISE EXCEPTION 'lista_invalida: _aprovado tem de ser um array jsonb de linhas canonicas (texto)' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(x ORDER BY x), '{}'::text[]) INTO v_aprov FROM jsonb_array_elements_text(_aprovado) x;
  IF cardinality(v_aprov) <> (SELECT count(DISTINCT x) FROM unnest(v_aprov) x) THEN
    RAISE EXCEPTION 'lista_invalida: linha repetida na lista aprovada' USING ERRCODE = 'P0001';
  END IF;

  -- espera de trava: a do chamador (o rodador do kit poe 1500ms); sem nenhuma (0), no maximo 3 s
  IF current_setting('lock_timeout') IN ('0', '0ms') THEN
    PERFORM set_config('lock_timeout', '3s', true);
  END IF;
  SELECT coalesce(array_agg(DISTINCT c.id), '{}'::uuid[]) INTO v_cads
    FROM public.cad_etiquetas ce
    JOIN public.cad c ON c.id = ce.cad_id
    JOIN public.etiquetas e ON e.id = ce.etiqueta_id
    JOIN public.modelos m ON m.id = c.modelo_id
   WHERE nullif(btrim(e.tamanho_vinculado), '') IS NOT NULL
     AND NOT coalesce(c.enviado_corte, false)
     AND coalesce(m.origem, 'interno') = 'interno';
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || x.modelo_id::text))
     FROM (SELECT DISTINCT c.modelo_id FROM public.cad c WHERE c.id = ANY (v_cads) AND c.modelo_id IS NOT NULL ORDER BY c.modelo_id) x;
  PERFORM pg_advisory_xact_lock(hashtext(x.id::text))
     FROM (SELECT c.id FROM public.cad c WHERE c.id = ANY (v_cads) ORDER BY c.id) x;
  PERFORM 1 FROM public.cad c WHERE c.id = ANY (v_cads) ORDER BY c.id FOR UPDATE;
  PERFORM 1 FROM public.cad_etiquetas ce WHERE ce.cad_id = ANY (v_cads) ORDER BY ce.id FOR UPDATE;
  LOCK TABLE public.variantes_etiqueta IN SHARE MODE;
  PERFORM 1 FROM public.etiquetas e WHERE nullif(btrim(e.tamanho_vinculado), '') IS NOT NULL ORDER BY e.id FOR SHARE;

  SELECT md5(coalesce(string_agg(p.linha, E'\n' ORDER BY p.tenant_id, p.cad_id, p.cad_etiqueta_id), '')), count(*)::integer
    INTO v_hash, v_n
    FROM public._urg_r1b_enviar_previa() p
   WHERE p.elegivel;
  IF v_hash IS DISTINCT FROM _hash OR v_n IS DISTINCT FROM _n THEN
    RAISE EXCEPTION 'lista_mudou: a lista de agora tem hash % e n % (aprovado: hash %, n %) - gere a previa e aprove de novo',
      v_hash, v_n, coalesce(_hash, 'null'), coalesce(_n::text, 'null') USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer,
         string_agg(CASE WHEN split_part(a, '|', 3) ~ '^[0-9a-f-]{36}$' THEN split_part(a, '|', 3) ELSE '?' END, ', ')
    INTO v_fora, v_fora_ids
    FROM unnest(v_aprov) a
   WHERE NOT EXISTS (SELECT 1 FROM public._urg_r1b_enviar_previa() p WHERE p.elegivel AND p.linha = a);
  IF v_fora > 0 THEN
    RAISE EXCEPTION 'fora_da_lista: % linha(s) aprovada(s) nao estao na lista de agora (cad_etiqueta %)', v_fora, v_fora_ids
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.cad_etiqueta_id, 'motivo',
           CASE WHEN NOT p.elegivel THEN p.motivo
                WHEN NOT (p.linha = ANY (v_aprov)) THEN 'nao_aprovado'
                ELSE 'ja_corrigido_antes' END) ORDER BY p.tenant_id, p.cad_id, p.cad_etiqueta_id), '[]'::jsonb)
    INTO v_pulados
    FROM public._urg_r1b_enviar_previa() p
   WHERE NOT p.elegivel OR NOT (p.linha = ANY (v_aprov)) OR p.situacao = 'ja_corrigido'
      OR EXISTS (SELECT 1 FROM public._bkp_urg_r1b_enviar k WHERE k.cad_etiqueta_id = p.cad_etiqueta_id AND k.restaurado_em IS NULL);

  WITH alvo AS (
    SELECT p.cad_etiqueta_id, p.cad_id, p.tenant_id, p.antes, p.depois
      FROM public._urg_r1b_enviar_previa() p
     WHERE p.elegivel AND p.linha = ANY (v_aprov) AND p.situacao = 'a_corrigir' AND p.cad_id = ANY (v_cads)
       AND NOT EXISTS (SELECT 1 FROM public._bkp_urg_r1b_enviar k WHERE k.cad_etiqueta_id = p.cad_etiqueta_id AND k.restaurado_em IS NULL)
  ), upd AS (
    UPDATE public.cad_etiquetas ce
       SET quantidade_enviar = a.depois
      FROM alvo a
     WHERE ce.id = a.cad_etiqueta_id AND ce.cad_id = a.cad_id AND ce.quantidade_enviar = a.antes
    RETURNING ce.id, ce.cad_id, a.tenant_id, a.antes, a.depois
  ), ins AS (
    INSERT INTO public._bkp_urg_r1b_enviar (cad_etiqueta_id, cad_id, tenant_id, antes, depois)
    SELECT u.id, u.cad_id, u.tenant_id, u.antes, u.depois FROM upd u
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_gravados FROM ins;

  IF EXISTS (SELECT 1 FROM public._urg_r1b_enviar_previa() p
              WHERE p.elegivel AND p.linha = ANY (v_aprov) AND p.situacao = 'a_corrigir'
                AND NOT EXISTS (SELECT 1 FROM public._bkp_urg_r1b_enviar k WHERE k.cad_etiqueta_id = p.cad_etiqueta_id AND k.restaurado_em IS NULL)) THEN
    RAISE EXCEPTION 'pos_condicao: linha aprovada ficou sem correcao - nada gravado' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('gravados', v_gravados, 'pulados', v_pulados, 'hash', v_hash, 'n', v_n);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1b_enviar_rodar(jsonb,text,integer) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._urg_r1b_enviar_previa()'))) IS DISTINCT FROM '1158cdbfeaf90192295dfc9f4fdd9295'
     OR md5(pg_get_functiondef(to_regprocedure('public._urg_r1b_enviar_rodar(jsonb,text,integer)'))) IS DISTINCT FROM 'a2e58118486c39206fbcf31f192f1e06' THEN
    RAISE EXCEPTION 'urg_r1b_198000: pos-condicao falhou no texto das funcoes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('public._urg_r1b_enviar_previa()'), ('public._urg_r1b_enviar_rodar(jsonb,text,integer)')) AS x(f) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r1b_198000: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public._bkp_urg_r1b_enviar'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public._bkp_urg_r1b_enviar'::regclass)
     OR has_table_privilege('anon', 'public._bkp_urg_r1b_enviar', 'SELECT') OR has_table_privilege('authenticated', 'public._bkp_urg_r1b_enviar', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_urg_r1b_enviar', 'INSERT') OR has_table_privilege('authenticated', 'public._bkp_urg_r1b_enviar', 'UPDATE')
     OR has_table_privilege('authenticated', 'public._bkp_urg_r1b_enviar', 'DELETE') OR has_table_privilege('service_role', 'public._bkp_urg_r1b_enviar', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r1b_198000: pos-condicao falhou na RLS/privilegios de public._bkp_urg_r1b_enviar' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

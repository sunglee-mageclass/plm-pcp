-- Contas certas, bloco C, C2 (P-166 A; plano .superpowers/sdd/2026-09-30-contas-certas-cd/plan-cd.md §1 R-CD2/R-CD7, §2
-- "20261019310000" + "Forma canonica", §4 C2, §6 e as secoes finais que PREVALECEM: notas do kit Passo 0-CD, rulings da C1
-- R-C1b): as PECAS da correcao unica do custo previsto. ESTA MIGRATION NAO RECALCULA NADA SOZINHA.
--
-- A correcao unica so roda no deploy (kit release 8, passo 5 "ida-custo-backfill.sql"), com a lista que o DONO aprovou na
-- Rodada #2 do Passo 0-CD, SEMPRE numa transacao propria e com a confirmacao LOCAL (nunca SET de sessao: a confirmacao
-- nao pode sobreviver a esta chamada):
--   BEGIN;
--   SET LOCAL app.confirmo_recalculo_custo = 'sim';
--   SELECT public._custo_backfill_rodar('<lista aprovada, jsonb>'::jsonb, '<hash aprovado>', <n aprovado>);
--   COMMIT;
--
-- Objetos:
--   _bkp_custo_previsto (RLS sem policy, REVOKE ALL de PUBLIC/anon/authenticated/service_role): o ANTES e o DEPOIS de cada
--     valor que a correcao grava - as 5 colunas de custo de modelos E o custo_previsto das linhas do BOM (modelo_tecidos,
--     modelo_aviamentos, modelo_etiquetas - essas nao tem fn_audit; RC4c). Uma linha por (lote, tabela, id, coluna), so onde
--     muda. O inverso NAO apaga esta tabela; a restauracao e um passo SEPARADO
--     (supabase/rollback/20261019310000_custo_previsto_restaurar.sql, so com decisao do dono).
--   _custo_previa_lista(): a MESMA lista de supabase/consultas/custo_previa_lista.sql (o SELECT puro do Passo 0-CD), mas
--     feita com o calculo do SERVIDOR (_custo_calcular da 20261019300000, por loja). O teste C2 prova que as duas dao o mesmo
--     resultado, linha a linha e coluna a coluna, e que o aplicador grava exatamente o "depois" dela.
--   _custo_lista_canonica(jsonb) / _custo_lista_hash(jsonb): a lista aprovada e um ARRAY JSONB DE TEXTOS, um por modelo, cada um
--     = a coluna linha_canonica do custo_previa_lista.sql (= as linhas do arquivo passo0-cd-lista-canonica-<ts>.txt do kit):
--       modelo_id|peca_antes|peca_depois|tecido_antes|tecido_depois|forro_antes|forro_depois|entretela_antes|
--       entretela_depois|aviamento_antes|aviamento_depois|md5_linhas
--     (valor = round(x,2) em texto ou 'null'; md5_linhas = md5 das linhas do BOM que mudam, "tabela:id:antes>depois" em
--     ordem de (tabela, id), unidas por quebra de linha; md5('') quando nenhuma muda). A forma canonica e esses textos em
--     ordem de modelo_id (uuid) unidos por quebra de linha; hash = md5 dela (= o hash_lista do kit). Elemento fora do formato
--     ou modelo repetido = P0001.
--   _custo_backfill_rodar(_aprovado jsonb, _hash text, _n int) (R-CD7):
--     1. exige SET LOCAL app.confirmo_recalculo_custo = 'sim' (sem ela: recusa, P0001);
--     2. confere que o calculo da C1 (_custo_calcular, _custo_recalcular_modelos e os precos) e o de 20261019300000;
--     3. (d) hash da lista informada <> _hash -> aborta; (e) n de elementos <> _n -> aborta;
--     4. LOCK, nesta ORDEM: primeiro as 8 de preco/corte em SHARE, depois modelos + as 6 tabelas do BOM/ficha em SHARE ROW
--        EXCLUSIVE, ate o fim da transacao (conferencia, backup e gravacao veem o MESMO estado; ninguem grava no meio). A
--        ordem e a mesma de quem muda um preco (UPDATE no cadastro e, no COMMIT, a fila de custo grava BOM/modelos) - a
--        ordem inversa podia dar deadlock com essa pessoa. lock_timeout 3 s (na funcao);
--     5. recalcula a lista de AGORA (L = _custo_previa_lista() sem os congelados - R-CD2) e aborta (P0001 ASCII) se:
--        (a) um modelo de L nao esta na aprovada; (b) um modelo das duas tem antes ou depois diferente (linha canonica
--        diferente); (c) um modelo aprovado ausente de L tem valor gravado (as 5 colunas) <> o depois aprovado;
--        aprovado que sumiu (excluido) ou deixou de ser interno = pulado e relatado (nao ha o que gravar);
--        aprovado que foi ENVIADO AO CORTE depois da aprovacao (congelado) = pulado e relatado (R-CD2: a correcao unica
--        nunca toca congelado; ruling do controlador no fix round do G-MIGRATION);
--        aprovado ausente de L que ja bate com o depois = pulado (a fila da 300000 ja acertou - card editado depois);
--     6. grava o backup (lote novo) e chama o aplicador da C1 (_custo_recalcular_modelos, que liga app.custo_sistema='on' e
--        a restaura) SO para aprovada ∩ L, loja a loja;
--     7. pos-condicao (aborta tudo se falhar): todo valor do backup do lote esta gravado com o "depois"; cada modelo de L
--        tem backup; e a lista de agora nao tem mais nenhum modelo nao congelado.
--   Todas as funcoes: SECURITY DEFINER, EXECUTE revogado de PUBLIC, anon, authenticated E service_role (precedente
--   _p137_backfill_rodar da 20261017110000).
--
-- Guarda: o calculo da C1 que esta migration usa (_custo_calcular, _custo_recalcular_modelos, _custo_linha,
--   _custo_adicionais_soma, _custo_preco_tecido, _custo_preco_etiqueta, _precos_tecido_congelado_core) = o texto de
--   20261019300000 (pos-condicao dela, commit cbf37918). Objetos novos: ausentes ou com o texto deste arquivo; a tabela de
--   backup, se existe (inverso rodou antes), com o formato deste arquivo - os dados dela ficam.
-- Travas: so CREATE TABLE/FUNCTION (nenhuma trava em tabela existente; sem DROP TRIGGER/POLICY). lock_timeout 500ms.
-- Volta (LIFO pela ordem de APLICACAO): supabase/rollback/20261019310000_custo_previsto_backfill_down.sql (DROP das 4
--   funcoes; MANTEM _bkp_custo_previsto e os valores gravados). Devolver os custos antigos = passo separado e explicito
--   supabase/rollback/20261019310000_custo_previsto_restaurar.sql (so com decisao do dono).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '8s';
SET LOCAL transaction_timeout = '10s';

-- ACCEPTED-MD5 (lista unica usada pela guarda e pela pos-condicao)
--   papel: c1 = calculo da 20261019300000 (so conferido, cbf37918); novo = funcao deste arquivo (DEPOIS)
CREATE TEMP TABLE _cc_c2_md5 (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_c2_md5 VALUES
  ('public._custo_calcular(uuid,uuid[])',                    'f9d87d6a1f9f307a7d83cf837730566c', 'c1'),
  ('public._custo_recalcular_modelos(uuid,uuid[])',          '89c502499b65b52964a03b0ad5856138', 'c1'),
  ('public._custo_linha(numeric,numeric,numeric)',           '461a79844e15f336824e52aca4986f42', 'c1'),
  ('public._custo_adicionais_soma(jsonb)',                   '7d86994b9823f71362bf1901012ecbd4', 'c1'),
  ('public._custo_preco_tecido(uuid,uuid)',                  '68ec09cdd52566ceecfcd6267d470a29', 'c1'),
  ('public._custo_preco_etiqueta(uuid,uuid,uuid)',           '078b1e9b66300a5de9d2d993698e48bb', 'c1'),
  ('public._precos_tecido_congelado_core(uuid,uuid)',        '1092be10e608976560cb855eb64d2c0f', 'c1'),
  -- funcoes NOVAS (texto deste arquivo)
  ('public._custo_lista_canonica(jsonb)',                    '9fd76efb8850e54e9ad6bfba58a9e993', 'novo'),
  ('public._custo_lista_hash(jsonb)',                        '926dea1a85ad86ab5663d7caf714980d', 'novo'),
  ('public._custo_previa_lista()',                           '54368173a0aa69a60d3cb9c5d46a712a', 'novo'),
  ('public._custo_backfill_rodar(jsonb,text,integer)',       'd23616dcd428fb59d03f62396ca486ab', 'novo');

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  -- (a) calculo da C1: tem de existir com o texto da 20261019300000
  FOR r IN SELECT assinatura, md5 FROM _cc_c2_md5 WHERE papel = 'c1' LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_c2: % nao existe - aplique a 20261019300000 antes', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_c2: % mudou desde a 20261019300000 (md5 %) - conferir', r.assinatura, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- (b) funcoes novas: ausentes ou com o texto deste arquivo
  FOR r IN SELECT assinatura, md5 FROM _cc_c2_md5 WHERE papel = 'novo' LOOP
    IF to_regprocedure(r.assinatura) IS NOT NULL THEN
      v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
      IF v_md5 IS DISTINCT FROM r.md5 THEN
        RAISE EXCEPTION 'contas_certas_c2: % ja existe com outro texto (md5 %)', r.assinatura, v_md5 USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
  -- (c) a tabela de backup, se existe (o inverso a mantem), tem o formato deste arquivo
  IF to_regclass('public._bkp_custo_previsto') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = to_regclass('public._bkp_custo_previsto') AND a.attnum > 0 AND NOT a.attisdropped)
         IS DISTINCT FROM 'lote:uuid:true,tabela:text:true,id:uuid:true,modelo_id:uuid:true,tenant_id:uuid:true,coluna:text:true,antes:numeric:false,depois:numeric:true,hash_lista:text:true,gravado_em:timestamp with time zone:true' THEN
    RAISE EXCEPTION 'contas_certas_c2: _bkp_custo_previsto ja existe com outro formato' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- ─────────────────────────────── backup da correcao unica (RC4c) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public._bkp_custo_previsto (
  lote       uuid        NOT NULL,
  tabela     text        NOT NULL CHECK (tabela IN ('modelos', 'modelo_tecidos', 'modelo_aviamentos', 'modelo_etiquetas')),
  id         uuid        NOT NULL,
  modelo_id  uuid        NOT NULL,
  tenant_id  uuid        NOT NULL,
  coluna     text        NOT NULL CHECK (coluna IN ('custo_peca_previsto', 'custo_tecido_total', 'custo_forro_total',
                                                    'custo_entretela_total', 'custo_aviamento_total', 'custo_previsto')),
  antes      numeric,
  depois     numeric     NOT NULL,
  hash_lista text        NOT NULL,
  gravado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lote, tabela, id, coluna)
);
COMMENT ON TABLE public._bkp_custo_previsto IS
  'Correcao unica do custo previsto (contas certas C2, 20261019310000): ANTES/DEPOIS de cada valor gravado (5 colunas de modelos + custo_previsto das linhas do BOM). A restauracao (rollback/20261019310000_custo_previsto_restaurar.sql) le daqui. RLS sem policy e sem grant: so o dono (postgres) le.';
ALTER TABLE public._bkp_custo_previsto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_custo_previsto FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────── forma canonica / hash da lista aprovada ───────────────────────────────
CREATE OR REPLACE FUNCTION public._custo_lista_canonica(_aprovado jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-backfill C2] a lista aprovada (array jsonb de linhas canonicas do custo_previa_lista.sql) na forma canonica: as
-- linhas em ordem de modelo_id (uuid) unidas por quebra de linha ('' para a lista vazia). Formato conferido elemento a
-- elemento; modelo repetido = P0001. O hash e md5 disto (_custo_lista_hash) = o hash_lista do kit Passo 0-CD.
DECLARE
  v_pos bigint;
  v_dup text;
BEGIN
  IF _aprovado IS NULL OR jsonb_typeof(_aprovado) <> 'array' THEN
    RAISE EXCEPTION 'custo_backfill: a lista aprovada tem de ser um array jsonb de linhas canonicas' USING ERRCODE = 'P0001';
  END IF;
  SELECT e.pos INTO v_pos
    FROM jsonb_array_elements(_aprovado) WITH ORDINALITY e(v, pos)
   WHERE jsonb_typeof(e.v) <> 'string'
      OR (e.v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}([|](null|-?[0-9]+[.][0-9]{2})){10}[|][0-9a-f]{32}$'
   ORDER BY e.pos
   LIMIT 1;
  IF v_pos IS NOT NULL THEN
    RAISE EXCEPTION 'custo_backfill: elemento % da lista aprovada fora do formato canonico', v_pos USING ERRCODE = 'P0001';
  END IF;
  SELECT split_part(e, '|', 1) INTO v_dup
    FROM jsonb_array_elements_text(_aprovado) e
   GROUP BY split_part(e, '|', 1)
  HAVING count(*) > 1
   ORDER BY 1
   LIMIT 1;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'custo_backfill: modelo % repetido na lista aprovada', v_dup USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce((SELECT string_agg(e, E'\n' ORDER BY split_part(e, '|', 1)::uuid)
                     FROM jsonb_array_elements_text(_aprovado) e), '');
END;
$function$;

CREATE OR REPLACE FUNCTION public._custo_lista_hash(_aprovado jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [custo-backfill C2] hash da lista aprovada = md5 da forma canonica (= hash_lista do kit Passo 0-CD).
  SELECT md5(public._custo_lista_canonica(_aprovado));
$function$;

-- ─────────────────────────────── a lista de agora, pelo calculo do servidor ───────────────────────────────
CREATE OR REPLACE FUNCTION public._custo_previa_lista()
 RETURNS TABLE(loja text, tenant_id uuid, modelo_id uuid, ref character varying, nome character varying, versao integer,
               integracao_estado text, congelado boolean, previsto_antes numeric, previsto_depois numeric,
               tecido_antes numeric, tecido_depois numeric, forro_antes numeric, forro_depois numeric,
               entretela_antes numeric, entretela_depois numeric, aviamento_antes numeric, aviamento_depois numeric,
               etiqueta_depois numeric, mao_de_obra numeric, adicionais numeric, linhas_que_mudam bigint, motivo text,
               preco_digitado boolean, preco_venda numeric, markup_aplicado numeric, sugerido_antes numeric,
               sugerido_depois numeric, efeito_visivel boolean, linha_canonica text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [custo-backfill C2] = supabase/consultas/custo_previa_lista.sql (mesmas colunas, mesmas regras de lista, motivo,
  -- sugerido e linha canonica), mas o "depois" vem do calculo do SERVIDOR: _custo_calcular(loja, NULL) de cada loja com
  -- interno. O teste C2 prova arquivo = esta funcao = o que o aplicador grava. Inclui os congelados (coluna congelado).
  WITH m AS (
    SELECT mo.id, mo.tenant_id, mo.ref, mo.nome, mo.versao, mo.linha_id, mo.preco_venda, mo.markup_editado,
           mo.custo_peca_previsto, mo.custo_tecido_total, mo.custo_forro_total, mo.custo_entretela_total, mo.custo_aviamento_total,
           mo.custos_adicionais,
           EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = mo.id AND c.enviado_corte) AS congelado
      FROM public.modelos mo
     WHERE mo.origem = 'interno' AND mo.tenant_id IS NOT NULL
  ),
  k AS MATERIALIZED (
    SELECT x.*
      FROM (SELECT DISTINCT m.tenant_id FROM m) tn
      CROSS JOIN LATERAL public._custo_calcular(tn.tenant_id, NULL) x
  ),
  linhas AS (
    SELECT k.tabela, k.id, k.modelo_id, k.tipo,
           CASE k.tabela WHEN 'modelo_tecidos' THEN t.custo_previsto
                         WHEN 'modelo_aviamentos' THEN a.custo_previsto
                         ELSE e.custo_previsto END AS antes,
           k.custo AS depois
      FROM k
      LEFT JOIN public.modelo_tecidos t ON k.tabela = 'modelo_tecidos' AND t.id = k.id
      LEFT JOIN public.modelo_aviamentos a ON k.tabela = 'modelo_aviamentos' AND a.id = k.id
      LEFT JOIN public.modelo_etiquetas e ON k.tabela = 'modelo_etiquetas' AND e.id = k.id
     WHERE k.tabela <> 'modelos'
  ),
  por_modelo AS (
    SELECT li.modelo_id,
           sum(coalesce(li.antes, 0)) FILTER (WHERE li.tipo IN ('tecido', 'forro', 'entretela', 'aviamento', 'etiqueta')) AS linhas_antes,
           count(*) FILTER (WHERE li.antes IS DISTINCT FROM li.depois) AS n_linhas_mudam,
           count(*) FILTER (WHERE li.antes IS NULL) AS n_linhas_null,
           count(*) FILTER (WHERE li.antes IS NOT NULL AND li.antes <> li.depois) AS n_linhas_preco,
           md5(coalesce(string_agg(li.tabela || ':' || li.id::text || ':' || coalesce(round(li.antes, 2)::text, 'null') || '>'
                                   || coalesce(round(li.depois, 2)::text, 'null'), E'\n' ORDER BY li.tabela, li.id)
                          FILTER (WHERE li.antes IS DISTINCT FROM li.depois), '')) AS md5_linhas
      FROM linhas li
     GROUP BY li.modelo_id
  ),
  calc AS (
    SELECT m.*,
           km.tecido AS tecido_d, km.forro AS forro_d, km.entretela AS entretela_d,
           km.aviamento AS aviamento_d, km.etiqueta AS etiqueta_d,
           coalesce(pm.linhas_antes, 0) AS linhas_antes,
           coalesce(pm.n_linhas_mudam, 0) AS n_linhas_mudam, coalesce(pm.n_linhas_null, 0) AS n_linhas_null,
           coalesce(pm.n_linhas_preco, 0) AS n_linhas_preco, coalesce(pm.md5_linhas, md5('')) AS md5_linhas,
           km.mao_obra AS mo, km.adicionais AS adic, km.custo AS peca_d,
           CASE WHEN coalesce(m.markup_editado, 0) > 0 THEN m.markup_editado
                ELSE coalesce((SELECT ln.markup FROM public.linhas ln WHERE ln.id = m.linha_id AND ln.tenant_id = m.tenant_id), 0) END AS mk
      FROM m
      JOIN k km ON km.tabela = 'modelos' AND km.id = m.id
      LEFT JOIN por_modelo pm ON pm.modelo_id = m.id
  ),
  lista AS (
    SELECT f.*,
           round(coalesce(f.custo_peca_previsto, 0), 2) <> round(f.peca_d, 2) AS efeito_visivel,
           coalesce(f.preco_venda, 0) > 0 AS preco_digitado,
           CASE WHEN coalesce(f.custo_peca_previsto, 0) > 0 AND f.mk > 0
                THEN round(5 * greatest(0, ceil((coalesce(f.custo_peca_previsto, 0) * f.mk - 4.9) / 5 - 0.000000001)) + 4.9, 2) ELSE 0 END AS sugerido_antes,
           CASE WHEN round(f.peca_d, 2) > 0 AND f.mk > 0
                THEN round(5 * greatest(0, ceil((round(f.peca_d, 2) * f.mk - 4.9) / 5 - 0.000000001)) + 4.9, 2) ELSE 0 END AS sugerido_depois,
           nullif(concat_ws(' + ',
             CASE WHEN f.custo_peca_previsto IS NULL THEN 'previsto NULL' END,
             CASE WHEN f.n_linhas_null > 0 THEN 'linha NULL (Aplicar)' END,
             CASE WHEN f.n_linhas_preco > 0 THEN 'preco da linha' END,
             CASE WHEN f.custo_peca_previsto IS NOT NULL AND f.mo <> 0
                       AND round(f.custo_peca_previsto, 2) = round(f.linhas_antes + f.adic, 2) THEN 'M.O. fora do previsto' END,
             CASE WHEN f.custo_peca_previsto IS NOT NULL
                       AND round(f.custo_peca_previsto, 2) <> round(f.linhas_antes + f.mo + f.adic, 2)
                       AND NOT (f.mo <> 0 AND round(f.custo_peca_previsto, 2) = round(f.linhas_antes + f.adic, 2)) THEN 'soma' END,
             CASE WHEN f.custo_tecido_total IS DISTINCT FROM f.tecido_d OR f.custo_forro_total IS DISTINCT FROM f.forro_d
                       OR f.custo_entretela_total IS DISTINCT FROM f.entretela_d OR f.custo_aviamento_total IS DISTINCT FROM f.aviamento_d
                  THEN 'totais' END), '') AS motivo,
           f.id::text
             || '|' || coalesce(round(f.custo_peca_previsto, 2)::text, 'null') || '|' || round(f.peca_d, 2)::text
             || '|' || coalesce(round(f.custo_tecido_total, 2)::text, 'null') || '|' || round(f.tecido_d, 2)::text
             || '|' || coalesce(round(f.custo_forro_total, 2)::text, 'null') || '|' || round(f.forro_d, 2)::text
             || '|' || coalesce(round(f.custo_entretela_total, 2)::text, 'null') || '|' || round(f.entretela_d, 2)::text
             || '|' || coalesce(round(f.custo_aviamento_total, 2)::text, 'null') || '|' || round(f.aviamento_d, 2)::text
             || '|' || f.md5_linhas AS linha_canonica
      FROM calc f
     WHERE f.custo_peca_previsto IS DISTINCT FROM round(f.peca_d, 2)
        OR f.custo_tecido_total IS DISTINCT FROM f.tecido_d
        OR f.custo_forro_total IS DISTINCT FROM f.forro_d
        OR f.custo_entretela_total IS DISTINCT FROM f.entretela_d
        OR f.custo_aviamento_total IS DISTINCT FROM f.aviamento_d
        OR f.n_linhas_mudam > 0
  )
  SELECT t.nome::text AS loja, l.tenant_id, l.id AS modelo_id, l.ref, l.nome, l.versao,
         (SELECT string_agg(DISTINCT ip.estado, ',') FROM public.integracao_produtos ip WHERE ip.modelo_id = l.id) AS integracao_estado,
         l.congelado,
         l.custo_peca_previsto AS previsto_antes, round(l.peca_d, 2) AS previsto_depois,
         l.custo_tecido_total AS tecido_antes, round(l.tecido_d, 2) AS tecido_depois,
         l.custo_forro_total AS forro_antes, round(l.forro_d, 2) AS forro_depois,
         l.custo_entretela_total AS entretela_antes, round(l.entretela_d, 2) AS entretela_depois,
         l.custo_aviamento_total AS aviamento_antes, round(l.aviamento_d, 2) AS aviamento_depois,
         round(l.etiqueta_d, 2) AS etiqueta_depois, l.mo AS mao_de_obra, l.adic AS adicionais,
         l.n_linhas_mudam AS linhas_que_mudam, coalesce(l.motivo, 'arredondamento') AS motivo,
         l.preco_digitado, l.preco_venda, l.mk AS markup_aplicado, l.sugerido_antes, l.sugerido_depois,
         l.efeito_visivel, l.linha_canonica
    FROM lista l
    LEFT JOIN public.tenants t ON t.id = l.tenant_id
   ORDER BY l.id;
$function$;

-- ─────────────────────────────── a correcao unica (R-CD7) ───────────────────────────────
CREATE OR REPLACE FUNCTION public._custo_backfill_rodar(_aprovado jsonb, _hash text, _n integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '3s'
AS $function$
-- [custo-backfill C2] correcao unica do custo previsto (P-166 A), SO com a lista aprovada pelo dono: confirmacao, calculo
-- da C1 conferido, (d) hash e (e) n, LOCK, lista de agora L (sem congelados, R-CD2), (a)/(b)/(c) do R-CD7, backup do lote e
-- aplicador da C1 so em aprovada ∩ L, pos-condicao. Qualquer falha = P0001 ASCII e nada fica gravado.
DECLARE
  v_canon text;
  v_hash text;
  v_lote uuid := gen_random_uuid();
  v_ids uuid[];
  v_ten uuid[];
  v_lin text[];
  v_n integer;
  v_lista text;
  v_conv uuid[];
  v_fora uuid[];
  v_cong uuid[];
  v_gravou integer := 0;
  v_bkp_m integer := 0;
  v_bkp_l integer := 0;
  r record;
BEGIN
  IF coalesce(current_setting('app.confirmo_recalculo_custo', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'custo_backfill: recusado - falta SET LOCAL app.confirmo_recalculo_custo = sim (so no deploy, com a lista aprovada pelo dono)'
      USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._custo_calcular(uuid,uuid[])'))) IS DISTINCT FROM 'f9d87d6a1f9f307a7d83cf837730566c'
     OR md5(pg_get_functiondef(to_regprocedure('public._custo_recalcular_modelos(uuid,uuid[])'))) IS DISTINCT FROM '89c502499b65b52964a03b0ad5856138'
     OR md5(pg_get_functiondef(to_regprocedure('public._custo_linha(numeric,numeric,numeric)'))) IS DISTINCT FROM '461a79844e15f336824e52aca4986f42'
     OR md5(pg_get_functiondef(to_regprocedure('public._custo_adicionais_soma(jsonb)'))) IS DISTINCT FROM '7d86994b9823f71362bf1901012ecbd4'
     OR md5(pg_get_functiondef(to_regprocedure('public._custo_preco_tecido(uuid,uuid)'))) IS DISTINCT FROM '68ec09cdd52566ceecfcd6267d470a29'
     OR md5(pg_get_functiondef(to_regprocedure('public._custo_preco_etiqueta(uuid,uuid,uuid)'))) IS DISTINCT FROM '078b1e9b66300a5de9d2d993698e48bb'
     OR md5(pg_get_functiondef(to_regprocedure('public._precos_tecido_congelado_core(uuid,uuid)'))) IS DISTINCT FROM '1092be10e608976560cb855eb64d2c0f' THEN
    RAISE EXCEPTION 'custo_backfill: o calculo da 20261019300000 mudou ou sumiu - a lista aprovada nao vale mais; conferir' USING ERRCODE = 'P0001';
  END IF;

  -- (d) e (e): a lista informada e a aprovada
  v_canon := public._custo_lista_canonica(_aprovado);
  v_hash := md5(v_canon);
  IF _hash IS NULL OR v_hash <> _hash THEN
    RAISE EXCEPTION 'custo_backfill: hash da lista informada (%) diferente do hash aprovado (%) - abortado', v_hash, coalesce(_hash, 'null')
      USING ERRCODE = 'P0001';
  END IF;
  IF _n IS NULL OR jsonb_array_length(_aprovado) <> _n THEN
    RAISE EXCEPTION 'custo_backfill: a lista informada tem % modelo(s), o aprovado e % - abortado', jsonb_array_length(_aprovado), coalesce(_n::text, 'null')
      USING ERRCODE = 'P0001';
  END IF;

  -- ninguem grava no BOM/modelos nem muda preco/corte ate o fim da transacao: conferencia, backup e gravacao veem o mesmo
  -- estado. ORDEM: preco/corte PRIMEIRO, depois BOM/modelos - a mesma de quem muda um preco (o UPDATE do cadastro e, no
  -- COMMIT dele, a fila de custo grava BOM/modelos); a ordem inversa podia dar deadlock com essa pessoa.
  LOCK TABLE public.artigos, public.variantes_tecido, public.ocs_tecido, public.ocs_tecido_itens, public.aviamentos,
             public.etiquetas, public.variantes_etiqueta, public.cad
    IN SHARE MODE;
  LOCK TABLE public.modelos, public.modelo_tecidos, public.modelo_tecido_variantes, public.modelo_tecido_oc_links,
             public.modelo_aviamentos, public.modelo_etiquetas, public.modelo_servico_mo
    IN SHARE ROW EXCLUSIVE MODE;

  -- L = a lista de agora, sem os congelados (R-CD2)
  SELECT array_agg(p.modelo_id ORDER BY p.modelo_id), array_agg(p.tenant_id ORDER BY p.modelo_id),
         array_agg(p.linha_canonica ORDER BY p.modelo_id)
    INTO v_ids, v_ten, v_lin
    FROM public._custo_previa_lista() p
   WHERE NOT p.congelado;

  -- (a) modelo da lista de agora que nao foi aprovado
  SELECT count(*), string_agg(x.id::text, ',' ORDER BY x.id) FILTER (WHERE x.rn <= 5) INTO v_n, v_lista
    FROM (SELECT l.id, row_number() OVER (ORDER BY l.id) AS rn
            FROM unnest(v_ids) l(id)
           WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(_aprovado) e WHERE split_part(e, '|', 1)::uuid = l.id)) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'custo_backfill: % modelo(s) mudariam e NAO estao na lista aprovada (ex.: %) - abortado; gerar a lista de novo e o dono aprovar',
      v_n, v_lista USING ERRCODE = 'P0001';
  END IF;
  -- (b) modelo nas duas com antes/depois diferente
  SELECT count(*), string_agg(x.id::text, ',' ORDER BY x.id) FILTER (WHERE x.rn <= 5) INTO v_n, v_lista
    FROM (SELECT l.id, row_number() OVER (ORDER BY l.id) AS rn
            FROM unnest(v_ids, v_lin) l(id, canon)
            JOIN jsonb_array_elements_text(_aprovado) e ON split_part(e, '|', 1)::uuid = l.id
           WHERE e <> l.canon) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'custo_backfill: % modelo(s) da lista aprovada tem hoje antes/depois diferente do aprovado (ex.: %) - abortado; gerar a lista de novo e o dono aprovar',
      v_n, v_lista USING ERRCODE = 'P0001';
  END IF;
  -- (c) aprovado ausente de L: tem de ja estar gravado com o depois aprovado (a fila acertou); sumiu/nao e mais interno =
  -- pulado; enviado ao corte depois da aprovacao (congelado) = pulado (R-CD2), sem olhar o valor
  SELECT count(*) FILTER (WHERE x.m_id IS NOT NULL AND NOT x.congelado AND NOT x.bate),
         string_agg(x.id::text, ',' ORDER BY x.id) FILTER (WHERE x.m_id IS NOT NULL AND NOT x.congelado AND NOT x.bate),
         coalesce(array_agg(x.id ORDER BY x.id) FILTER (WHERE x.m_id IS NOT NULL AND NOT x.congelado AND x.bate), '{}'),
         coalesce(array_agg(x.id ORDER BY x.id) FILTER (WHERE x.m_id IS NULL), '{}'),
         coalesce(array_agg(x.id ORDER BY x.id) FILTER (WHERE x.m_id IS NOT NULL AND x.congelado), '{}')
    INTO v_n, v_lista, v_conv, v_fora, v_cong
    FROM (SELECT a.id, m.id AS m_id,
                 EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte) AS congelado,
                 coalesce(round(m.custo_peca_previsto, 2)::text, 'null') = split_part(a.e, '|', 3)
                 AND coalesce(round(m.custo_tecido_total, 2)::text, 'null') = split_part(a.e, '|', 5)
                 AND coalesce(round(m.custo_forro_total, 2)::text, 'null') = split_part(a.e, '|', 7)
                 AND coalesce(round(m.custo_entretela_total, 2)::text, 'null') = split_part(a.e, '|', 9)
                 AND coalesce(round(m.custo_aviamento_total, 2)::text, 'null') = split_part(a.e, '|', 11) AS bate
            FROM (SELECT split_part(e, '|', 1)::uuid AS id, e FROM jsonb_array_elements_text(_aprovado) e) a
            LEFT JOIN public.modelos m ON m.id = a.id AND m.origem = 'interno' AND m.tenant_id IS NOT NULL
           WHERE a.id <> ALL (coalesce(v_ids, '{}'))) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'custo_backfill: % modelo(s) aprovado(s) fora da lista de agora com valor gravado diferente do depois aprovado (%) - abortado; gerar a lista de novo e o dono aprovar',
      v_n, left(v_lista, 200) USING ERRCODE = 'P0001';
  END IF;

  -- backup do lote (so o que muda) e gravacao pelo aplicador da C1, loja a loja
  IF coalesce(cardinality(v_ids), 0) > 0 THEN
    WITH alvo AS (
      SELECT u.ten, array_agg(u.id ORDER BY u.id) AS ids FROM unnest(v_ids, v_ten) u(id, ten) GROUP BY u.ten
    ), k AS MATERIALIZED (
      SELECT alvo.ten, x.* FROM alvo CROSS JOIN LATERAL public._custo_calcular(alvo.ten, alvo.ids) x
    ), b AS (
      SELECT k.tabela, k.id, k.modelo_id, k.ten, 'custo_previsto'::text AS coluna,
             CASE k.tabela WHEN 'modelo_tecidos' THEN t.custo_previsto
                           WHEN 'modelo_aviamentos' THEN a.custo_previsto
                           ELSE e.custo_previsto END AS antes,
             k.custo AS depois
        FROM k
        LEFT JOIN public.modelo_tecidos t ON k.tabela = 'modelo_tecidos' AND t.id = k.id
        LEFT JOIN public.modelo_aviamentos a ON k.tabela = 'modelo_aviamentos' AND a.id = k.id
        LEFT JOIN public.modelo_etiquetas e ON k.tabela = 'modelo_etiquetas' AND e.id = k.id
       WHERE k.tabela <> 'modelos'
      UNION ALL
      SELECT 'modelos', k.id, k.id, k.ten, v.coluna, v.antes, v.depois
        FROM k
        JOIN public.modelos m ON m.id = k.id
        CROSS JOIN LATERAL (VALUES ('custo_peca_previsto', m.custo_peca_previsto, round(k.custo, 2)),
                                   ('custo_tecido_total', m.custo_tecido_total, k.tecido),
                                   ('custo_forro_total', m.custo_forro_total, k.forro),
                                   ('custo_entretela_total', m.custo_entretela_total, k.entretela),
                                   ('custo_aviamento_total', m.custo_aviamento_total, k.aviamento)) v(coluna, antes, depois)
       WHERE k.tabela = 'modelos'
    ), ins AS (
      INSERT INTO public._bkp_custo_previsto (lote, tabela, id, modelo_id, tenant_id, coluna, antes, depois, hash_lista)
      SELECT v_lote, b.tabela, b.id, b.modelo_id, b.ten, b.coluna, b.antes, b.depois, v_hash
        FROM b
       WHERE b.antes IS DISTINCT FROM b.depois
      RETURNING tabela
    )
    SELECT count(*) FILTER (WHERE tabela = 'modelos'), count(*) FILTER (WHERE tabela <> 'modelos') INTO v_bkp_m, v_bkp_l FROM ins;

    FOR r IN SELECT u.ten, array_agg(u.id ORDER BY u.id) AS ids FROM unnest(v_ids, v_ten) u(id, ten) GROUP BY u.ten ORDER BY u.ten LOOP
      v_gravou := v_gravou + public._custo_recalcular_modelos(r.ten, r.ids);
    END LOOP;

    -- pos-condicao: o gravado e o depois do backup, cada modelo de L tem backup, e a lista de agora ficou vazia
    SELECT count(*) INTO v_n
      FROM public._bkp_custo_previsto b
     WHERE b.lote = v_lote
       AND b.depois IS DISTINCT FROM (CASE b.tabela
             WHEN 'modelo_tecidos' THEN (SELECT t.custo_previsto FROM public.modelo_tecidos t WHERE t.id = b.id)
             WHEN 'modelo_aviamentos' THEN (SELECT t.custo_previsto FROM public.modelo_aviamentos t WHERE t.id = b.id)
             WHEN 'modelo_etiquetas' THEN (SELECT t.custo_previsto FROM public.modelo_etiquetas t WHERE t.id = b.id)
             ELSE (SELECT CASE b.coluna WHEN 'custo_peca_previsto' THEN m.custo_peca_previsto
                                        WHEN 'custo_tecido_total' THEN m.custo_tecido_total
                                        WHEN 'custo_forro_total' THEN m.custo_forro_total
                                        WHEN 'custo_entretela_total' THEN m.custo_entretela_total
                                        ELSE m.custo_aviamento_total END
                     FROM public.modelos m WHERE m.id = b.id) END);
    IF v_n > 0 THEN
      RAISE EXCEPTION 'custo_backfill: pos-condicao falhou - % valor(es) gravado(s) diferente(s) do depois do backup - abortado', v_n USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT count(DISTINCT b.modelo_id) FROM public._bkp_custo_previsto b WHERE b.lote = v_lote) <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'custo_backfill: pos-condicao falhou - modelo da lista sem backup - abortado' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO v_n FROM public._custo_previa_lista() p WHERE NOT p.congelado;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'custo_backfill: pos-condicao falhou - % modelo(s) ainda mudariam depois da correcao - abortado', v_n USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'lote', CASE WHEN coalesce(cardinality(v_ids), 0) > 0 THEN v_lote END,
    'hash_lista', v_hash,
    'n_aprovado', jsonb_array_length(_aprovado),
    'n_lista_agora', coalesce(cardinality(v_ids), 0),
    'corrigidos', coalesce(cardinality(v_ids), 0),
    'modelos_com_colunas_gravadas', v_gravou,
    'bkp_modelos', v_bkp_m,
    'bkp_linhas', v_bkp_l,
    'pulados_ja_convergidos', cardinality(v_conv),
    'pulados_ja_convergidos_ids', to_jsonb(v_conv),
    'pulados_fora_de_escopo', cardinality(v_fora),
    'pulados_fora_de_escopo_ids', to_jsonb(v_fora),
    'pulados_congelados', cardinality(v_cong),
    'pulados_congelados_ids', to_jsonb(v_cong));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._custo_lista_canonica(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._custo_lista_hash(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._custo_previa_lista() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._custo_backfill_rodar(jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5 FROM _cc_c2_md5 WHERE papel = 'novo' LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_c2: % nao ficou com o texto deste arquivo (md5 %)', r.assinatura, v_md5 USING ERRCODE = 'P0001';
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) THEN
      RAISE EXCEPTION 'contas_certas_c2: % nao e SECURITY DEFINER', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('public', r.assinatura, 'EXECUTE') OR has_function_privilege('anon', r.assinatura, 'EXECUTE')
       OR has_function_privilege('authenticated', r.assinatura, 'EXECUTE') OR has_function_privilege('service_role', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'contas_certas_c2: % ficou executavel por PUBLIC/anon/authenticated/service_role', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public._bkp_custo_previsto'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public._bkp_custo_previsto'::regclass)
     OR has_table_privilege('anon', 'public._bkp_custo_previsto', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_custo_previsto', 'SELECT')
     OR has_table_privilege('service_role', 'public._bkp_custo_previsto', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_custo_previsto', 'INSERT')
     OR has_table_privilege('service_role', 'public._bkp_custo_previsto', 'DELETE') THEN
    RAISE EXCEPTION 'contas_certas_c2: _bkp_custo_previsto sem RLS, com policy ou acessivel ao cliente/service_role' USING ERRCODE = 'P0001';
  END IF;
  -- o calculo da C1 continua o mesmo (nada deste arquivo o toca)
  FOR r IN SELECT assinatura, md5 FROM _cc_c2_md5 WHERE papel = 'c1' LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.assinatura))) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_c2: % mudou durante a migration', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

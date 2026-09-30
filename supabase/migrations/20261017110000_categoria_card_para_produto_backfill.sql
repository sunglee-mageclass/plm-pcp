-- P-137 A / P-144 A (30/set): BACKFILL UNICO — alinha a taxonomia (grupo/categoria/subcategorias) dos produtos que HOJE
-- ja estao diferentes do card espelho, com as MESMAS regras do gatilho da 20261017100000 (fn_modelo_espelho_categoria):
--   • par = produto x card da MESMA loja com a origem certa (produtos_acabados <-> modelos.origem 'revenda';
--     produtos_importados <-> 'importado') — produto ligado a card de outra origem nao e alcancado (igual o gatilho);
--   • alvo: grupo = grupo da categoria do card (categorias_produto, mesma loja), categoria = a do card, sub1/sub2 = as do
--     card QUANDO nao-NULAS (NULL do card nunca e copiado — P-145 A / R3b; o produto mantem a dele);
--   • PULA (contado por motivo, nada muda no produto): (a) card sem categoria; (b) categoria sem grupo no cadastro;
--     (c) produto COM pedido (OC) cujo grupo cruzaria Acessorios <-> outro grupo (P-142 B, PA e PI).
-- Cada produto arrumado ganha 1 linha em audit_log (Admin > Auditoria): user_nome 'Sistema', acao 'editar', entidade
-- 'Produto Acabado'/'Produto Importado', descricao 'Sistema: categoria alinhada ao card (P-137) — <nome>', dados no
-- formato que a tela entende {campo:{de,para}} (so os campos que mudaram, com NOMES legiveis — R2 do G-plano).
-- O "antes" (UUIDs) vai para public._bkp_p137_backfill (RLS sem policy + REVOKE ALL de PUBLIC/anon/authenticated/
-- service_role, padrao 20261009100000) — o inverso restaura DELA, so onde o produto ainda esta igual ao "depois".
-- A logica mora em 2 funcoes (SECURITY DEFINER, EXECUTE revogado dos 3 — inv. #9) para ser testavel em transacao
-- revertida sem aplicar esta migration dentro de teste: _p137_backfill_rodar() e _p137_backfill_desfazer().
-- • Guarda: gatilho da 20261017100000 no ar (md5 da funcao + definicao), P-136 viva, funcoes do backfill ausentes ou ja
--   com o texto desta migration; se a VOLTA ja rodou (marcador 'p137_backfill_revertido' no audit_log), recusa — so com
--   SET app.p137_apos_volta = 'sim' (decisao do controlador; padrao 20261009100000).
-- • Idempotente: 2a ida = 0 arrumados (os pulados continuam pulados e sao contados de novo).
-- • Autocheck ($pos$, aborta tudo): nenhum produto "a arrumar" sobra; linhas de auditoria e de _bkp DESTA rodada = nº arrumados.
-- • Lock: so UPDATE de linhas (RowExclusive) em produtos_acabados/produtos_importados + INSERT em audit_log/_bkp.
-- • Inverso: supabase/rollback/20261017110000_categoria_card_para_produto_backfill_down.sql (roda ANTES do inverso da
--   20261017100000 — LIFO).
-- Aplicar fora de transacao (psql -v ON_ERROR_STOP=1 -f), com o client_encoding abaixo ANTES do BEGIN.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '20s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()'))) IS DISTINCT FROM '3ff558f37ef4ee75d36db77635a51268'
     OR (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
          WHERE t.tgname = 'trg_modelo_espelho_categoria' AND t.tgrelid = 'public.modelos'::regclass)
        IS DISTINCT FROM '871039e642390c357188b6b2a1134d64' THEN
    RAISE EXCEPTION 'p137_backfill: o gatilho da 20261017100000 nao esta no ar (ou mudou) - aplique a 20261017100000 antes' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'::regprocedure))
     IS DISTINCT FROM 'e5473bb29fa559408093d1a82c6ac11f' THEN
    RAISE EXCEPTION 'p137_backfill: _salvar_produto_acabado_core fora do texto da P-136 - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._grupo_eh_acessorio(uuid)') IS NULL THEN
    RAISE EXCEPTION 'p137_backfill: _grupo_eh_acessorio(uuid) ausente' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._p137_backfill_rodar()')));
  IF v_md5 IS NOT NULL AND v_md5 IS DISTINCT FROM 'fa343381c1d7d2ed3422255312b9fad7' THEN
    RAISE EXCEPTION 'p137_backfill: _p137_backfill_rodar ja existe com outro texto (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._p137_backfill_desfazer()')));
  IF v_md5 IS NOT NULL AND v_md5 IS DISTINCT FROM '14780b0ee671098f3da1440481a466e4' THEN
    RAISE EXCEPTION 'p137_backfill: _p137_backfill_desfazer ja existe com outro texto (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  -- Ida depois de uma volta: so com override explicito (a volta apagou o registro _bkp).
  IF to_regclass('public._bkp_p137_backfill') IS NULL
     AND EXISTS (SELECT 1 FROM public.audit_log
                  WHERE tabela = '_bkp_p137_backfill' AND descricao LIKE 'p137_backfill_revertido%')
     AND coalesce(current_setting('app.p137_apos_volta', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'p137_backfill: a volta ja rodou - ida de novo so com SET app.p137_apos_volta = sim (controlador)' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE TABLE IF NOT EXISTS public._bkp_p137_backfill (
  id             bigserial   PRIMARY KEY,
  tabela         text        NOT NULL CHECK (tabela IN ('produtos_acabados', 'produtos_importados')),
  produto_id     uuid        NOT NULL,
  tenant_id      uuid        NOT NULL,
  modelo_id      uuid        NOT NULL,
  grupo_de       uuid,
  categoria_de   uuid,
  sub1_de        uuid,
  sub2_de        uuid,
  grupo_para     uuid,
  categoria_para uuid,
  sub1_para      uuid,
  sub2_para      uuid,
  audit_id       uuid        NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public._bkp_p137_backfill IS
  'P-137 backfill 20261017110000: taxonomia ANTES/DEPOIS de cada produto alinhado ao card (o inverso restaura daqui). RLS sem policy e sem grant: so o dono (postgres) le.';
ALTER TABLE public._bkp_p137_backfill ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_p137_backfill FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public._bkp_p137_backfill_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._p137_backfill_rodar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  WITH par AS (
    SELECT 'produtos_acabados'::text AS tabela, 'Produto Acabado'::text AS entidade, 'PA'::text AS tipo,
           p.id, p.tenant_id, p.nome, p.modelo_id,
           p.grupo_id AS g, p.categoria_id AS c, p.subcategoria1_id AS s1, p.subcategoria2_id AS s2,
           m.categoria_principal_id AS mc, m.subcategoria1_id AS ms1, m.subcategoria2_id AS ms2,
           EXISTS (SELECT 1 FROM public.ocs_p_acabado o WHERE o.produto_acabado_id = p.id) AS tem_oc
      FROM public.produtos_acabados p
      JOIN public.modelos m ON m.id = p.modelo_id AND m.tenant_id = p.tenant_id AND m.origem = 'revenda'
    UNION ALL
    SELECT 'produtos_importados', 'Produto Importado', 'PI',
           p.id, p.tenant_id, p.nome, p.modelo_id,
           p.grupo_id, p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
           m.categoria_principal_id, m.subcategoria1_id, m.subcategoria2_id,
           EXISTS (SELECT 1 FROM public.ocs_importado o WHERE o.produto_importado_id = p.id)
      FROM public.produtos_importados p
      JOIN public.modelos m ON m.id = p.modelo_id AND m.tenant_id = p.tenant_id AND m.origem = 'importado'
  ), x AS (
    SELECT par.*, cp.grupo_id AS mg
      FROM par LEFT JOIN public.categorias_produto cp ON cp.id = par.mc AND cp.tenant_id = par.tenant_id
  ), cls AS (
    SELECT x.*,
           (x.g, x.c, x.s1, x.s2) IS DISTINCT FROM (x.mg, x.mc, x.ms1, x.ms2) AS divergente,
           coalesce(x.ms1, x.s1) AS alvo_s1,
           coalesce(x.ms2, x.s2) AS alvo_s2,
           CASE
             WHEN (x.g, x.c, x.s1, x.s2) IS NOT DISTINCT FROM (x.mg, x.mc, x.ms1, x.ms2) THEN 'alinhado'
             WHEN x.mc IS NULL THEN 'card_sem_categoria'
             WHEN x.mg IS NULL THEN 'categoria_sem_grupo'
             WHEN (x.g, x.c, x.s1, x.s2) IS NOT DISTINCT FROM (x.mg, x.mc, coalesce(x.ms1, x.s1), coalesce(x.ms2, x.s2))
               THEN 'so_null_no_card'
             WHEN x.g IS DISTINCT FROM x.mg AND x.tem_oc
                  AND public._grupo_eh_acessorio(x.g) IS DISTINCT FROM public._grupo_eh_acessorio(x.mg)
               THEN 'acessorio_com_pedido'
             ELSE 'arrumar'
           END AS situacao
      FROM x
  ), upa AS (
    UPDATE public.produtos_acabados p
       SET grupo_id = k.mg, categoria_id = k.mc, subcategoria1_id = k.alvo_s1, subcategoria2_id = k.alvo_s2, updated_at = now()
      FROM cls k
     WHERE k.tabela = 'produtos_acabados' AND k.situacao = 'arrumar' AND p.id = k.id
       -- ainda igual ao lido (um save concorrente no meio = pula; o EvalPlanQual recheca esta linha)
       AND p.grupo_id IS NOT DISTINCT FROM k.g AND p.categoria_id IS NOT DISTINCT FROM k.c
       AND p.subcategoria1_id IS NOT DISTINCT FROM k.s1 AND p.subcategoria2_id IS NOT DISTINCT FROM k.s2
    RETURNING k.tabela, k.entidade, k.id, k.tenant_id, k.nome, k.modelo_id, k.g, k.c, k.s1, k.s2,
              p.grupo_id AS g2, p.categoria_id AS c2, p.subcategoria1_id AS s12, p.subcategoria2_id AS s22
  ), upi AS (
    UPDATE public.produtos_importados p
       SET grupo_id = k.mg, categoria_id = k.mc, subcategoria1_id = k.alvo_s1, subcategoria2_id = k.alvo_s2, updated_at = now()
      FROM cls k
     WHERE k.tabela = 'produtos_importados' AND k.situacao = 'arrumar' AND p.id = k.id
       AND p.grupo_id IS NOT DISTINCT FROM k.g AND p.categoria_id IS NOT DISTINCT FROM k.c
       AND p.subcategoria1_id IS NOT DISTINCT FROM k.s1 AND p.subcategoria2_id IS NOT DISTINCT FROM k.s2
    RETURNING k.tabela, k.entidade, k.id, k.tenant_id, k.nome, k.modelo_id, k.g, k.c, k.s1, k.s2,
              p.grupo_id AS g2, p.categoria_id AS c2, p.subcategoria1_id AS s12, p.subcategoria2_id AS s22
  ), up AS (
    SELECT u.*, gen_random_uuid() AS audit_id
      FROM (SELECT * FROM upa UNION ALL SELECT * FROM upi) u
  ), aud AS (
    INSERT INTO public.audit_log (id, tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
    SELECT up.audit_id, up.tenant_id, NULL, 'Sistema', 'editar', up.entidade, up.tabela, up.id,
           'Sistema: categoria alinhada ao card (P-137) — ' || coalesce(up.nome, ''),
           (CASE WHEN up.g IS DISTINCT FROM up.g2 THEN jsonb_build_object('grupo_id', jsonb_build_object(
                   'de', (SELECT gp.nome FROM public.grupos_produto gp WHERE gp.id = up.g),
                   'para', (SELECT gp.nome FROM public.grupos_produto gp WHERE gp.id = up.g2))) ELSE '{}'::jsonb END)
           || (CASE WHEN up.c IS DISTINCT FROM up.c2 THEN jsonb_build_object('categoria_id', jsonb_build_object(
                   'de', (SELECT cp.nome FROM public.categorias_produto cp WHERE cp.id = up.c),
                   'para', (SELECT cp.nome FROM public.categorias_produto cp WHERE cp.id = up.c2))) ELSE '{}'::jsonb END)
           || (CASE WHEN up.s1 IS DISTINCT FROM up.s12 THEN jsonb_build_object('subcategoria1_id', jsonb_build_object(
                   'de', (SELECT s.nome FROM public.subcategorias1_produto s WHERE s.id = up.s1),
                   'para', (SELECT s.nome FROM public.subcategorias1_produto s WHERE s.id = up.s12))) ELSE '{}'::jsonb END)
           || (CASE WHEN up.s2 IS DISTINCT FROM up.s22 THEN jsonb_build_object('subcategoria2_id', jsonb_build_object(
                   'de', (SELECT s.nome FROM public.subcategorias2_produto s WHERE s.id = up.s2),
                   'para', (SELECT s.nome FROM public.subcategorias2_produto s WHERE s.id = up.s22))) ELSE '{}'::jsonb END)
      FROM up
    RETURNING id
  ), bkp AS (
    INSERT INTO public._bkp_p137_backfill (tabela, produto_id, tenant_id, modelo_id, grupo_de, categoria_de, sub1_de, sub2_de,
                                           grupo_para, categoria_para, sub1_para, sub2_para, audit_id)
    SELECT up.tabela, up.id, up.tenant_id, up.modelo_id, up.g, up.c, up.s1, up.s2, up.g2, up.c2, up.s12, up.s22, up.audit_id
      FROM up
    RETURNING id
  ), loja AS (
    SELECT k.tipo, k.tenant_id,
           count(*) AS total,
           count(*) FILTER (WHERE k.divergente) AS divergentes,
           count(*) FILTER (WHERE k.situacao = 'arrumar') AS a_arrumar,
           count(*) FILTER (WHERE k.situacao = 'card_sem_categoria') AS pula_card_sem_categoria,
           count(*) FILTER (WHERE k.situacao = 'categoria_sem_grupo') AS pula_categoria_sem_grupo,
           count(*) FILTER (WHERE k.situacao = 'acessorio_com_pedido') AS pula_acessorio_com_pedido,
           count(*) FILTER (WHERE k.situacao = 'so_null_no_card') AS fica_por_null_no_card
      FROM cls k GROUP BY k.tipo, k.tenant_id
  )
  SELECT jsonb_build_object(
           'arrumados', (SELECT count(*) FROM up),
           'auditoria', (SELECT count(*) FROM aud),
           'bkp', (SELECT count(*) FROM bkp),
           'divergentes', (SELECT count(*) FROM cls WHERE divergente),
           'a_arrumar', (SELECT count(*) FROM cls WHERE situacao = 'arrumar'),
           'pulados', jsonb_build_object(
              'card_sem_categoria', (SELECT count(*) FROM cls WHERE situacao = 'card_sem_categoria'),
              'categoria_sem_grupo', (SELECT count(*) FROM cls WHERE situacao = 'categoria_sem_grupo'),
              'acessorio_com_pedido', (SELECT count(*) FROM cls WHERE situacao = 'acessorio_com_pedido')),
           'fica_por_null_no_card', (SELECT count(*) FROM cls WHERE situacao = 'so_null_no_card'),
           'arrumados_ids', coalesce((SELECT jsonb_agg(id ORDER BY id) FROM up), '[]'::jsonb),
           'pulados_lista', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'produto_id', id, 'tenant_id', tenant_id,
                                                                          'motivo', situacao) ORDER BY tipo, id)
                                        FROM cls WHERE situacao IN ('card_sem_categoria', 'categoria_sem_grupo', 'acessorio_com_pedido')),
                                     '[]'::jsonb),
           'por_loja', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.tipo, l.tenant_id) FROM loja l), '[]'::jsonb))
    INTO v_res;
  RETURN v_res;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._p137_backfill_rodar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._p137_backfill_desfazer()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_n int := 0;
  v_ok int := 0;
  v_nao jsonb := '[]'::jsonb;
  v_achou boolean;
BEGIN
  -- Mais recente primeiro (mais de uma ida = volta na ordem inversa). So devolve o "antes" onde o produto AINDA esta
  -- igual ao "depois" desta linha — edicao posterior (tela PA/PI ou gatilho do card) nao e desfeita.
  FOR r IN SELECT * FROM public._bkp_p137_backfill ORDER BY id DESC LOOP
    v_n := v_n + 1;
    IF r.tabela = 'produtos_acabados' THEN
      UPDATE public.produtos_acabados p
         SET grupo_id = r.grupo_de, categoria_id = r.categoria_de, subcategoria1_id = r.sub1_de,
             subcategoria2_id = r.sub2_de, updated_at = now()
       WHERE p.id = r.produto_id AND p.tenant_id = r.tenant_id
         AND p.grupo_id IS NOT DISTINCT FROM r.grupo_para AND p.categoria_id IS NOT DISTINCT FROM r.categoria_para
         AND p.subcategoria1_id IS NOT DISTINCT FROM r.sub1_para AND p.subcategoria2_id IS NOT DISTINCT FROM r.sub2_para;
    ELSE
      UPDATE public.produtos_importados p
         SET grupo_id = r.grupo_de, categoria_id = r.categoria_de, subcategoria1_id = r.sub1_de,
             subcategoria2_id = r.sub2_de, updated_at = now()
       WHERE p.id = r.produto_id AND p.tenant_id = r.tenant_id
         AND p.grupo_id IS NOT DISTINCT FROM r.grupo_para AND p.categoria_id IS NOT DISTINCT FROM r.categoria_para
         AND p.subcategoria1_id IS NOT DISTINCT FROM r.sub1_para AND p.subcategoria2_id IS NOT DISTINCT FROM r.sub2_para;
    END IF;
    v_achou := FOUND;
    IF v_achou THEN
      v_ok := v_ok + 1;
      INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
      SELECT r.tenant_id, NULL, 'Sistema', 'editar',
             CASE r.tabela WHEN 'produtos_acabados' THEN 'Produto Acabado' ELSE 'Produto Importado' END,
             r.tabela, r.produto_id,
             'Sistema: categoria do produto devolvida (volta da P-137)',
             (CASE WHEN r.grupo_para IS DISTINCT FROM r.grupo_de THEN jsonb_build_object('grupo_id', jsonb_build_object(
                     'de', (SELECT gp.nome FROM public.grupos_produto gp WHERE gp.id = r.grupo_para),
                     'para', (SELECT gp.nome FROM public.grupos_produto gp WHERE gp.id = r.grupo_de))) ELSE '{}'::jsonb END)
             || (CASE WHEN r.categoria_para IS DISTINCT FROM r.categoria_de THEN jsonb_build_object('categoria_id', jsonb_build_object(
                     'de', (SELECT cp.nome FROM public.categorias_produto cp WHERE cp.id = r.categoria_para),
                     'para', (SELECT cp.nome FROM public.categorias_produto cp WHERE cp.id = r.categoria_de))) ELSE '{}'::jsonb END)
             || (CASE WHEN r.sub1_para IS DISTINCT FROM r.sub1_de THEN jsonb_build_object('subcategoria1_id', jsonb_build_object(
                     'de', (SELECT s.nome FROM public.subcategorias1_produto s WHERE s.id = r.sub1_para),
                     'para', (SELECT s.nome FROM public.subcategorias1_produto s WHERE s.id = r.sub1_de))) ELSE '{}'::jsonb END)
             || (CASE WHEN r.sub2_para IS DISTINCT FROM r.sub2_de THEN jsonb_build_object('subcategoria2_id', jsonb_build_object(
                     'de', (SELECT s.nome FROM public.subcategorias2_produto s WHERE s.id = r.sub2_para),
                     'para', (SELECT s.nome FROM public.subcategorias2_produto s WHERE s.id = r.sub2_de))) ELSE '{}'::jsonb END);
    ELSE
      v_nao := v_nao || jsonb_build_array(r.produto_id);
    END IF;
  END LOOP;
  DELETE FROM public._bkp_p137_backfill;
  RETURN jsonb_build_object('registradas', v_n, 'devolvidas', v_ok, 'nao_devolvidas', v_n - v_ok, 'nao_devolvidas_ids', v_nao);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._p137_backfill_desfazer() FROM PUBLIC, anon, authenticated;

DO $backfill$
DECLARE
  v jsonb;
  l jsonb;
BEGIN
  v := public._p137_backfill_rodar();
  RAISE NOTICE 'p137_backfill: arrumados % | divergentes (antes) % | pulados: card sem categoria %, categoria sem grupo %, acessorio com pedido % | ficam divergentes so por NULL no card %',
    v->>'arrumados', v->>'divergentes', v->'pulados'->>'card_sem_categoria', v->'pulados'->>'categoria_sem_grupo',
    v->'pulados'->>'acessorio_com_pedido', v->>'fica_por_null_no_card';
  FOR l IN SELECT jsonb_array_elements(v->'por_loja') LOOP
    RAISE NOTICE 'p137_backfill: % loja % -> total %, divergentes %, arrumar %, pula(sem categoria %, sem grupo %, acessorio+pedido %), so NULL no card %',
      l->>'tipo', l->>'tenant_id', l->>'total', l->>'divergentes', l->>'a_arrumar', l->>'pula_card_sem_categoria',
      l->>'pula_categoria_sem_grupo', l->>'pula_acessorio_com_pedido', l->>'fica_por_null_no_card';
  END LOOP;
  FOR l IN SELECT jsonb_array_elements(v->'pulados_lista') LOOP
    RAISE NOTICE 'p137_backfill: PULADO % produto % (loja %) motivo %', l->>'tipo', l->>'produto_id', l->>'tenant_id', l->>'motivo';
  END LOOP;
  IF (v->>'arrumados')::int IS DISTINCT FROM (v->>'a_arrumar')::int THEN
    RAISE EXCEPTION 'p137_backfill: % a arrumar mas so % arrumados (gravacao concorrente?) - desfazendo; rode de novo em horario calmo',
      v->>'a_arrumar', v->>'arrumados' USING ERRCODE = 'P0001';
  END IF;
  IF (v->>'auditoria')::int IS DISTINCT FROM (v->>'arrumados')::int OR (v->>'bkp')::int IS DISTINCT FROM (v->>'arrumados')::int THEN
    RAISE EXCEPTION 'p137_backfill: auditoria/_bkp (% / %) diferente de arrumados (%)', v->>'auditoria', v->>'bkp', v->>'arrumados' USING ERRCODE = 'P0001';
  END IF;
END $backfill$;

DO $pos$
DECLARE
  v_md5 text;
  v jsonb;
BEGIN
  -- Autocheck: rodar de novo (DENTRO desta transacao) nao acha mais nada a arrumar. Sub-bloco com EXCEPTION = savepoint:
  -- a 2a rodada e sempre desfeita (so a contagem interessa).
  BEGIN
    v := public._p137_backfill_rodar();
    RAISE EXCEPTION USING ERRCODE = 'PX137', MESSAGE = coalesce(v->>'a_arrumar', 'null');
  EXCEPTION WHEN SQLSTATE 'PX137' THEN
    IF SQLERRM IS DISTINCT FROM '0' THEN
      RAISE EXCEPTION 'p137_backfill: pos-condicao falhou - ainda ha % produto(s) a arrumar', SQLERRM USING ERRCODE = 'P0001';
    END IF;
  END;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._p137_backfill_rodar()')));
  IF v_md5 IS DISTINCT FROM 'fa343381c1d7d2ed3422255312b9fad7' THEN
    RAISE EXCEPTION 'p137_backfill: pos-condicao falhou - _p137_backfill_rodar com outro texto (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._p137_backfill_desfazer()')));
  IF v_md5 IS DISTINCT FROM '14780b0ee671098f3da1440481a466e4' THEN
    RAISE EXCEPTION 'p137_backfill: pos-condicao falhou - _p137_backfill_desfazer com outro texto (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public._p137_backfill_rodar()', 'EXECUTE')
     OR has_function_privilege('anon', 'public._p137_backfill_rodar()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._p137_backfill_rodar()', 'EXECUTE')
     OR has_function_privilege('public', 'public._p137_backfill_desfazer()', 'EXECUTE')
     OR has_function_privilege('anon', 'public._p137_backfill_desfazer()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._p137_backfill_desfazer()', 'EXECUTE') THEN
    RAISE EXCEPTION 'p137_backfill: pos-condicao falhou - funcoes do backfill com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public._bkp_p137_backfill', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_p137_backfill', 'SELECT')
     OR has_table_privilege('service_role', 'public._bkp_p137_backfill', 'SELECT') THEN
    RAISE EXCEPTION 'p137_backfill: pos-condicao falhou - _bkp_p137_backfill legivel por anon/authenticated/service_role' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;

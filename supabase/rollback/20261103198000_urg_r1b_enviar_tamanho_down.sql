-- Inverso de supabase/migrations/20261103198000_urg_r1b_enviar_tamanho.sql - GERADO por .superpowers/sdd/2026-10-06-r1b/gerar/gerar.py (nunca editar a mao; rode o gerador de novo).
-- 1) devolve cad_etiquetas.quantidade_enviar ao "antes" do backup (ultima gravacao AINDA NAO DEVOLVIDA de cada linha) SO onde o valor
--    de hoje ainda e o "depois" da correcao E o CAD segue fora do PCP; o que a pessoa mudou depois, a linha que sumiu (Salvar do CAD
--    regrava as linhas) e o CAD ja enviado ao PCP FICAM e sao RELATADOS (NOTICE); marca as gravacoes como devolvidas
--    (restaurado_em) - um 2o _down e no-op. Trava (so com pendencia): card -> CAD -> cad -> cad_etiquetas, a ordem da R4.
-- 2) NEUTRALIZA _urg_r1b_enviar_rodar e _urg_r1b_enviar_previa (CREATE OR REPLACE: passam a recusar; nao citam mais os helpers da
--    170000, cujo _down_drop varre o prosrc). A tabela de backup FICA (e o dado de auditoria). Idempotente.
-- Volta LIFO: este arquivo vem ANTES dos _down da Onda 1 (171000/170500/170000).
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
      ('public._urg_r1b_enviar_previa()', '1158cdbfeaf90192295dfc9f4fdd9295', 'db45b0b5ef1f5d901d6d916231d7b922'),
      ('public._urg_r1b_enviar_rodar(jsonb,text,integer)', 'a2e58118486c39206fbcf31f192f1e06', 'ee1f3f18beed61a257e00937e543ac29')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r1b_198000_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public._urg_r1b_enviar_previa()') IS NULL OR to_regprocedure('public._urg_r1b_enviar_rodar(jsonb,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'urg_r1b_198000_down: as funcoes da 20261103198000 nao existem - nada a voltar' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public._bkp_urg_r1b_enviar') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = to_regclass('public._bkp_urg_r1b_enviar') AND a.attnum > 0 AND NOT a.attisdropped)
         IS DISTINCT FROM 'id:bigint:true,cad_etiqueta_id:uuid:true,cad_id:uuid:true,tenant_id:uuid:true,antes:numeric:true,depois:numeric:true,rodado_em:timestamp with time zone:true,restaurado_em:timestamp with time zone:false' THEN
    RAISE EXCEPTION 'urg_r1b_198000_down: public._bkp_urg_r1b_enviar ja existe com outro formato' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $volta$
DECLARE
  v_dev integer := 0;
  v_mud integer := 0;
  v_mud_ids text;
  v_sum integer := 0;
  v_pcp integer := 0;
  v_ja_antes integer := 0;
BEGIN
  IF to_regclass('public._bkp_urg_r1b_enviar') IS NULL THEN
    RAISE NOTICE 'urg_r1b_198000_down: sem tabela de backup - nada a devolver';
    RETURN;
  END IF;
  -- so as gravacoes ainda NAO devolvidas; sem pendencia = no-op, sem trava de linha (a cadeia LIFO dos testes chama este _down)
  IF NOT EXISTS (SELECT 1 FROM public._bkp_urg_r1b_enviar k WHERE k.restaurado_em IS NULL) THEN
    RAISE NOTICE 'urg_r1b_198000_down: nada pendente no backup (ja devolvido ou vazio) - no-op';
    RETURN;
  END IF;
  IF current_setting('lock_timeout') IN ('0', '0ms') THEN
    PERFORM set_config('lock_timeout', '3s', true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || x.modelo_id::text))
     FROM (SELECT DISTINCT c.modelo_id FROM public.cad c
            WHERE c.id IN (SELECT k.cad_id FROM public._bkp_urg_r1b_enviar k WHERE k.restaurado_em IS NULL) AND c.modelo_id IS NOT NULL
            ORDER BY c.modelo_id) x;
  PERFORM pg_advisory_xact_lock(hashtext(x.id::text))
     FROM (SELECT c.id FROM public.cad c WHERE c.id IN (SELECT k.cad_id FROM public._bkp_urg_r1b_enviar k WHERE k.restaurado_em IS NULL) ORDER BY c.id) x;
  PERFORM 1 FROM public.cad c WHERE c.id IN (SELECT k.cad_id FROM public._bkp_urg_r1b_enviar k WHERE k.restaurado_em IS NULL) ORDER BY c.id FOR UPDATE;
  PERFORM 1 FROM public.cad_etiquetas ce
    WHERE ce.id IN (SELECT k.cad_etiqueta_id FROM public._bkp_urg_r1b_enviar k WHERE k.restaurado_em IS NULL) ORDER BY ce.id FOR UPDATE;

  WITH ult AS (
      SELECT DISTINCT ON (k.cad_etiqueta_id) k.cad_etiqueta_id, k.cad_id, k.antes, k.depois
        FROM public._bkp_urg_r1b_enviar k
       WHERE k.restaurado_em IS NULL
       ORDER BY k.cad_etiqueta_id, k.rodado_em DESC, k.id DESC
  )
  SELECT count(*) FILTER (WHERE ce.id IS NULL)::integer,
         count(*) FILTER (WHERE ce.id IS NOT NULL AND ce.quantidade_enviar IS NOT DISTINCT FROM u.depois AND coalesce(c.enviado_corte, false))::integer,
         count(*) FILTER (WHERE ce.id IS NOT NULL AND ce.quantidade_enviar IS DISTINCT FROM u.depois AND ce.quantidade_enviar IS DISTINCT FROM u.antes)::integer,
         count(*) FILTER (WHERE ce.id IS NOT NULL AND ce.quantidade_enviar IS DISTINCT FROM u.depois AND ce.quantidade_enviar IS NOT DISTINCT FROM u.antes)::integer,
         string_agg(CAST(u.cad_etiqueta_id AS text), ', ' ORDER BY u.cad_etiqueta_id)
           FILTER (WHERE ce.id IS NULL OR ce.quantidade_enviar IS DISTINCT FROM u.depois OR coalesce(c.enviado_corte, false))
    INTO v_sum, v_pcp, v_mud, v_ja_antes, v_mud_ids
    FROM ult u
    LEFT JOIN public.cad_etiquetas ce ON ce.id = u.cad_etiqueta_id
    LEFT JOIN public.cad c ON c.id = ce.cad_id;

  WITH ult AS (
      SELECT DISTINCT ON (k.cad_etiqueta_id) k.cad_etiqueta_id, k.cad_id, k.antes, k.depois
        FROM public._bkp_urg_r1b_enviar k
       WHERE k.restaurado_em IS NULL
       ORDER BY k.cad_etiqueta_id, k.rodado_em DESC, k.id DESC
  ), dev AS (
    UPDATE public.cad_etiquetas ce
       SET quantidade_enviar = u.antes
      FROM ult u, public.cad c
     WHERE ce.id = u.cad_etiqueta_id AND c.id = ce.cad_id AND NOT coalesce(c.enviado_corte, false)
       AND ce.quantidade_enviar IS NOT DISTINCT FROM u.depois
    RETURNING ce.id
  )
  SELECT count(*)::integer INTO v_dev FROM dev;
  UPDATE public._bkp_urg_r1b_enviar SET restaurado_em = now() WHERE restaurado_em IS NULL;
  -- as 4 contagens do que FICA usam o MESMO predicado da lista de ids (soma = n de ids)
  RAISE NOTICE 'urg_r1b_198000_down: % linha(s) devolvida(s) ao valor de antes; ficam: % mudada(s) pela pessoa, % ja no valor de antes, % de CAD ja enviado ao PCP, % que sumiram (CAD regravado): %',
    v_dev, v_mud, v_ja_antes, v_pcp, v_sum, coalesce(v_mud_ids, '-');
END
$volta$;

CREATE OR REPLACE FUNCTION public._urg_r1b_enviar_previa()
 RETURNS TABLE(tenant_id uuid, cad_id uuid, cad_etiqueta_id uuid, modelo_id uuid, modelo text, insumo text, tamanho text, consumo numeric, total numeric, pecas numeric, antigo numeric, necessaria numeric, atual numeric, antes numeric, depois numeric, elegivel boolean, motivo text, situacao text, aviso text, info text, linha text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r1b] NEUTRALIZADA pelo _down da 20261103198000 (a correcao unica do "a enviar" nao roda mais).
BEGIN
  RAISE EXCEPTION 'urg_r1b_enviar_desativada: o _down da 20261103198000 neutralizou esta funcao - reaplique a ida para usar' USING ERRCODE = 'P0001';
END
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1b_enviar_previa() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._urg_r1b_enviar_rodar(_aprovado jsonb, _hash text, _n integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r1b] NEUTRALIZADA pelo _down da 20261103198000 (a correcao unica do "a enviar" nao roda mais).
BEGIN
  RAISE EXCEPTION 'urg_r1b_enviar_desativada: o _down da 20261103198000 neutralizou esta funcao - reaplique a ida para usar' USING ERRCODE = 'P0001';
END
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1b_enviar_rodar(jsonb,text,integer) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._urg_r1b_enviar_previa()'))) IS DISTINCT FROM 'db45b0b5ef1f5d901d6d916231d7b922'
     OR md5(pg_get_functiondef(to_regprocedure('public._urg_r1b_enviar_rodar(jsonb,text,integer)'))) IS DISTINCT FROM 'ee1f3f18beed61a257e00937e543ac29' THEN
    RAISE EXCEPTION 'urg_r1b_198000_down: pos-condicao falhou (funcoes nao estao no texto neutro)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('public._urg_r1b_enviar_previa()'), ('public._urg_r1b_enviar_rodar(jsonb,text,integer)')) AS x(f) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r1b_198000_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;

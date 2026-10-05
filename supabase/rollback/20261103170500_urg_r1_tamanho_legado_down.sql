-- Inverso de supabase/migrations/20261103170500_urg_r1_tamanho_legado.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- 1) devolve etiquetas.tamanho_vinculado ao "antes" do backup (ultima gravacao de cada insumo) SO onde o valor de hoje ainda e o
--    "depois" da correcao; o que a pessoa mudou depois FICA e e RELATADO (NOTICE com os ids). Com a 171000 viva, cada devolucao
--    enfileira o custo previsto dos modelos internos nao cortados (como qualquer mudanca de vinculo).
-- 2) NEUTRALIZA _urg_r1_tamanho_legado_rodar e _lista (CREATE OR REPLACE: passam a recusar; nao citam mais a coluna nem os helpers
--    da 170000, cujo _down_drop varre o prosrc). A tabela de backup FICA (e o dado de auditoria). Idempotente.
-- Volta LIFO: este arquivo vem ANTES do 20261103170000_down. Trava: linhas de etiquetas devolvidas (ms) + catalogo.
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
      ('public._urg_r1_tamanho_legado_lista()', '143abc25ee038ec27bd246e51ef0fbcb', 'ec571c054460a10676852e532c931e03'),
      ('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)', '6d5f3f2998d22ed72fc5ac479932eb44', 'f7d613fb53dbaef6be59c467bbaad580')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r1_170500_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public._urg_r1_tamanho_legado_lista()') IS NULL OR to_regprocedure('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'urg_r1_170500_down: as funcoes da 20261103170500 nao existem - nada a voltar' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public._bkp_urg_r1_tamanho_legado') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = to_regclass('public._bkp_urg_r1_tamanho_legado') AND a.attnum > 0 AND NOT a.attisdropped)
         IS DISTINCT FROM 'id:bigint:true,etiqueta_id:uuid:true,tenant_id:uuid:true,antes:text:false,depois:text:true,rodado_em:timestamp with time zone:true' THEN
    RAISE EXCEPTION 'urg_r1_170500_down: public._bkp_urg_r1_tamanho_legado ja existe com outro formato' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $volta$
DECLARE
  v_dev integer := 0;
  v_mud integer := 0;
  v_ids text;
BEGIN
  IF to_regclass('public._bkp_urg_r1_tamanho_legado') IS NULL THEN
    RAISE NOTICE 'urg_r1_170500_down: sem tabela de backup - nenhum vinculo a devolver';
    RETURN;
  END IF;
  -- sem nada a devolver nao ha UPDATE (nem RowExclusiveLock em etiquetas): a cadeia LIFO dos testes chama este _down a toda hora
  IF NOT EXISTS (
    SELECT 1
      FROM (SELECT DISTINCT ON (k.etiqueta_id) k.etiqueta_id, k.depois
              FROM public._bkp_urg_r1_tamanho_legado k
             ORDER BY k.etiqueta_id, k.rodado_em DESC, k.id DESC) u
      JOIN public.etiquetas e ON e.id = u.etiqueta_id
     WHERE e.tamanho_vinculado IS NOT DISTINCT FROM u.depois) THEN
    RAISE NOTICE 'urg_r1_170500_down: nenhum vinculo da correcao a devolver';
  ELSE
  WITH ult AS (
    SELECT DISTINCT ON (k.etiqueta_id) k.etiqueta_id, k.antes, k.depois
      FROM public._bkp_urg_r1_tamanho_legado k
     ORDER BY k.etiqueta_id, k.rodado_em DESC, k.id DESC
  ), dev AS (
    UPDATE public.etiquetas e
       SET tamanho_vinculado = u.antes
      FROM ult u
     WHERE e.id = u.etiqueta_id AND e.tamanho_vinculado IS NOT DISTINCT FROM u.depois
    RETURNING e.id
  )
  SELECT count(*)::integer INTO v_dev FROM dev;
  END IF;
  WITH ult AS (
    SELECT DISTINCT ON (k.etiqueta_id) k.etiqueta_id, k.antes, k.depois
      FROM public._bkp_urg_r1_tamanho_legado k
     ORDER BY k.etiqueta_id, k.rodado_em DESC, k.id DESC
  )
  SELECT count(*)::integer, string_agg(CAST(u.etiqueta_id AS text), ', ' ORDER BY u.etiqueta_id)
    INTO v_mud, v_ids
    FROM ult u JOIN public.etiquetas e ON e.id = u.etiqueta_id
   WHERE e.tamanho_vinculado IS DISTINCT FROM u.depois AND e.tamanho_vinculado IS DISTINCT FROM u.antes;
  RAISE NOTICE 'urg_r1_170500_down: % vinculo(s) devolvido(s) ao valor de antes; % mudado(s) pela pessoa depois da correcao (ficam): %',
    v_dev, v_mud, coalesce(v_ids, '-');
END
$volta$;

CREATE OR REPLACE FUNCTION public._urg_r1_tamanho_legado_lista()
 RETURNS TABLE(tenant_id uuid, etiqueta_id uuid, nome text, valor text, n_modelos integer, elegivel boolean, motivo text, vinculo_atual text, linha text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r1 T2b] NEUTRALIZADA pelo _down da 20261103170500 (a correcao unica do tamanho legado nao roda mais).
BEGIN
  RAISE EXCEPTION 'urg_r1_tamanho_legado_desativada: o _down da 20261103170500 neutralizou esta funcao - reaplique a ida para usar' USING ERRCODE = 'P0001';
END
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1_tamanho_legado_lista() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._urg_r1_tamanho_legado_rodar(_aprovado jsonb, _hash text, _n integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r1 T2b] NEUTRALIZADA pelo _down da 20261103170500 (a correcao unica do tamanho legado nao roda mais).
BEGIN
  RAISE EXCEPTION 'urg_r1_tamanho_legado_desativada: o _down da 20261103170500 neutralizou esta funcao - reaplique a ida para usar' USING ERRCODE = 'P0001';
END
$function$;
REVOKE EXECUTE ON FUNCTION public._urg_r1_tamanho_legado_rodar(jsonb,text,integer) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._urg_r1_tamanho_legado_lista()'))) IS DISTINCT FROM 'ec571c054460a10676852e532c931e03'
     OR md5(pg_get_functiondef(to_regprocedure('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)'))) IS DISTINCT FROM 'f7d613fb53dbaef6be59c467bbaad580' THEN
    RAISE EXCEPTION 'urg_r1_170500_down: pos-condicao falhou (funcoes nao estao no texto neutro)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('public._urg_r1_tamanho_legado_lista()'), ('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)')) AS x(f) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r1_170500_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;

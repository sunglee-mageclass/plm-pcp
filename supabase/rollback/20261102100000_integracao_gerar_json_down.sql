-- INVERSO (passo 1 de 2) de supabase/migrations/20261102100000_integracao_gerar_json.sql ("Gerar JSON", entrega manual).
-- NEUTRALIZA as 2 RPCs novas: integracao_gerar_json_ler e integracao_gerar_json_confirmar continuam existindo, com a MESMA
-- assinatura e o MESMO ACL (CREATE OR REPLACE mantém o proacl), mas só conferem a permissão (`_integracao_exige(true)`) e recusam
-- com P0001 `gerar_json_desligado:` (a tela traduz). Sem DROP, sem trava de tabela — pode rodar a qualquer hora.
-- O CHECK integracao_acessos_modo_chk ampliado ('manual') e os acessos/registros de Log das gerações manuais FICAM (inertes);
-- produto integrado manualmente SEGUE integrado (o Desfazer do super admin é o caminho por produto).
-- Ordem (LIFO): o SITE volta primeiro; este passo vem logo depois e ANTES dos inversos da A2 (20261030130000) e da volta de
-- emergência da Integração. Passo 2 (SEPARADO, opcional, horário calmo):
-- supabase/rollback/20261102100000_integracao_gerar_json_down_drop.sql.
-- Guarda: as 2 funções com o texto da ida (md5 7a76ace85f5620dbec943c34a3890e4c / e53973ef946a10dded322143f036508d) ou já neutralizadas
-- (md5 4b96da8c8d2b529d4fbcf99e52c1dc9f / 78ccc308fdfc2456b2fee148d0c61287) — idempotente.
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- 55P03/40P01 = rodar o arquivo de novo.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_gerar_json_ler(uuid[],uuid)')));
  IF v IS NULL OR v NOT IN ('7a76ace85f5620dbec943c34a3890e4c', '4b96da8c8d2b529d4fbcf99e52c1dc9f') THEN
    RAISE EXCEPTION 'gerar_json_volta: public.integracao_gerar_json_ler ausente ou com texto inesperado (md5 %)', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_gerar_json_confirmar(uuid,jsonb)')));
  IF v IS NULL OR v NOT IN ('e53973ef946a10dded322143f036508d', '78ccc308fdfc2456b2fee148d0c61287') THEN
    RAISE EXCEPTION 'gerar_json_volta: public.integracao_gerar_json_confirmar ausente ou com texto inesperado (md5 %)', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.integracao_gerar_json_ler(_modelo_ids uuid[], _loja uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- NEUTRALIZADA pelo inverso da 20261102100000 (Gerar JSON): recurso desligado (permissao conferida antes).
  PERFORM public._integracao_exige(true);
  RAISE EXCEPTION 'gerar_json_desligado: recurso desligado' USING ERRCODE = 'P0001';
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_gerar_json_confirmar(_acesso_id uuid, _entrega jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- NEUTRALIZADA pelo inverso da 20261102100000 (Gerar JSON): recurso desligado (permissao conferida antes).
  PERFORM public._integracao_exige(true);
  RAISE EXCEPTION 'gerar_json_desligado: recurso desligado' USING ERRCODE = 'P0001';
END
$function$;

DO $pos$
DECLARE
  d record;
BEGIN
  FOR d IN
    SELECT * FROM (VALUES
      ('public.integracao_gerar_json_ler(uuid[],uuid)', '4b96da8c8d2b529d4fbcf99e52c1dc9f'),
      ('public.integracao_gerar_json_confirmar(uuid,jsonb)', '78ccc308fdfc2456b2fee148d0c61287')) AS t(f, m)
  LOOP
    IF md5(pg_get_functiondef(to_regprocedure(d.f))) IS DISTINCT FROM d.m THEN
      RAISE EXCEPTION 'gerar_json_volta: pos-condicao falhou em % (md5 %)', d.f, md5(pg_get_functiondef(to_regprocedure(d.f)))
        USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', d.f, 'EXECUTE') OR NOT has_function_privilege('authenticated', d.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM aclexplode((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(d.f))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'gerar_json_volta: ACL inesperada em % (inv. 9)', d.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

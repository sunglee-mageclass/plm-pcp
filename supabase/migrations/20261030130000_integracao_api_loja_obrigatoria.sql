-- Release A2 — API da Integração: parâmetro `loja` OBRIGATÓRIO (P-224 B+, dono 03/out). Plano
-- .superpowers/sdd/2026-10-03-api-objetos/plan.md (rulings do controlador). Entra no deploy único (P-225 A), depois da I3.
-- O que muda (SÓ isto; `_integracao_ler` NÃO é redefinida — md5 encadeado das outras frentes):
--   • public._integracao_ler_loja(_chave_hash, _loja uuid, _incluir_integrados, _cursor, _limite, _modo, _ip) — NOVA, SECURITY
--     DEFINER, search_path=public, EXECUTE SÓ service_role (REVOKE de PUBLIC/anon/authenticated — inv. 9). Resolve a chave com a
--     MESMA consulta de `_integracao_ler`:
--       - _loja NULL ou _modo fora de normal/teste → {status:'parametro_invalido'} (nada registrado — igual ao modo inválido de hoje);
--       - chave inválida/revogada → delega a `_integracao_ler` (que conta a tentativa errada no bloqueio de IP, como hoje);
--       - chave VÁLIDA e tenant_id ≠ _loja → grava no Log de acessos (integracao_acessos) status 'loja_nao_autorizada', AGREGADO
--         por chave×minuto ('lna:<chave_id>' — NÃO conta no bloqueio de IP, que só lê 'inv:<ip>', e NÃO consome o limite por
--         minuto, que só conta linhas com agregado NULL) e devolve {status:'loja_nao_autorizada', tenant_id} — nada é entregue
--         nem confirmado (a rota responde 403 sem chamar a fase 2);
--       - senão → delega a `_integracao_ler(...)` tal qual.
--   • CHECK integracao_acessos_status_chk ampliado com 'loja_nao_autorizada' (AccessExclusive em integracao_acessos por um
--     instante: lock_timeout 500 ms, o kit tenta 3×; a tabela é pequena — limpeza de 90 dias).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)  NOVA d5bf36c5c1cefa550414e11db002efa7
--     (a guarda aceita tambem ccfa5fa7d3867203259c5dcc8039ca31 = neutralizada pelo _down: reaplicar a ida por cima da volta
--      parcial volta ao texto da ida, sem precisar do _down_drop)
--   dep (intocada): public._integracao_ler(text,boolean,text,integer,text,text) 1ac58b343e992fefe0062dac512e11eb
-- ====================================================================================
-- Sem DROP, sem gatilho, sem policy (não prende auth/storage). Idempotente (guarda aceita antes OU depois).
-- Site velho + banco novo: ok (o site velho chama `_integracao_ler` direto, que segue igual e com EXECUTE p/ service_role).
-- Site novo + banco velho: a API responde 500 (a função nova não existe) — por isso o banco vai ANTES do site.
-- Volta (LIFO): SITE primeiro; depois supabase/rollback/20261030130000_integracao_api_loja_obrigatoria_down.sql (neutraliza: a
-- função passa a só delegar, sem checar a loja — CREATE OR REPLACE, sem trava de tabela) e, opcional/separado,
-- supabase/rollback/20261030130000_integracao_api_loja_obrigatoria_down_drop.sql (DROP da função + CHECK de volta; apaga os
-- registros 'loja_nao_autorizada' do Log de acessos). ANTES dos inversos da I3 (20261030120000/110000/100000).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
  v_chk text;
BEGIN
  IF to_regclass('public.integracao_acessos') IS NULL OR to_regclass('public.integracao_chaves') IS NULL THEN
    RAISE EXCEPTION 'a2_loja: tabelas da Integracao ausentes' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)')));
  IF v IS DISTINCT FROM '1ac58b343e992fefe0062dac512e11eb' THEN
    RAISE EXCEPTION 'a2_loja: dependencia public._integracao_ler com texto inesperado (md5 %)', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)')));
  -- fix round 1 (B1): aceita tambem o texto NEUTRALIZADO pelo _down (ccfa5fa7) - reaplicar a ida depois de uma volta
  -- parcial (site + _down) nao exige o _down_drop (que apaga registros do Log de acessos)
  IF v IS NOT NULL AND v NOT IN ('d5bf36c5c1cefa550414e11db002efa7', 'ccfa5fa7d3867203259c5dcc8039ca31') THEN
    RAISE EXCEPTION 'a2_loja: public._integracao_ler_loja ja existe com outro texto (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_chk FROM pg_constraint c
   WHERE c.conrelid = 'public.integracao_acessos'::regclass AND c.conname = 'integracao_acessos_status_chk';
  IF v_chk IS DISTINCT FROM 'CHECK ((status = ANY (ARRAY[''reservado''::text, ''ok''::text, ''teste''::text, ''chave_invalida''::text, ''loja_inativa''::text, ''ip_bloqueado''::text, ''limite_excedido''::text])))'
     AND v_chk IS DISTINCT FROM 'CHECK ((status = ANY (ARRAY[''reservado''::text, ''ok''::text, ''teste''::text, ''chave_invalida''::text, ''loja_inativa''::text, ''ip_bloqueado''::text, ''limite_excedido''::text, ''loja_nao_autorizada''::text])))' THEN
    RAISE EXCEPTION 'a2_loja: CHECK integracao_acessos_status_chk inesperado: %', coalesce(v_chk, 'ausente') USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER TABLE public.integracao_acessos DROP CONSTRAINT IF EXISTS integracao_acessos_status_chk;
ALTER TABLE public.integracao_acessos ADD CONSTRAINT integracao_acessos_status_chk
  CHECK (status IN ('reservado', 'ok', 'teste', 'chave_invalida', 'loja_inativa', 'ip_bloqueado', 'limite_excedido', 'loja_nao_autorizada'));

CREATE OR REPLACE FUNCTION public._integracao_ler_loja(_chave_hash text, _loja uuid, _incluir_integrados boolean, _cursor text, _limite integer, _modo text, _ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text := left(coalesce(nullif(btrim(coalesce(_ip, '')), ''), 'desconhecido'), 64);
  k public.integracao_chaves%ROWTYPE;
BEGIN
  -- Release A2 (P-224 B+): a loja pedida tem de ser a loja da chave. _integracao_ler NAO e redefinida (md5 encadeado).
  IF _loja IS NULL OR _modo IS NULL OR _modo NOT IN ('normal', 'teste') THEN
    RETURN jsonb_build_object('status', 'parametro_invalido');
  END IF;
  -- mesma consulta de _integracao_ler; chave invalida/revogada => delega (ela conta a tentativa errada no bloqueio de IP)
  SELECT * INTO k FROM public.integracao_chaves WHERE hash = lower(coalesce(_chave_hash, '')) AND revogada_em IS NULL;
  IF FOUND AND k.tenant_id IS DISTINCT FROM _loja THEN
    -- agregado por chave x minuto: NAO conta no bloqueio de IP ('inv:<ip>') nem no limite por minuto (agregado IS NULL)
    INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas, detalhe)
    VALUES (k.tenant_id, k.id, v_ip, _modo, 'loja_nao_autorizada', 'lna:' || k.id::text, date_trunc('minute', now()), 1,
            jsonb_build_object('loja_pedida', _loja))
    ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
    RETURN jsonb_build_object('status', 'loja_nao_autorizada', 'tenant_id', k.tenant_id);
  END IF;
  RETURN public._integracao_ler(_chave_hash, _incluir_integrados, _cursor, _limite, _modo, _ip);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_ler_loja(text, uuid, boolean, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._integracao_ler_loja(text, uuid, boolean, text, integer, text, text) TO service_role;

DO $pos$
DECLARE
  f text := 'public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)';
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure(f)));
  IF v IS DISTINCT FROM 'd5bf36c5c1cefa550414e11db002efa7' THEN
    RAISE EXCEPTION 'a2_loja: pos-condicao falhou em % (md5 %)', f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(f))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR (SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(f)) IS NULL THEN
    RAISE EXCEPTION 'a2_loja: ACL inesperada em % (so service_role; PUBLIC/anon/authenticated nao - inv. 9)', f USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)')))
       IS DISTINCT FROM '1ac58b343e992fefe0062dac512e11eb' THEN
    RAISE EXCEPTION 'a2_loja: _integracao_ler mudou (nao deveria)' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.integracao_acessos'::regclass AND c.conname = 'integracao_acessos_status_chk') NOT LIKE '%''loja_nao_autorizada''%' THEN
    RAISE EXCEPTION 'a2_loja: pos-condicao falhou no CHECK de integracao_acessos' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

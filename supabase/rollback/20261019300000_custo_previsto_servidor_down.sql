-- INVERSO de supabase/migrations/20261019300000_custo_previsto_servidor.sql (contas certas C1; plano
-- .superpowers/sdd/2026-09-30-contas-certas-cd/plan-cd.md §4 C1/§6 + ruling R2 do G-plano do delta, que PREVALECE).
-- Em HORARIO CALMO (o ALTER TABLE ... DISABLE TRIGGER pega ShareRowExclusive nas 13 tabelas + na fila, por um instante;
-- NAO pega a trava de login/storage - so o DROP TRIGGER pega, e ele NAO esta aqui).
--   1. DESLIGA os 30 gatilhos da 20261019300000 (ALTER TABLE ... DISABLE TRIGGER);
--   2. NEUTRALIZA as funcoes de fila/processador/derivado (o MESMO texto do _down_neutraliza.sql; se o freio ja rodou, e no-op);
--   3. devolve o texto de ANTES de precos_tecido_congelado (guarda: tem de estar com o texto de DEPOIS ou ja com o de ANTES).
-- NAO apaga nada (RD1/R2: aposentar = ocultar primeiro): a fila, as funcoes novas e _precos_tecido_congelado_core ficam
-- (revogadas, sem uso). Os DROPs sao um passo SEPARADO e opcional: _down_drop.sql (transacao curtissima, horario calmo).
-- NAO mexe em valores gravados (o custo recalculado fica; restaurar o de antes e o 20261019310000_custo_previsto_restaurar.sql,
-- passo explicito do C2, so com decisao do dono).
-- Ordem geral: LIFO da APLICACAO; o site volta ANTES ou junto; 310000_down antes deste. Reaplicar a migration religa tudo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _cc_c1_neutro (assinatura text, md5_depois text, md5_neutro text) ON COMMIT DROP;
INSERT INTO _cc_c1_neutro VALUES
  ('public._custo_enfileirar(uuid[],boolean)',  'fd6a7337dd76a8a06b18d0040dd6abde',    '5db568ca49628eb2ed2e2cdf3c40afd7'),
  ('public.fn_custo_processar_fila()',          '3c8471bba6760986989ddc659dbee42f',   'e1ce39bcdbb607fe74ce887ab8d5b15c'),
  ('public.fn_custo_fila_por_modelo()',         'f4ae106c44af7759106d23223e56c677',    'e062138f732e9ddf18cfe3e382e9b9b0'),
  ('public.fn_custo_fila_por_modelo_tecido()',  '627ae4106dd610c339f413914bd5ac4c',   '15a053aef51fe9d18f8cd4ed60248dd7'),
  ('public.fn_custo_fila_preco()',              'cd405a624d82e23f0ce8120472f04471', 'c511be3920624e989008b9e628aaaa2e'),
  ('public.fn_custo_fila_cad()',                '382a1d5e86635d0bf9d2a114ca0b0a97',   '96077ec208a85505521ed98e5b745acf'),
  ('public.fn_custo_fila_modelo()',             'f1c2ba13e1d00d3344d7ebd16a12fce3',   '11c173d40243a20d0f9c292a4f57e525'),
  ('public.fn_modelo_custo_derivado()',         '8a1bb256740d5aa1a4f2084adc007587',  '9181312787be6e450371e1e80b039441');

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM _cc_c1_neutro LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_c1 (volta): % nao existe - a 20261019300000 nao esta aplicada', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5_depois AND v_md5 IS DISTINCT FROM r.md5_neutro THEN
      RAISE EXCEPTION 'contas_certas_c1 (volta): % com texto inesperado (md5 %)', r.assinatura, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v_md5 := md5(pg_get_functiondef('public.precos_tecido_congelado(uuid)'::regprocedure));
  IF v_md5 NOT IN ('b2fff3e9047b386be863e3807bfdcfaf', 'd6fa813be9e183be5f4e166e4c882218') THEN
    RAISE EXCEPTION 'contas_certas_c1 (volta): precos_tecido_congelado com texto inesperado (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- 1. desliga os gatilhos (sem DROP)
DO $desliga$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT t.tgname, t.tgrelid::regclass AS tabela FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND t.tgenabled <> 'D'
              AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado') LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', r.tabela, r.tgname);
  END LOOP;
END $desliga$;

-- 2. neutraliza (texto IDENTICO ao _down_neutraliza.sql)
CREATE OR REPLACE FUNCTION public._custo_enfileirar(_ids uuid[], _respeitar_congelado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: ninguem entra na fila de custo.
BEGIN
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_processar_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: o processador nao recalcula nada.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_por_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_por_modelo_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_preco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_modelo_custo_derivado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: o cliente volta a gravar o custo previsto (como antes).
BEGIN
  RETURN NEW;
END;
$function$;

-- 3. precos_tecido_congelado: o texto de ANTES (byte a byte = producao antes da 20261019300000, md5 d6fa813b...)
CREATE OR REPLACE FUNCTION public.precos_tecido_congelado(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_object_agg(s.k, s.ppm), '{}'::jsonb)
  FROM (
    SELECT l.tipo || '|' || l.numero AS k,
           MAX(CASE WHEN a.unidade_medida = 'kg' AND COALESCE(a.rendimento,0) > 0
                    THEN oti.preco / a.rendimento ELSE oti.preco END) AS ppm
    FROM public.modelo_tecido_oc_links l
    JOIN public.ocs_tecido_itens oti ON oti.id = l.oc_tecido_item_id
    JOIN public.variantes_tecido vt ON vt.id = l.variante_tecido_id
    JOIN public.artigos a ON a.id = vt.artigo_id
    WHERE l.modelo_id = _modelo_id
      AND l.tenant_id = public.get_user_tenant_id()
      AND oti.preco IS NOT NULL AND COALESCE(oti.cancelado,false) = false
    GROUP BY l.tipo, l.numero
  ) s;
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM _cc_c1_neutro LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5_neutro THEN
      RAISE EXCEPTION 'contas_certas_c1 (volta): % nao ficou neutralizada (md5 %)', r.assinatura, v_md5 USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.assinatura, 'EXECUTE') OR has_function_privilege('authenticated', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'contas_certas_c1 (volta): % ficou executavel por anon/authenticated', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v_md5 := md5(pg_get_functiondef('public.precos_tecido_congelado(uuid)'::regprocedure));
  IF v_md5 IS DISTINCT FROM 'd6fa813be9e183be5f4e166e4c882218' THEN
    RAISE EXCEPTION 'contas_certas_c1 (volta): precos_tecido_congelado nao voltou ao texto de antes (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.precos_tecido_congelado(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.precos_tecido_congelado(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_c1 (volta): ACL de precos_tecido_congelado mudou' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
              AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado')) THEN
    RAISE EXCEPTION 'contas_certas_c1 (volta): sobrou gatilho ligado' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Reforço de segurança — sub-release S3a ("Dinheiro, OCs e estoque de OC"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3a.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§1, §2.1-2.3, §3, §6 S3a); plano: plan.md (P-231 = D2 A).
-- Gatilho de PAGINA na escrita DIRETA (§1.2): trg_aaa_seg_pagina (BEFORE INSERT/UPDATE/DELETE, por linha) em ocs_tecido,
-- ocs_tecido_itens, ocs_aviamento e ocs_etiqueta, com funcao SECURITY INVOKER que so morde current_user authenticated/anon
-- (PostgREST): ocs_tecido = OC Tecido (so o endereco do rolo: OC Tecido OU Cadastro > Tecidos, C-22); itens = OC Tecido OU
-- Alertas de Tecido (C-23); aviamento = OC Aviamento; insumo = OC Insumo. Exige a 20261101100000 (helper) antes.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_ocs_tecido() (NOVA)
--     ANTES  ausente
--     DEPOIS da433617f6ded5c358788c659b639b03
--     NEUTRA 7d5383af4740bc09ae81bc01b5bf292d (o _down)
--   public.fn_seg_pagina_ocs_tecido_itens() (NOVA)
--     ANTES  ausente
--     DEPOIS 985617196668735f319e0e3ca27fc403
--     NEUTRA edf9eb7e9540238ea69dd079b8c537f2 (o _down)
--   public.fn_seg_pagina_ocs_aviamento() (NOVA)
--     ANTES  ausente
--     DEPOIS 6d17c1dc03677fa49e2c84a8098bed22
--     NEUTRA 11e5cc2eca4e53770eaa4868fa5f8cb7 (o _down)
--   public.fn_seg_pagina_ocs_etiqueta() (NOVA)
--     ANTES  ausente
--     DEPOIS 2419afb8e1b27625f0714657b5b77fc8
--     NEUTRA 32deaa83367e28390f3f2ecd77fd6cbb (o _down)
-- ====================================================================================
-- Trava: CREATE TRIGGER = ShareRowExclusive SÓ nas 4 tabelas de OC (ocs_tecido, ocs_tecido_itens, ocs_aviamento,
-- ocs_etiqueta), por um instante cada (não trava auth/storage — medido na C4/S2); o resto é catálogo. Horário calmo
-- (Entrada/OCs). Sem DROP (o DROP dos gatilhos fica no _down_drop separado).
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101120000_seg_s3a_guarda_oc_down.sql (LIFO: 20261101120000_down → 110000_down → 100000_down, ANTES dos inversos da S2/S1 e de
-- releases anteriores que guardam por md5 as mesmas funções — ver s3a-report.md, seção "Cadeia md5").
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  -- o helper da 20261101100000 tem de estar no banco (os gatilhos o chamam)
  IF md5(pg_get_functiondef(to_regprocedure('public._seg_exige_pagina(text[])'))) IS DISTINCT FROM '85eff0037e61fdecefb46154ac9479d2' THEN
    RAISE EXCEPTION 's3a_guarda: rode antes a 20261101100000 (_seg_exige_pagina ausente ou com texto inesperado)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_ocs_tecido()', 'da433617f6ded5c358788c659b639b03', '7d5383af4740bc09ae81bc01b5bf292d', 'ocs_tecido'),
      ('public.fn_seg_pagina_ocs_tecido_itens()', '985617196668735f319e0e3ca27fc403', 'edf9eb7e9540238ea69dd079b8c537f2', 'ocs_tecido_itens'),
      ('public.fn_seg_pagina_ocs_aviamento()', '6d17c1dc03677fa49e2c84a8098bed22', '11e5cc2eca4e53770eaa4868fa5f8cb7', 'ocs_aviamento'),
      ('public.fn_seg_pagina_ocs_etiqueta()', '2419afb8e1b27625f0714657b5b77fc8', '32deaa83367e28390f3f2ecd77fd6cbb', 'ocs_etiqueta')
    ) AS x(f, d, n, t) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3a_guarda: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3a_guarda: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] (Reforco de seguranca S3a, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em ocs_tecido.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina), CASCADE de FK (roda como o dono),
-- migrations/psql e service_role (Worker) passam. Gatilho trg_aaa_seg_pagina: o prefixo aaa roda ANTES dos outros BEFORE.
-- O cliente so tem UPDATE em nfs, recebimento_responsavel_id, recebimento_responsavel_nome, rolo_codigo, numero_pedido,
-- rolo_rua e rolo_prateleira (grant por coluna, 20261101110000; N8: valor_real_total/status/data_nota_entrada so pela RPC).
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'rolo_rua' - 'rolo_prateleira') = (to_jsonb(OLD) - 'rolo_rua' - 'rolo_prateleira') THEN
    -- so o endereco do rolo mudou: tambem pelo Cadastro > Tecido (EnderecoEditor, cruzamento C-22)
    PERFORM public._seg_exige_pagina('entrada_oc_tecido', 'cadastro_tecidos');
  ELSE
    PERFORM public._seg_exige_pagina('entrada_oc_tecido');
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_ocs_tecido() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_tecido_itens()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] (Reforco de seguranca S3a, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em ocs_tecido_itens.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina), CASCADE de FK (roda como o dono),
-- migrations/psql e service_role (Worker) passam. Gatilho trg_aaa_seg_pagina: o prefixo aaa roda ANTES dos outros BEFORE.
-- O cliente so tem UPDATE em cq_ok, cq_observacao, cq_alerta_status e cancelado (CQ de tecido da OC e dos Alertas, C-23).
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_tecido', 'entrada_alertas_tecido');
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_ocs_tecido_itens() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_aviamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] (Reforco de seguranca S3a, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em ocs_aviamento.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina), CASCADE de FK (roda como o dono),
-- migrations/psql e service_role (Worker) passam. Gatilho trg_aaa_seg_pagina: o prefixo aaa roda ANTES dos outros BEFORE.
-- O cliente so tem UPDATE em nfs e DELETE (excluir OC encomendada; os itens caem por CASCADE como o dono).
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_aviamento');
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_ocs_aviamento() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_etiqueta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] (Reforco de seguranca S3a, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em ocs_etiqueta.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina), CASCADE de FK (roda como o dono),
-- migrations/psql e service_role (Worker) passam. Gatilho trg_aaa_seg_pagina: o prefixo aaa roda ANTES dos outros BEFORE.
-- O cliente so tem UPDATE em data_nota_entrada (a Nota da OC de insumo; fn_oc_nota_entrada_valida/_recalc seguem) e DELETE.
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_insumo');
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_ocs_etiqueta() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ocs_tecido'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.ocs_tecido
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_ocs_tecido();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ocs_tecido_itens'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.ocs_tecido_itens
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_ocs_tecido_itens();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ocs_aviamento'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.ocs_aviamento
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_ocs_aviamento();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ocs_etiqueta'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.ocs_etiqueta
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_ocs_etiqueta();
  END IF;
END
$trg$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_ocs_tecido()', 'da433617f6ded5c358788c659b639b03', '7d5383af4740bc09ae81bc01b5bf292d', 'ocs_tecido'),
      ('public.fn_seg_pagina_ocs_tecido_itens()', '985617196668735f319e0e3ca27fc403', 'edf9eb7e9540238ea69dd079b8c537f2', 'ocs_tecido_itens'),
      ('public.fn_seg_pagina_ocs_aviamento()', '6d17c1dc03677fa49e2c84a8098bed22', '11e5cc2eca4e53770eaa4868fa5f8cb7', 'ocs_aviamento'),
      ('public.fn_seg_pagina_ocs_etiqueta()', '2419afb8e1b27625f0714657b5b77fc8', '32deaa83367e28390f3f2ecd77fd6cbb', 'ocs_etiqueta')
    ) AS x(f, d, n, t) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 's3a_guarda: pos-condicao falhou em %', r.f USING ERRCODE = 'P0001';
    END IF;
    -- tgtype 31 = ROW(1) + BEFORE(2) + INSERT(4) + DELETE(8) + UPDATE(16); sem lista de colunas, sem WHEN; ligado ('O')
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                    AND t.tgfoid = to_regprocedure(r.f) AND t.tgtype = 31 AND t.tgenabled = 'O'
                    AND t.tgqual IS NULL AND t.tgattr::text = '') THEN
      RAISE EXCEPTION 's3a_guarda: pos-condicao falhou no gatilho de %', r.t USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3a_guarda: pos-condicao falhou em % (EXECUTE ou SECURITY DEFINER)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

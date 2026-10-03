-- Inverso de supabase/migrations/20261031210000_seg_s2_financeiro_aba.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S2, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_servico_parcela_valor_pago()
--     ANTES  de9914b310477de1331f076a874696f1
--     DEPOIS b81d725dc25994eae29e7dfa8337f621
--   public.fn_parcela_permissao() (NOVA)
--     ANTES  ausente
--     DEPOIS f52b8d610577554a756fc2125844e5b2
--     NEUTRA d532e403362f93bcee9240f4c15bc840 (o _down)
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / GRANT-REVOKE): nenhuma tabela de negócio, nada de auth/storage.
-- Sem DROP, sem CREATE TRIGGER/POLICY.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
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
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_servico_parcela_valor_pago()', 'de9914b310477de1331f076a874696f1', 'b81d725dc25994eae29e7dfa8337f621')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 's2_finaba_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_parcela_permissao()')));
  IF v IS NULL OR v NOT IN ('f52b8d610577554a756fc2125844e5b2', 'd532e403362f93bcee9240f4c15bc840') THEN
    RAISE EXCEPTION 's2_finaba_down: fn_parcela_permissao com texto inesperado (md5 %) - outra frente mexeu', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_servico_parcela_valor_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A2] quem manda em parcelas_servico.valor_pago e ESTE gatilho (o cliente tem UPDATE na tabela inteira):
--   vira PAGA (status 'pago' ou data_pagamento preenchida, vindo de nao paga - ou INSERT ja paga) -> congela o valor
--     que a parcela tinha ANTES desta mudanca (_servico_parcelas_valores), sob trava do bloco;
--   deixa de ser paga -> NULL;
--   qualquer outro caso -> mantem o valor antigo (ignora o que o cliente mandar).
-- GUC de transacao app.servico_valor_pago_correcao = 'on': so a correcao unica 20261019210100 grava o valor da tela.
-- M1 (fix round 1): pagar parcela que a conta nao reconhece (nº > n_eff - o prazo encurtou e a tela esta velha, a linha
-- ainda nao foi apagada por servicos_financeiro) -> P0001 (recarregar), em vez de gravar 0,00 pago em silencio.
-- L1: a parcela tem de ser da MESMA loja do bloco.
DECLARE
  v_pago_novo boolean := (NEW.status = 'pago' OR NEW.data_pagamento IS NOT NULL);
  v_pago_antigo boolean;
  v_valor numeric;
  v_tenant_bloco uuid;
BEGIN
  IF COALESCE(current_setting('app.servico_valor_pago_correcao', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_pago_antigo := (OLD.status = 'pago' OR OLD.data_pagamento IS NOT NULL);
  ELSE
    v_pago_antigo := false;
  END IF;

  IF v_pago_novo AND NOT v_pago_antigo THEN
    SELECT c.tenant_id INTO v_tenant_bloco
      FROM public.producao_terceirizados pt JOIN public.cad c ON c.id = pt.cad_id
     WHERE pt.id = NEW.producao_terceirizado_id;
    IF v_tenant_bloco IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'parcela_servico_outra_loja: a parcela nao e da loja do servico' USING ERRCODE = 'P0001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('parcelas_servico:' || NEW.producao_terceirizado_id::text));
    SELECT v.valor INTO v_valor
      FROM public._servico_parcelas_valores(NEW.producao_terceirizado_id) v
     WHERE v.numero_parcela = NEW.numero_parcela;
    IF v_valor IS NULL THEN
      RAISE EXCEPTION 'parcela_fora_do_prazo: esta parcela saiu do prazo atual do servico - recarregue a tela antes de pagar'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.valor_pago := round(v_valor, 2);
  ELSIF NOT v_pago_novo THEN
    NEW.valor_pago := NULL;
  ELSE
    NEW.valor_pago := OLD.valor_pago;
  END IF;
  RETURN NEW;
END
$function$;

-- o gatilho FICA (inerte): a função vira neutra (sem DROP — o DROP prende auth/storage, vai no _down_drop separado)
CREATE OR REPLACE FUNCTION public.fn_parcela_permissao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [seg s2 FIN-ABA] NEUTRALIZADA pelo inverso (_down): o gatilho trg_parcela_permissao segue no banco, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN NEW;
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_servico_parcela_valor_pago()', 'de9914b310477de1331f076a874696f1')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's2_finaba_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_parcela_permissao()'))) IS DISTINCT FROM 'd532e403362f93bcee9240f4c15bc840' THEN
    RAISE EXCEPTION 's2_finaba_down: pos-condicao falhou em fn_parcela_permissao (esperado o texto neutro)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

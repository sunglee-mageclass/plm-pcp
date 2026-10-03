-- Reforço de segurança — Release S2 ("Dinheiro e estoque"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S2, RESPOSTAS DO DONO).
-- FIN-ABA (P-232 = D3 A): Financeiro por aba NO SERVIDOR. parcelas (OCs): gatilho NOVO trg_parcela_permissao (BEFORE UPDATE,
-- fn_parcela_permissao) exige user_can_edit('financeiro_parcelas') OU ('financeiro_calendario'), salvo a GUC
-- app.parcelas_sistema='on' / sem JWT / service_role. parcelas_servico: fn_servico_parcela_valor_pago (gatilho ja existente,
-- BEFORE INSERT OR UPDATE) exige no UPDATE user_can_edit('financeiro_servicos'), salvo app.parcelas_servico_sistema='on' / a
-- correcao unica / sem JWT / service_role. 42501 com prefixo ASCII (tela: erro-mensagem.ts). Nada muda para quem ja tem a aba.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_servico_parcela_valor_pago()
--     ANTES  de9914b310477de1331f076a874696f1
--     DEPOIS b81d725dc25994eae29e7dfa8337f621
--   public.fn_parcela_permissao() (NOVA)
--     ANTES  ausente
--     DEPOIS f52b8d610577554a756fc2125844e5b2
--     NEUTRA d532e403362f93bcee9240f4c15bc840 (o _down)
-- ====================================================================================
-- Trava: CREATE TRIGGER em parcelas = ShareRowExclusive SÓ em parcelas, por um instante (não trava auth/storage —
-- medido na C4); o resto é catálogo. Horário calmo (Financeiro). Sem DROP (o DROP do gatilho fica no _down_drop separado).
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261031210000_seg_s2_financeiro_aba_down.sql (LIFO: os inversos da S2 rodam do mais novo ao mais antigo, ANTES dos inversos da S1 e de
-- releases anteriores que guardam por md5 as mesmas funções — ver s2-report.md, seção "Cadeia md5").
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
      RAISE EXCEPTION 's2_finaba: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_parcela_permissao()')));
  IF v IS NOT NULL AND v NOT IN ('f52b8d610577554a756fc2125844e5b2', 'd532e403362f93bcee9240f4c15bc840') THEN
    RAISE EXCEPTION 's2_finaba: fn_parcela_permissao ja existe com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.parcelas'::regclass AND t.tgname = 'trg_parcela_permissao'
              AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure('public.fn_parcela_permissao()')) THEN
    RAISE EXCEPTION 's2_finaba: trg_parcela_permissao existe apontando para outra funcao' USING ERRCODE = 'P0001';
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
  -- [seg s2 FIN-ABA] (P-232 = D3 A) Financeiro por aba NO SERVIDOR: mudar parcela de servico (pagar, desfazer, vencimento,
  -- comprovante) exige EDITAR a aba Servicos (financeiro_servicos) - a mesma regra da tela. O INSERT do cliente nao existe
  -- mais (grant so de UPDATE em 4 colunas); o do servidor (servicos_financeiro, na LEITURA de qualquer aba) nao e conferido.
  -- Caminho do SISTEMA: GUC app.parcelas_servico_sistema = 'on' (funcoes do servidor ligam em volta do proprio comando),
  -- a correcao unica (app.servico_valor_pago_correcao) e sem JWT / service_role. ASCII (tela: erro-mensagem.ts).
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.parcelas_servico_sistema', true), '') <> 'on'
     AND COALESCE(current_setting('app.servico_valor_pago_correcao', true), '') <> 'on'
     AND NOT (auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon'))
     AND NOT public.user_can_edit('financeiro_servicos') THEN
    RAISE EXCEPTION 'financeiro_servicos_sem_permissao: sem permissao para editar parcelas de Servicos (Financeiro, aba Servicos)'
      USING ERRCODE = '42501';
  END IF;
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

CREATE OR REPLACE FUNCTION public.fn_parcela_permissao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [seg s2 FIN-ABA] (Reforco de seguranca S2, P-232 = D3 A) Financeiro por aba NO SERVIDOR: pagar, desfazer o pagamento, mudar
-- o vencimento ou anexar o comprovante de parcela de OC (o cliente so tem UPDATE nas 4 colunas data_vencimento/status/
-- data_pagamento/comprovante_url) exige EDITAR a aba OCs (financeiro_parcelas) OU o Calendario (financeiro_calendario) - a
-- mesma regra da tela (usePodeEditarFinanceiro). Admin da loja/super passam (user_can_edit).
-- Caminho do SISTEMA: GUC de transacao app.parcelas_sistema = 'on' (funcao do servidor que grava parcela ja liga - teste
-- anti-drift) ou sem JWT (migration/psql) / service_role. ASCII (tela: erro-mensagem.ts).
BEGIN
  IF COALESCE(current_setting('app.parcelas_sistema', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NOT (public.user_can_edit('financeiro_parcelas') OR public.user_can_edit('financeiro_calendario')) THEN
    RAISE EXCEPTION 'financeiro_sem_permissao: sem permissao para editar parcelas de OC (Financeiro, abas OCs ou Calendario)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

-- função de gatilho: ninguém a chama direto (ANON-2 da S1: EXECUTE só é conferido no CREATE TRIGGER)
REVOKE EXECUTE ON FUNCTION public.fn_parcela_permissao() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.parcelas'::regclass AND t.tgname = 'trg_parcela_permissao'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_parcela_permissao BEFORE UPDATE ON public.parcelas
      FOR EACH ROW EXECUTE FUNCTION public.fn_parcela_permissao();
  END IF;
END
$trg$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_servico_parcela_valor_pago()', 'b81d725dc25994eae29e7dfa8337f621')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's2_finaba: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_parcela_permissao()'))) IS DISTINCT FROM 'f52b8d610577554a756fc2125844e5b2' THEN
    RAISE EXCEPTION 's2_finaba: pos-condicao falhou em fn_parcela_permissao' USING ERRCODE = 'P0001';
  END IF;
  -- tgtype 19 = ROW(1) + BEFORE(2) + UPDATE(16); sem lista de colunas, sem WHEN; ligado ('O')
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.parcelas'::regclass AND t.tgname = 'trg_parcela_permissao'
                  AND t.tgfoid = to_regprocedure('public.fn_parcela_permissao()') AND t.tgtype = 19 AND t.tgenabled = 'O'
                  AND t.tgqual IS NULL AND t.tgattr::text = '') THEN
    RAISE EXCEPTION 's2_finaba: pos-condicao falhou no gatilho trg_parcela_permissao' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.fn_parcela_permissao()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_parcela_permissao()', 'EXECUTE') THEN
    RAISE EXCEPTION 's2_finaba: pos-condicao falhou no EXECUTE de fn_parcela_permissao' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;

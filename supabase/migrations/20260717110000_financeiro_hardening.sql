-- Financeiro — hardening do time (jul/2026). A tela está sólida (invariantes #1/#8
-- verificados, sem cross-tenant, matemática fecha, pago nunca some); estes são
-- fixes de segurança/integridade + paridade de recálculo (decisão do dono).
--
-- 1) #9: servicos_financeiro() é SECURITY DEFINER que ESCREVE (sincroniza
--    parcelas_servico) a cada leitura, mas tinha EXECUTE p/ PUBLIC/anon → revoga.
-- 2) parcelas: o cliente (authenticated) tinha UPDATE em TODAS as colunas — dava
--    p/ PATCH direto em `valor`/`numero_parcela` (o valor deve ser só-derivado das
--    geradoras). Deixa só as 4 colunas que o front edita. As geradoras/recalc são
--    SECURITY DEFINER (owner=postgres) → seguem podendo escrever tudo.
-- 3) parcelas_servico: faltava o modgate RESTRICTIVE do módulo `financeiro` que a
--    irmã `parcelas` tem (defense-in-depth; DEFINER owner=postgres bypassa RLS,
--    então servicos_financeiro segue sincronizando normal — force RLS = false).
-- 4) Paridade (decisão do dono): OC de aviamento passa a recalcular as parcelas
--    sozinha ao mudar item (se já 'recebido'), igual ao tecido (invariante #1).
--
-- Testado em txn revertida: grants (anon/auth), colunas de UPDATE, policies, e o
-- trigger de aviamento recalculando Σparcelas ao mudar item.

BEGIN;

-- 1) #9 — fecha a superfície DEFINER-mutável exposta a anon/PUBLIC
REVOKE EXECUTE ON FUNCTION public.servicos_financeiro() FROM PUBLIC, anon;

-- 2) parcelas — cliente só edita as 4 colunas operacionais; valor/numero_parcela
--    ficam sob as geradoras/recalc (DEFINER)
REVOKE UPDATE ON public.parcelas FROM authenticated;
GRANT UPDATE (data_vencimento, status, data_pagamento, comprovante_url)
  ON public.parcelas TO authenticated;

-- 3) modgate do módulo `financeiro` em parcelas_servico (espelha `parcelas`)
DROP POLICY IF EXISTS modgate_ins ON public.parcelas_servico;
DROP POLICY IF EXISTS modgate_upd ON public.parcelas_servico;
DROP POLICY IF EXISTS modgate_del ON public.parcelas_servico;
CREATE POLICY modgate_ins ON public.parcelas_servico AS RESTRICTIVE FOR INSERT
  WITH CHECK (tenant_module_enabled('financeiro'));
CREATE POLICY modgate_upd ON public.parcelas_servico AS RESTRICTIVE FOR UPDATE
  USING (tenant_module_enabled('financeiro'));
CREATE POLICY modgate_del ON public.parcelas_servico AS RESTRICTIVE FOR DELETE
  USING (tenant_module_enabled('financeiro'));

-- 4) recálculo automático das parcelas de OC de aviamento ao mudar item (paridade
--    com o tecido, que já recalcula ao mudar valor_real_total). Só age em OC já
--    'recebido' (itens salvos ANTES do status='recebido' → a geradora cuida da 1ª vez).
CREATE OR REPLACE FUNCTION public.recalc_parcelas_aviamento_on_item()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_oc uuid; v_status text;
BEGIN
  v_oc := COALESCE(NEW.oc_aviamento_id, OLD.oc_aviamento_id);
  SELECT status INTO v_status FROM public.ocs_aviamento WHERE id = v_oc;
  IF v_status = 'recebido' THEN
    PERFORM public._recalcular_parcelas_core(v_oc, 'aviamento');
  END IF;
  RETURN NULL; -- AFTER trigger: retorno ignorado
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_parcelas_aviamento ON public.ocs_aviamento_itens;
CREATE TRIGGER trg_recalc_parcelas_aviamento
  AFTER INSERT OR UPDATE OR DELETE ON public.ocs_aviamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.recalc_parcelas_aviamento_on_item();

COMMIT;

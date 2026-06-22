-- Item 8a (Fase 1): enforce de módulo no SERVIDOR — parte 1 (RLS nas tabelas).
-- Hoje o toggle tenant_config.modules é só client-side (ModuleGuard/sidebar); um
-- usuário poderia escrever via API direta em módulo não-contratado. Aqui: policies
-- RESTRICTIVE de INSERT/UPDATE/DELETE em cada tabela-núcleo dos módulos
-- DESLIGÁVEIS (criacao, entrada_saida, producao, financeiro). 'cadastro' é
-- forçado-on (não gateamos); 'dashboard' é read-only (já gateado por user_can_view).
--
-- Propriedade de segurança: com o módulo LIGADO (estado atual de todas as lojas),
-- tenant_module_enabled() = true → policy passa → ZERO mudança de comportamento. O
-- bloqueio só "acende" quando o módulo é desligado. Reads não são afetados (só
-- INSERT/UPDATE/DELETE). RPCs SECURITY DEFINER furam RLS → guard delas vem no 8b.

-- Helper: módulo habilitado p/ a loja do usuário atual? (super_admin sempre true;
-- chave ausente/sem config → true, não bloquear por ausência).
CREATE OR REPLACE FUNCTION public.tenant_module_enabled(_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    true
  );
$function$;

-- Policies restritivas por (módulo, tabela).
DO $modgate$
DECLARE
  v_map jsonb := '{
    "criacao": ["modelos","modelo_tecidos","modelo_tecido_variantes","modelo_grades","modelo_aviamentos","modelo_observacoes","modelo_tecido_oc_links"],
    "entrada_saida": ["ocs_tecido","ocs_tecido_itens","ocs_aviamento","ocs_aviamento_itens","estoque_tecido_baixas","ordens_saida_tecido","ordens_saida_tecido_itens","ordens_saida_aviamento","ordens_saida_aviamento_itens"],
    "producao": ["cad","cad_tecidos","cad_tecido_variantes","cad_grades","cad_aviamentos","cad_etiquetas","producao_terceirizados","producao_oficina","controle_qualidade","cq_variantes","producao_acabamento","direcionamento","lancamentos"],
    "financeiro": ["parcelas"]
  }'::jsonb;
  v_mod text;
  v_tbl text;
BEGIN
  FOR v_mod IN SELECT jsonb_object_keys(v_map) LOOP
    FOR v_tbl IN SELECT jsonb_array_elements_text(v_map -> v_mod) LOOP
      EXECUTE format('DROP POLICY IF EXISTS modgate_ins ON public.%I', v_tbl);
      EXECUTE format('CREATE POLICY modgate_ins ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.tenant_module_enabled(%L))', v_tbl, v_mod);
      EXECUTE format('DROP POLICY IF EXISTS modgate_upd ON public.%I', v_tbl);
      EXECUTE format('CREATE POLICY modgate_upd ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.tenant_module_enabled(%L))', v_tbl, v_mod);
      EXECUTE format('DROP POLICY IF EXISTS modgate_del ON public.%I', v_tbl);
      EXECUTE format('CREATE POLICY modgate_del ON public.%I AS RESTRICTIVE FOR DELETE USING (public.tenant_module_enabled(%L))', v_tbl, v_mod);
    END LOOP;
  END LOOP;
END
$modgate$;

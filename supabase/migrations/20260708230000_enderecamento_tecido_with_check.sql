-- #3a: endurece a tabela enderecamento_tecido — o INSERT/UPDATE agora exige que a variante e a
-- origem (item de OC / rolo) referenciadas pertençam ao MESMO tenant do chamador. Antes as FKs
-- eram só globais: um payload forjado podia "fixar" no próprio tenant um id de outra loja
-- (não vazava — a RLS de leitura esconde — mas era sujeira de integridade; diagnóstico BAIXO).

DROP POLICY IF EXISTS endtec_ins ON public.enderecamento_tecido;
CREATE POLICY endtec_ins ON public.enderecamento_tecido FOR INSERT WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND EXISTS (SELECT 1 FROM public.variantes_tecido vt JOIN public.artigos a ON a.id = vt.artigo_id
              WHERE vt.id = variante_tecido_id AND a.tenant_id = get_user_tenant_id())
  AND (oc_tecido_item_id IS NULL OR EXISTS (
        SELECT 1 FROM public.ocs_tecido_itens i JOIN public.ocs_tecido o ON o.id = i.oc_tecido_id
        WHERE i.id = oc_tecido_item_id AND o.tenant_id = get_user_tenant_id()))
  AND (rolo_id IS NULL OR EXISTS (
        SELECT 1 FROM public.ocs_tecido o WHERE o.id = rolo_id AND o.tenant_id = get_user_tenant_id()))
);

DROP POLICY IF EXISTS endtec_upd ON public.enderecamento_tecido;
CREATE POLICY endtec_upd ON public.enderecamento_tecido FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND EXISTS (SELECT 1 FROM public.variantes_tecido vt JOIN public.artigos a ON a.id = vt.artigo_id
                WHERE vt.id = variante_tecido_id AND a.tenant_id = get_user_tenant_id())
    AND (oc_tecido_item_id IS NULL OR EXISTS (
          SELECT 1 FROM public.ocs_tecido_itens i JOIN public.ocs_tecido o ON o.id = i.oc_tecido_id
          WHERE i.id = oc_tecido_item_id AND o.tenant_id = get_user_tenant_id()))
    AND (rolo_id IS NULL OR EXISTS (
          SELECT 1 FROM public.ocs_tecido o WHERE o.id = rolo_id AND o.tenant_id = get_user_tenant_id()))
  );

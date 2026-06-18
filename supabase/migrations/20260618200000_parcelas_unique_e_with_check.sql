-- ============================================================================
-- Rec. #5 (parte banco): integridade de parcelas + fechar WITH CHECK de policies.
-- ============================================================================

-- 1) UNIQUE de negócio em parcelas: no máx. 1 parcela por (OC, número da parcela).
--    Backstop contra duplicação (TOCTOU entre o trigger gerar_parcelas_oc_* e
--    recalcular_parcelas). Índice parcial pois cada parcela liga a UMA OC só.
--    (Verificado: zero duplicatas hoje.)
CREATE UNIQUE INDEX IF NOT EXISTS parcelas_oc_tecido_numero_key
  ON public.parcelas (oc_tecido_id, numero_parcela)
  WHERE oc_tecido_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS parcelas_oc_aviamento_numero_key
  ON public.parcelas (oc_aviamento_id, numero_parcela)
  WHERE oc_aviamento_id IS NOT NULL;

-- 2) Fecha o WITH CHECK das 3 policies de UPDATE de tabelas de associação.
--    Sem WITH CHECK, o USING só barra a leitura da linha — um UPDATE poderia
--    MOVER a linha para outro tenant (o trigger só preenche tenant_id no INSERT).
--    WITH CHECK = USING impede gravar a linha fora do próprio tenant.
ALTER POLICY "tenant update" ON public.artigo_categorias_tecido
  WITH CHECK (tenant_id = public.get_user_tenant_id());

ALTER POLICY "tenant update" ON public.terceirizado_categorias
  WITH CHECK (tenant_id = public.get_user_tenant_id());

ALTER POLICY "tenant_update_emp_cat_forn" ON public.empresa_categorias_fornecedor
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.empresas e
    WHERE e.id = empresa_categorias_fornecedor.empresa_id
      AND e.tenant_id = public.get_user_tenant_id()
  ));

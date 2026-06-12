-- FKs usadas em joins e RLS
CREATE INDEX IF NOT EXISTS idx_users_tenant ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oc_tecido_itens_oc ON public.ocs_tecido_itens(oc_tecido_id);
CREATE INDEX IF NOT EXISTS idx_oc_tecido_itens_variante ON public.ocs_tecido_itens(variante_tecido_id);
CREATE INDEX IF NOT EXISTS idx_oc_aviamento_itens_oc ON public.ocs_aviamento_itens(oc_aviamento_id);
CREATE INDEX IF NOT EXISTS idx_oc_aviamento_itens_aviamento ON public.ocs_aviamento_itens(aviamento_id);
CREATE INDEX IF NOT EXISTS idx_variantes_artigo ON public.variantes_tecido(artigo_id);
CREATE INDEX IF NOT EXISTS idx_modelos_tenant_status ON public.modelos(tenant_id, status_planejamento, enviado_cad);
CREATE INDEX IF NOT EXISTS idx_cad_modelo ON public.cad(modelo_id);
CREATE INDEX IF NOT EXISTS idx_cad_tecido_variantes_variante ON public.cad_tecido_variantes(variante_tecido_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_tenant_status ON public.parcelas(tenant_id, status, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_modelo_tecidos_modelo ON public.modelo_tecidos(modelo_id);
CREATE INDEX IF NOT EXISTS idx_prod_terc_cad ON public.producao_terceirizados(cad_id);

-- Índices para tabelas filhas de produção
CREATE INDEX IF NOT EXISTS idx_cq_variantes_cq ON public.cq_variantes(controle_qualidade_id);
CREATE INDEX IF NOT EXISTS idx_prod_acab_cad ON public.producao_acabamento(cad_id);
CREATE INDEX IF NOT EXISTS idx_prod_acab_terc ON public.producao_acabamento(terceirizado_id);
CREATE INDEX IF NOT EXISTS idx_direcionamento_cad ON public.direcionamento(cad_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_cad ON public.lancamentos(cad_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_modelo ON public.lancamentos(modelo_id);
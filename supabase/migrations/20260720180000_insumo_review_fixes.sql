-- Correções da revisão do time (Insumos), baseline 3cd95fb..HEAD.
-- Fecha 2 achados HIGH (segurança + FK destrutiva) e adiciona índices de FK.
-- O achado do estoque de insumo (baixa×cor) é tratado à parte (decisão de modelo).

BEGIN;

-- [HIGH · invariante #9] recalcular_parcelas_etiqueta é SECURITY DEFINER que ESCREVE
-- parcelas, recebe _oc_id por parâmetro e NÃO valida o chamador → IDOR cross-tenant de
-- escrita (provado: authenticated de outra loja regenera/apaga parcelas da vítima).
-- É chamada só por triggers/salvar_oc_etiqueta (DEFINER=postgres, passam a checagem de
-- EXECUTE como owner), nunca pelo front (grep=0). Revoga dos TRÊS (o default concede a
-- PUBLIC, e anon/authenticated herdam).
REVOKE EXECUTE ON FUNCTION public.recalcular_parcelas_etiqueta(uuid) FROM PUBLIC, anon, authenticated;
-- Defesa em profundidade nas trigger-funcs (PostgREST não as invoca como RPC, mas alinha ao padrão).
REVOKE EXECUTE ON FUNCTION public.gerar_parcelas_oc_etiqueta() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalc_parcelas_etiqueta_on_item() FROM PUBLIC, anon;

-- [HIGH] parcelas.oc_etiqueta_id era ON DELETE CASCADE (tecido/aviamento = NO ACTION):
-- excluir a OC apagava parcelas em silêncio, inclusive PAGAS (caminho pagar → desmarcar
-- recebido, que preserva a paga → excluir OC encomendada com .delete() cru). Mesma classe
-- dos invariantes #4/#5. Passa a NO ACTION: o banco bloqueia excluir OC com parcela viva.
ALTER TABLE public.parcelas DROP CONSTRAINT IF EXISTS parcelas_oc_etiqueta_id_fkey;
ALTER TABLE public.parcelas ADD CONSTRAINT parcelas_oc_etiqueta_id_fkey
  FOREIGN KEY (oc_etiqueta_id) REFERENCES public.ocs_etiqueta(id) ON DELETE NO ACTION;

-- [LOW] Índices em FKs de insumo JOINadas/filtradas (estoque_etiqueta + financeiro escalam).
CREATE INDEX IF NOT EXISTS ix_ocs_etiqueta_itens_etiqueta ON public.ocs_etiqueta_itens (etiqueta_id);
CREATE INDEX IF NOT EXISTS ix_ocs_etiqueta_itens_variante ON public.ocs_etiqueta_itens (variante_etiqueta_id);
CREATE INDEX IF NOT EXISTS ix_ocs_etiqueta_tenant ON public.ocs_etiqueta (tenant_id);
CREATE INDEX IF NOT EXISTS ix_ocs_etiqueta_empresa ON public.ocs_etiqueta (empresa_id);
CREATE INDEX IF NOT EXISTS ix_ocs_etiqueta_representante ON public.ocs_etiqueta (representante_id);
CREATE INDEX IF NOT EXISTS ix_cad_etiquetas_etiqueta ON public.cad_etiquetas (etiqueta_id);
CREATE INDEX IF NOT EXISTS ix_cad_etiquetas_cor ON public.cad_etiquetas (cor_id);

COMMIT;

select pg_notify('pgrst','reload schema');

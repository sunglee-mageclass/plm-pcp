
REVOKE EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.saldo_oc_item_m(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.detalhe_estoque_variante(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ocs_disponiveis_variante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saldo_oc_item_m(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detalhe_estoque_variante(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ocs_disponiveis_variante(uuid) TO authenticated;

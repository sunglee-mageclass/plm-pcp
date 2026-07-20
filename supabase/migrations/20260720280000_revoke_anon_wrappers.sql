-- Hardening (#9): os wrappers reverter_corte_tecido e voltar_cq_para_servico estavam
-- executáveis por anon (herdado de PUBLIC). Na prática o gate de módulo + auth.uid() já
-- barram, mas o padrão é wrapper só p/ authenticated. Alinha ao padrão.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.reverter_corte_tecido(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reverter_corte_tecido(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.voltar_cq_para_servico(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.voltar_cq_para_servico(uuid) TO authenticated;

COMMIT;

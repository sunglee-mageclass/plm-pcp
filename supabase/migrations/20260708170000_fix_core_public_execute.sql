-- FIX DE SEGURANÇA (CRÍTICO): _core com EXECUTE herdado de PUBLIC.
--
-- Invariante #9: os `_core` de RPCs gateadas têm EXECUTE revogado de anon/authenticated para
-- só serem chamáveis via wrapper (que checa gate de módulo/permissão). A migração M2
-- (20260708130000) revogou de anon/authenticated mas ESQUECEU o grant default TO PUBLIC —
-- como anon/authenticated herdam de PUBLIC, o revoke ficou inócuo.
--
-- `_estoque_aviamento_core(uuid)` (CRÍTICO): recebe o tenant por PARÂMETRO, é SECURITY DEFINER
-- e NÃO valida o chamador → anon (sem login) e authenticated de outra loja liam o estoque de
-- aviamento de QUALQUER loja, furando gate de módulo E isolamento multi-tenant. Provado ao vivo.
--
-- `_gerar_rolos_recebimento_core(uuid,jsonb)` (menor): tem guards internos (auth.uid + posse
-- do tenant), então o furo era só do gate de módulo; revogo por higiene/consistência.

REVOKE EXECUTE ON FUNCTION public._estoque_aviamento_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._gerar_rolos_recebimento_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;

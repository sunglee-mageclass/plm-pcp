-- Invariante #9: os helpers da REF automática só são usados pela trigger DEFINER
-- (fn_modelo_ref_auto, owner=postgres). Revoga EXECUTE de PUBLIC/anon/authenticated
-- (o default ACL concede a PUBLIC; anon/authenticated herdam) p/ não ficarem chamáveis
-- direto pelo cliente. `_modelo_ref_next_num(uuid)` recebe o tenant por parâmetro.

BEGIN;
REVOKE EXECUTE ON FUNCTION public._ref_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._modelo_ref_sigla(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._modelo_ref_next_num(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;

select pg_notify('pgrst','reload schema');

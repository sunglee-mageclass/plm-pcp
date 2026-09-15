-- FIX de RLS: remover o modgate RESTRICTIVE do SELECT de ocs_p_acabado e ocs_importado.
--
-- Motivo (lição da Onda 1 do merge colaborativo): o Realtime lê as mudanças COMO o role
-- `authenticated` (apply_rls) e NÃO tem o contexto de tenant p/ avaliar `tenant_module_enabled(...)`.
-- Um modgate RESTRICTIVE no SELECT faz o Realtime falhar a leitura → o canal postgres_changes nunca
-- fica SUBSCRIBED → presença/ring/merge não sobem. TODAS as outras tabelas que já funcionam no
-- Realtime (controle_qualidade, ocs_tecido, ocs_aviamento, ocs_etiqueta, direcionamento_controle) têm
-- SÓ `tenant_select` PERMISSIVE no SELECT — nenhuma tem modgate no SELECT. Estas duas eram a exceção.
--
-- Segurança: alinha com a decisão JÁ registrada da feature Produto Acabado/Importado (invariante #13:
-- "RLS só tenant-scoped; módulo OFF enforçado nos WRAPPERS de escrita (SECURITY DEFINER) + empty-state
-- na UI"). O modgate de INSERT/UPDATE/DELETE PERMANECE (a escrita segue gated). Só o SELECT deixa de
-- ter o gate — leitura direta via REST/embed com módulo OFF já não era bloqueada nas outras 2 tabelas
-- da mesma feature (produtos_acabados/importados), então isto só uniformiza.

BEGIN;

DROP POLICY IF EXISTS modgate_sel ON public.ocs_p_acabado;
DROP POLICY IF EXISTS modgate_oci_sel ON public.ocs_importado;

COMMIT;

-- Fast-follow (achado 5 da revisão G5, ampliado): ACL dos wrappers do Plan. Tecido.
--
-- Contexto: os CORES (`_plan_tecido_*_core`) já estão todos fechados (f|f) — a lógica
-- sensível está protegida (invariante #9). Mas 11 WRAPPERS `plan_tecido_*` ainda estavam
-- abertos a PUBLIC/anon, enquanto os wrappers mais novos (fazer_pedido, previa_pedido,
-- criar_cards, aplicar_ao_modelo, set_referencia, situacao_ocs, fases) já haviam sido
-- fechados a authenticated. Essa INCONSISTÊNCIA é o que o achado 5 apontou (o criar_card
-- single aberto vs. o criar_cards batch fechado).
--
-- Decisão do dono (31/08): fechar TODOS os wrappers a authenticated — defesa-em-profundidade
-- plena. Nenhum wrapper plan_tecido_* é chamado em rota pública (auth/index) — verificado.
-- A proteção efetiva já existia (gate `tenant_module_enabled` + `get_user_tenant_id()` dá
-- sentinela nil p/ quem não tem sessão), mas revogar de anon/PUBLIC alinha ao padrão do resto
-- do sistema e remove a superfície desnecessária.
--
-- Idempotente: REVOKE de quem já não tem o privilégio é no-op. Só authenticated fica com EXECUTE
-- (os wrappers já concedem a authenticated onde relevante; onde não, a policy/RLS ainda barra).

REVOKE EXECUTE ON FUNCTION public.plan_tecido_arvore(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_cobertura(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_cobertura_ocs(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_criar_card(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_desfazer_pedido(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_estoque(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_set_oc_aplicada(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_set_paleta(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_set_slot_oc(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_status_pedidos() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_vinculos_modelo(uuid) FROM PUBLIC, anon;

-- Reafirma os já-fechados (idempotente; garante que o conjunto inteiro fique consistente):
REVOKE EXECUTE ON FUNCTION public.plan_tecido_aplicar_ao_modelo(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_criar_cards(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_fases(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_fazer_pedido(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_previa_pedido(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_set_referencia(uuid, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_situacao_ocs(uuid) FROM PUBLIC, anon;

-- 20260807130000_colab_hardening_acl_replica_identity.sql
-- FAST-FOLLOW backend do review final da feature Colab PCP/CQ
-- (spec .superpowers/sdd/2026-08-07-colab-pcp-cq/). Dois hardenings, nenhum destrutivo.
--
-- ============================================================================
-- Item 1 (invariante #9) — ACL vazada nos 3 wrappers de salvar via rev
-- ============================================================================
-- salvar_oc_tecido / salvar_modelo_bom / salvar_plan_tecido estavam com EXECUTE
-- concedido a PUBLIC e anon = true (verificado ao vivo via has_function_privilege).
-- Causa: o DROP+CREATE da migração 20260803190000 (trava otimista _rev_base) recriou
-- as 3 funções do zero — toda função nova nasce com EXECUTE pra PUBLIC por padrão no
-- Postgres — e a migração só fez GRANT pra `authenticated` nos wrappers (e REVOKE nos
-- `_core`), sem o REVOKE explícito de PUBLIC/anon nos wrappers em si. Como anon e
-- authenticated HERDAM de PUBLIC, isso deixou os wrappers chamáveis por usuário
-- anônimo (mesma classe de bug do invariante #9: "revogar só de anon/authenticated é
-- inócuo, PUBLIC continua"). Aqui o wrapper PRECISA ficar chamável por authenticated
-- (ele faz auth.uid()/tenant check por dentro) — só REVOKE de PUBLIC e anon.
-- Idempotente (REVOKE de privilégio já ausente não erra).

REVOKE EXECUTE ON FUNCTION public.salvar_oc_tecido(uuid, jsonb, jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_modelo_bom(uuid, jsonb, jsonb, jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_plan_tecido(uuid, jsonb, integer) FROM PUBLIC, anon;

-- ============================================================================
-- Item 2 — REPLICA IDENTITY FULL p/ propagar DELETE em tempo real (colab PCP/CQ)
-- ============================================================================
-- producao_terceirizados e controle_qualidade estão na publicação supabase_realtime
-- com REPLICA IDENTITY default (só a PK entra no WAL de um DELETE). O
-- useColabRegistro (filtroColuna="cad_id") escuta o evento DELETE e filtra o payload
-- por cad_id=eq — sem cad_id no WAL (replica identity default só manda a PK, que é
-- `id`, não `cad_id`), o filtro nunca casa e a exclusão de um bloco/linha não propaga
-- pra outra aba com o colab aberto no mesmo cad. REPLICA IDENTITY FULL manda a linha
-- inteira (valores ANTES do apagar) no WAL do DELETE, então o filtro por cad_id passa
-- a casar. Idempotente (ALTER TABLE ... REPLICA IDENTITY é sempre seguro reaplicar).

ALTER TABLE public.producao_terceirizados REPLICA IDENTITY FULL;
ALTER TABLE public.controle_qualidade REPLICA IDENTITY FULL;

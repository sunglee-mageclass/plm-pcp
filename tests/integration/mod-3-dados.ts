// GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod3.mjs (nunca editar à mão; rode o gerador de novo).
// Modularidade T3 — md5 de ANTES e DEPOIS das 6 funções (avaliador do kanban, salvar_loja e 4 _core de Dashboard), ACL de
// antes, md5 dos 3 auxiliares novos, mapa M5 e dependências fixadas. Contrato de mod-helpers.ts: MOD_MD5 + MOD_SENTINELA.
export const MOD_MIG = "supabase/migrations/20261103120000_mod_kanban_colecao.sql";
export const MOD_DOWN = "supabase/rollback/20261103120000_mod_kanban_colecao_down.sql";
export const MOD_DOWN_DROP = "supabase/rollback/20261103120000_mod_kanban_colecao_down_drop.sql";
export const MOD_SENTINELA = "public._avaliar_condicoes_kanban_core(uuid,uuid[])";
export const MOD_MD5: Record<string, { antes: string; depois: string }> = {
  "public._avaliar_condicoes_kanban_core(uuid,uuid[])": { antes: "e6f3fceae7e6eb6f4589d4858e01d1d6", depois: "394578c15aecc303224356a554380de1" },
  "public.salvar_loja(uuid,text,text,text,text,jsonb)": { antes: "519ad32fd206f7fef53f42d297945fcd", depois: "1c4dd54bc32c7605b6c389dcf3f5951d" },
  "public._dashboard_colecao_core(date,date,text,uuid,uuid)": { antes: "9435f724d61227a7014d95a95cf7fac5", depois: "e216bde59e8da32b0415b1318cf9d461" },
  "public._dashboard_custos_core(date,date,text,uuid,uuid)": { antes: "177263673f730f333b2870acd59e8859", depois: "4ba33f5fb51695c62cda66b971728071" },
  "public._dashboard_producao_core(date,date,text,uuid)": { antes: "2662bae65ab7fb9c1c7cb012273481be", depois: "2faa32104542259e36e50ff46a007eb7" },
  "public._dashboard_producao_servicos_core(date,date,text,uuid,text)": { antes: "197f3136e7ef2f3be6ade7169e863692", depois: "b456136272b4a74d9a198ac3a19d038c" },
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva); as 6 são SECURITY DEFINER. */
export const MOD3_ACL: Record<string, string> = {
  "public._avaliar_condicoes_kanban_core(uuid,uuid[])": "{postgres=X/postgres,service_role=X/postgres}",
  "public.salvar_loja(uuid,text,text,text,text,jsonb)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public._dashboard_colecao_core(date,date,text,uuid,uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._dashboard_custos_core(date,date,text,uuid,uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._dashboard_producao_core(date,date,text,uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._dashboard_producao_servicos_core(date,date,text,uuid,text)": "{postgres=X/postgres,service_role=X/postgres}",
};
/** Os 3 auxiliares NOVOS (md5 da IDA); EXECUTE revogado de PUBLIC/anon/authenticated. */
export const MOD3_AUX: Record<string, string> = {
  "public._kanban_cond_modulos()": "e8196983de17cc5b8cf52c1810e53af2",
  "public._kanban_cond_na(uuid)": "625aa805421941e40a0e82f5b3f2925b",
  "public._modelo_colecao_rotulo(uuid,uuid,text)": "e9220bc3a67b82ddcd768b8ad5a81a46",
};
/** Mapa M5 (condição → módulos da loja), o mesmo literal de _kanban_cond_modulos(). */
export const MOD3_M5: Record<string, string[]> = {"enviado_cad":["criacao","entrada_saida"],"cad_preenchido":["criacao","entrada_saida"],"enviado_para_pcp":["criacao","entrada_saida"],"separar_enviar_preenchido":["criacao","entrada_saida"],"servico_finalizado":["producao"],"grade_cortada_lancada":["producao"],"direcionamento_feito":["producao"],"cq_confirmado":["producao"],"cq_pos_confirmado":["producao"],"cq_liberado":["producao"]};
/** Dependências fixadas na guarda (md5). */
export const MOD3_DEPS: Record<string, string> = {
  "public._tenant_modulo_ligado(uuid,text)": "0c9655642d6b570f9adaf136bcaa09c7",
  "public._kanban_enfileirar_tenant(uuid)": "d27c6401de3659f1b352eb18e867c7ef",
  "public._cq_liberado(uuid)": "55a5f7ad704a061087e0fc154d4605e7",
  "public._kanban_norm(text)": "74606b6e06de34fa23fd0642d1ebafbb",
};

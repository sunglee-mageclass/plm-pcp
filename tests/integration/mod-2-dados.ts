// GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod2.mjs (nunca editar à mão; rode o gerador de novo).
// Modularidade T2 — md5 de ANTES e DEPOIS de lancar_modelo (P-252 A) e otb_excluir_colecao (P-255 A), ACL de antes e
// dependências fixadas. Contrato de mod-helpers.ts: MOD_MD5 + MOD_SENTINELA (ver lá).
export const MOD_MIG = "supabase/migrations/20261103110000_mod_lancar_colecao.sql";
export const MOD_DOWN = "supabase/rollback/20261103110000_mod_lancar_colecao_down.sql";
export const MOD_SENTINELA = "public.lancar_modelo(uuid,date,boolean)";
export const MOD_MD5: Record<string, { antes: string; depois: string }> = {
  "public.lancar_modelo(uuid,date,boolean)": { antes: "efe52aaad9a1e6055d758cf93e1950d5", depois: "3a79fd6fa5ca7959640618057b385620" },
  "public.otb_excluir_colecao(uuid)": { antes: "5557291079763a24fdf202c46671d3c0", depois: "4ba36eb4972d10832ed8eb1e8b89adea" },
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva); as 2 são SECURITY DEFINER. */
export const MOD2_ACL: Record<string, string> = {
  "public.lancar_modelo(uuid,date,boolean)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.otb_excluir_colecao(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
};
/** Dependências fixadas na guarda (md5). */
export const MOD2_DEPS: Record<string, string> = {
  "public._tenant_modulo_ligado(uuid,text)": "0c9655642d6b570f9adaf136bcaa09c7",
  "public._cq_liberado(uuid)": "55a5f7ad704a061087e0fc154d4605e7",
};

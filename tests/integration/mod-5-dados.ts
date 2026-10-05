// GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod5.mjs (nunca editar à mão; rode o gerador de novo).
// Modularidade T5 — md5 de ANTES e DEPOIS de fn_colab_bump_modelo e fn_colab_bump_modelo_via_tecido (rev 1x por transação),
// ACL de antes, dependências fixadas e gatilhos que as chamam. Contrato de mod-helpers.ts: MOD_MD5 + MOD_SENTINELA (ver lá).
export const MOD_MIG = "supabase/migrations/20261103200000_mod_rev_uma_vez.sql";
export const MOD_DOWN = "supabase/rollback/20261103200000_mod_rev_uma_vez_down.sql";
export const MOD_SENTINELA = "public.fn_colab_bump_modelo()";
export const MOD_MD5: Record<string, { antes: string; depois: string }> = {
  "public.fn_colab_bump_modelo()": { antes: "76faacb20914225261b543c3a6522c8a", depois: "e6ff6704e57bace7029fd087914969e9" },
  "public.fn_colab_bump_modelo_via_tecido()": { antes: "b259fa426ff19086c4ff5e8cf650ebcd", depois: "baa49ff49b435c4a249b340a22023507" },
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva); as 2 são SECURITY DEFINER, de gatilho (internas). */
export const MOD5_ACL: Record<string, string> = {
  "public.fn_colab_bump_modelo()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_modelo_via_tecido()": "{postgres=X/postgres,service_role=X/postgres}",
};
/** Dependências fixadas na guarda (md5). */
export const MOD5_DEPS: Record<string, string> = {
  "public.fn_colab_touch_rev()": "292f1a1077df1e08fdca7f21eb0d856c",
};
/** Tabelas cujo gatilho trg_colab_bump chama cada função (a guarda da ida confere). */
export const MOD5_GATILHOS: Record<string, string[]> = {
  "public.fn_colab_bump_modelo()": ["modelo_aviamentos","modelo_etiquetas","modelo_grades","modelo_observacoes","modelo_prova_comentarios","modelo_tecido_oc_links","modelo_tecidos"],
  "public.fn_colab_bump_modelo_via_tecido()": ["modelo_tecido_variantes"],
};

// GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s6.mjs (nunca editar à mão; rode o gerador de novo).
// Reforço de segurança S6 — md5 de ANTES (salvar_oc_etiqueta = depois da S3a) e DEPOIS das 5 funções de Salvar de OC. Usado por
// seg-s6-helpers.ts / seg-s6.test.ts.
export const S6_MD5: Record<string, { antes: string; depois: string; tabela: string }> = {
  "public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)": { antes: "aa64df90ef7daad675a69dbab7c1d585", depois: "e69ad2d9c0524d9e60d3628405052c06", tabela: "ocs_tecido" },
  "public._salvar_oc_aviamento_core(uuid,jsonb,jsonb)": { antes: "a3f2413eba2e8c8e4c7f521285564d00", depois: "dd7650c24d5403e4910e37be4714540d", tabela: "ocs_aviamento" },
  "public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)": { antes: "e71a9eb27389d429f9aeb3ac112e913b", depois: "b00e6c195035f4588f492e306c4ca536", tabela: "ocs_aviamento" },
  "public.salvar_oc_etiqueta(uuid,jsonb,jsonb)": { antes: "484b694ecc31f4c897c435063d18310e", depois: "ccafbb317bd50cfac4ec46b4d59b04f1", tabela: "ocs_etiqueta" },
  "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)": { antes: "2981a2cb4ea80fd5bed5f6999244365b", depois: "5bfa12603078c4c57fbc5abc6a2b7969", tabela: "ocs_etiqueta" },
};

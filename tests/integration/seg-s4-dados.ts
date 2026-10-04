// GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s4.mjs (nunca editar à mão; rode o gerador de novo).
// Reforço de segurança S4 — md5 das 2 funções de gatilho de módulo (e neutras), ACL exata das 13 tabelas do OTB/mix, lidos da
// cópia 54422. Usado por seg-s4-helpers.ts / seg-s4.test.ts.
export const S4_FUNCOES: { modulo: string; fn: string; depois: string; neutra: string; tabelas: string[] }[] = [
  { modulo: "otb", fn: "public.fn_seg_modulo_otb()", depois: "8fda935ba8d7703f03a1d093a00dcbdb", neutra: "acec019a691a4dc33686b00af0770d07", tabelas: ["colecao_pv_itens","colecao_semana_categorias","colecao_semanas","colecao_subcolecoes","mix_padrao_linhas","mix_padroes","otb_simulacao_linhas","otb_simulacao_modelos","otb_simulacao_variantes","otb_simulacao_unidades","otb_simulacoes","colecoes"] },
  { modulo: "criacao", fn: "public.fn_seg_modulo_criacao()", depois: "a14a25c3e585a175174b73b6dc06a561", neutra: "a9dc63bec99c49d8f7fb785757c3aa94", tabelas: ["colecao_mixes"] },
];
export const S4_ACL: Record<string, { antes: [string, string | null]; depois: [string, string | null] }> = {
  colecao_mixes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  colecao_pv_itens: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  colecao_semana_categorias: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  colecao_semanas: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  colecao_subcolecoes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  mix_padrao_linhas: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  mix_padroes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  otb_simulacao_linhas: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  otb_simulacao_modelos: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  otb_simulacao_variantes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  otb_simulacao_unidades: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  otb_simulacoes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  colecoes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
};
/** As 12 do OTB (módulo 'otb') e colecao_mixes (módulo 'criacao'). */
export const S4_OTB: string[] = ["colecao_pv_itens","colecao_semana_categorias","colecao_semanas","colecao_subcolecoes","mix_padrao_linhas","mix_padroes","otb_simulacao_linhas","otb_simulacao_modelos","otb_simulacao_variantes","otb_simulacao_unidades","otb_simulacoes","colecoes"];
export const S4_MIX = "colecao_mixes";
/** C2: as 12 plan_tecido_* graváveis (a S3d tirou a escrita do cliente; a S4 exige esse estado). */
export const S4_PLAN_TECIDO: string[] = ["plan_tecido","plan_tecido_linhas","plan_tecido_materiais","plan_tecido_oc_aplicada","plan_tecido_ocs","plan_tecido_paleta","plan_tecido_pedido_fotos","plan_tecido_slot_oc","plan_tecido_slots","plan_tecido_subcolecao_categorias","plan_tecido_subcolecoes","plan_tecido_variantes"];
/** Policies nessas 25 tabelas antes da S4 (a S4 não cria nenhuma). */
export const S4_POLICIES_ANTES = 97;

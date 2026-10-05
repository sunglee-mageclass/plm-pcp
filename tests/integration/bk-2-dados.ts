// GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk2.mjs (nunca editar à mão; rode o gerador de novo).
// Backend B2 — md5 de ANTES e DEPOIS das 8 fn_colab_bump_* (rev da raiz 1x por transação), ACL de antes, dependências fixadas,
// gatilhos-filha e gatilhos de rev das raízes. Contrato de bk-helpers.ts: BK_MD5 + BK_SENTINELA (ver lá).
export const BK_MIG = "supabase/migrations/20261103141000_bk_rev_uma_vez_raizes.sql";
export const BK_DOWN = "supabase/rollback/20261103141000_bk_rev_uma_vez_raizes_down.sql";
export const BK_SENTINELA = "public.fn_colab_bump_oc()";
export const BK_MD5: Record<string, { antes: string; depois: string }> = {
  "public.fn_colab_bump_cad_direto()": { antes: "11de99c5d82533a5afe4cb84a77cf1d6", depois: "fc82f52d6fea2b38407e097f25a3c7d8" },
  "public.fn_colab_bump_cad_via_ctv()": { antes: "c7ecad42efaf2f92967e525ae0644e0b", depois: "0ac9004c6ada8b0002a301c0ea5cf171" },
  "public.fn_colab_bump_artigo_via_variante()": { antes: "ad046ad6a45b9bf313df91775583b740", depois: "1a8259e5f4d8f8242d72da552b44fcb3" },
  "public.fn_colab_bump_cq()": { antes: "3e80093567f8e1f2040c8fccaa23f014", depois: "e4107f6bb5ae69803fc8801c7fed0ad1" },
  "public.fn_colab_bump_oc()": { antes: "e5d8da33662c90594690253b10d8f611", depois: "7ebdbca9cccf758503aaa157582ddd9c" },
  "public.fn_colab_bump_oc_avi()": { antes: "acab05e51f702c0912d0138d49a4c555", depois: "edb1d74b4d5eb3a7a47d7d77d1e333e4" },
  "public.fn_colab_bump_oc_etq()": { antes: "cd39911e71bab5e8ce304e1365f3f6b5", depois: "11298265cdf5470d78e0c9867be62b48" },
  "public.fn_colab_bump_plan()": { antes: "73333b358aa6e3ea5064820bb0619fb3", depois: "128de297e8065f4f2168132d66331b69" },
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva). Funções de gatilho (internas). */
export const BK2_ACL: Record<string, string> = {
  "public.fn_colab_bump_cad_direto()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_cad_via_ctv()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_artigo_via_variante()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_cq()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_oc()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_oc_avi()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_oc_etq()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.fn_colab_bump_plan()": "{postgres=X/postgres,service_role=X/postgres}",
};
/** SECURITY DEFINER? e proconfig (array_to_string, '' = sem SET) — iguais antes/depois (K2). */
export const BK2_SEG: Record<string, { secdef: boolean; cfg: string }> = {
  "public.fn_colab_bump_cad_direto()": { secdef: false, cfg: "" },
  "public.fn_colab_bump_cad_via_ctv()": { secdef: false, cfg: "" },
  "public.fn_colab_bump_artigo_via_variante()": { secdef: false, cfg: "" },
  "public.fn_colab_bump_cq()": { secdef: true, cfg: "search_path=public" },
  "public.fn_colab_bump_oc()": { secdef: true, cfg: "search_path=public" },
  "public.fn_colab_bump_oc_avi()": { secdef: true, cfg: "search_path=public" },
  "public.fn_colab_bump_oc_etq()": { secdef: true, cfg: "search_path=public" },
  "public.fn_colab_bump_plan()": { secdef: true, cfg: "search_path=public" },
};
/** Raiz de cada função. */
export const BK2_RAIZ: Record<string, string> = {
  "public.fn_colab_bump_cad_direto()": "cad",
  "public.fn_colab_bump_cad_via_ctv()": "cad",
  "public.fn_colab_bump_artigo_via_variante()": "artigos",
  "public.fn_colab_bump_cq()": "controle_qualidade",
  "public.fn_colab_bump_oc()": "ocs_tecido",
  "public.fn_colab_bump_oc_avi()": "ocs_aviamento",
  "public.fn_colab_bump_oc_etq()": "ocs_etiqueta",
  "public.fn_colab_bump_plan()": "colecoes",
};
/** "tabela.gatilho" (ordenado) dos gatilhos AFTER ROW I/U/D que chamam cada função (a guarda da ida confere). */
export const BK2_GATILHOS: Record<string, string[]> = {
  "public.fn_colab_bump_cad_direto()": ["cad_aviamentos.trg_colab_bump_cad_avi","cad_etiquetas.trg_colab_bump_cad_etq"],
  "public.fn_colab_bump_cad_via_ctv()": ["cad_tecido_variantes.trg_colab_bump_cad_ctv"],
  "public.fn_colab_bump_artigo_via_variante()": ["variantes_tecido.trg_colab_bump_artigo_variante"],
  "public.fn_colab_bump_cq()": ["cq_variantes.trg_colab_bump"],
  "public.fn_colab_bump_oc()": ["ocs_tecido_itens.trg_colab_bump"],
  "public.fn_colab_bump_oc_avi()": ["ocs_aviamento_itens.trg_colab_bump_oc_avi"],
  "public.fn_colab_bump_oc_etq()": ["ocs_etiqueta_itens.trg_colab_bump_oc_etq"],
  "public.fn_colab_bump_plan()": ["plan_tecido.trg_colab_bump","plan_tecido_oc_aplicada.trg_colab_bump","plan_tecido_slot_oc.trg_colab_bump"],
};
/** Dependências fixadas na guarda (md5). */
export const BK2_DEPS: Record<string, string> = {
  "public.fn_colab_touch_rev()": "292f1a1077df1e08fdca7f21eb0d856c",
  "public.fn_colab_touch_plan_rev()": "f726b1d23ee55127bc84506d52cdf352",
  "public.fn_colab_touch_otb_rev()": "62b06535cdbe63bcf43ba000b44e8cb4",
};
/** Gatilhos de rev das raízes [tabela, gatilho, função] (BEFORE UPDATE ROW, sem coluna/WHEN; a guarda da ida confere). */
export const BK2_REV: [string, string, string][] = [["artigos","trg_colab_rev_artigo","public.fn_colab_touch_rev()"],["cad","trg_colab_rev_cad","public.fn_colab_touch_rev()"],["controle_qualidade","trg_colab_rev","public.fn_colab_touch_rev()"],["ocs_tecido","trg_colab_rev","public.fn_colab_touch_rev()"],["ocs_aviamento","trg_colab_rev_oc_avi","public.fn_colab_touch_rev()"],["ocs_etiqueta","trg_colab_rev_oc_etq","public.fn_colab_touch_rev()"],["colecoes","trg_colab_plan_rev","public.fn_colab_touch_plan_rev()"],["colecoes","trg_colab_otb_rev","public.fn_colab_touch_otb_rev()"]];

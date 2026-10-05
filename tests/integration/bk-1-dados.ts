// GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk1.mjs (nunca editar à mão; rode o gerador de novo).
// Backend B1 — md5 de ANTES e DEPOIS de fn_seg_pagina_modelos (lancado só pelo servidor), ACL de antes, dependências fixadas e o
// gatilho que a chama. Contrato de bk-helpers.ts: BK_MD5 + BK_SENTINELA (ver lá).
export const BK_MIG = "supabase/migrations/20261103140000_bk_lancado_protegido.sql";
export const BK_DOWN = "supabase/rollback/20261103140000_bk_lancado_protegido_down.sql";
export const BK_SENTINELA = "public.fn_seg_pagina_modelos()";
export const BK_MD5: Record<string, { antes: string; depois: string }> = {
  "public.fn_seg_pagina_modelos()": { antes: "f2e6579a764661ed6be0afe643050c6d", depois: "490ad56b650ed59547fb61545f77dfd5" },
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva); SECURITY INVOKER, search_path=public, de gatilho (interna). */
export const BK1_ACL: Record<string, string> = {
  "public.fn_seg_pagina_modelos()": "{postgres=X/postgres,service_role=X/postgres}",
};
/** Dependências fixadas na guarda (md5). */
export const BK1_DEPS: Record<string, string> = {
  "public._seg_exige_pagina(text[])": "85eff0037e61fdecefb46154ac9479d2",
};
/** O gatilho que chama a função (a guarda da ida confere). */
export const BK1_GATILHO = {"tabela":"modelos","nome":"trg_aaa_seg_pagina","tgtype":31};

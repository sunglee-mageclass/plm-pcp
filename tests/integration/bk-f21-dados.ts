// Escrito à mão (F2.1 é objeto NOVO, sem gerador): md5 da IDA de public.opcoes_colecao_modelos() — o MESMO literal das guardas de
// supabase/migrations/20261103145000_bk_opcoes_colecao.sql e dos inversos (_down/_down_drop). Contrato de bk-helpers.ts
// (BK_MD5 + BK_SENTINELA): `antes: ""` = a função não existia; "vivo" = md5 da sentinela = IDA.
// Se o corpo da RPC mudar: recalcular o md5 (pg_get_functiondef numa txn revertida na cópia) e trocar AQUI e nos 3 arquivos SQL.
export const BK_MIG = "supabase/migrations/20261103145000_bk_opcoes_colecao.sql";
export const BK_DOWN = "supabase/rollback/20261103145000_bk_opcoes_colecao_down.sql";
export const BK_DOWN_DROP = "supabase/rollback/20261103145000_bk_opcoes_colecao_down_drop.sql";
export const BK_SENTINELA = "public.opcoes_colecao_modelos()";
export const BK_MD5: Record<string, { antes: string; depois: string }> = {
  "public.opcoes_colecao_modelos()": { antes: "", depois: "e81c8269e75912056e885700d30e3e18" },
};
/** Dependência fixada pela guarda (a regra do rótulo copiada na RPC = IDA da Modularidade T3). */
export const BK_F21_DEP_ROTULO = {
  sig: "public._modelo_colecao_rotulo(uuid,uuid,text)",
  md5: "e9220bc3a67b82ddcd768b8ad5a81a46",
};

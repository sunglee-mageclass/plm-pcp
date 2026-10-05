// GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao; rode o gerador de novo).
// Urgentes R4-R8 (plan-b) - contrato dos blocos de migration para urgb-helpers.ts: por bloco, URGB_MD5 (md5 de ANTES e DEPOIS de
// cada funcao redefinida), URGB_SENTINELA (uma chave de URGB_MD5: bloco vivo = md5 da sentinela = DEPOIS), URGB_ACL (proacl::text
// de antes = depois: CREATE OR REPLACE preserva) e os arquivos (ida, _down NEUTRO, _down_drop).
export type UrgbBloco = {
  mig: string;
  down: string;
  drop: string;
  URGB_SENTINELA: string;
  URGB_MD5: Record<string, { antes: string; depois: string }>;
  URGB_ACL: Record<string, string>;
};
export const URGB_BLOCOS: Record<string, UrgbBloco> = /* URGB_JSON_INICIO */
{
  "r4a": {
    "mig": "supabase/migrations/20261103180000_urg_r4_mo_fornecedor.sql",
    "down": "supabase/rollback/20261103180000_urg_r4_mo_fornecedor_down.sql",
    "drop": "supabase/rollback/20261103180000_urg_r4_mo_fornecedor_down_drop.sql",
    "URGB_SENTINELA": "public._salvar_modelo_servico_mo_core(uuid,jsonb)",
    "URGB_MD5": {
      "public._salvar_modelo_servico_mo_core(uuid,jsonb)": {
        "antes": "540d04a79171518731a1b084c7976cb7",
        "depois": "4d13d632ae2c5b931632e93536ae2ddd"
      },
      "public.enforce_servico_mo_aprovacao()": {
        "antes": "a2115ce0538b76b7cbe1740a6227bd2e",
        "depois": "1643b69db26e2034905866356b80232e"
      },
      "public._modelo_mo_resumo_core(uuid[])": {
        "antes": "13b124236df405b9b3843da7a6071b63",
        "depois": "f1bdb88458e469eb24c3e6f58b3ce870"
      }
    },
    "URGB_ACL": {
      "public._salvar_modelo_servico_mo_core(uuid,jsonb)": "{postgres=X/postgres,service_role=X/postgres}",
      "public.enforce_servico_mo_aprovacao()": "{postgres=X/postgres,service_role=X/postgres}",
      "public._modelo_mo_resumo_core(uuid[])": "{postgres=X/postgres,service_role=X/postgres}"
    }
  }
}
/* URGB_JSON_FIM */;

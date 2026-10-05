// GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao; rode o gerador de novo).
// Urgentes R4-R8 (plan-b) - contrato dos blocos de migration para urgb-helpers.ts: por bloco, URGB_MD5 (md5 de ANTES e DEPOIS de
// cada funcao redefinida), URGB_SENTINELA (uma chave de URGB_MD5: bloco vivo = md5 da sentinela = DEPOIS), URGB_ACL (proacl::text
// de antes = depois: CREATE OR REPLACE preserva), URGB_NOVAS (funcoes criadas pelo bloco) e os arquivos (ida, _down NEUTRO, _down_drop).
export type UrgbBloco = {
  mig: string;
  down: string;
  drop: string;
  URGB_SENTINELA: string;
  URGB_MD5: Record<string, { antes: string; depois: string }>;
  URGB_ACL: Record<string, string>;
  URGB_NOVAS?: Record<string, string>; // funcoes NOVAS do bloco: md5 de DEPOIS (o _down NEUTRO as deixa; so o _down_drop apaga)
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
  },
  "r4b": {
    "mig": "supabase/migrations/20261103181000_urg_r4_servicos_da_mo.sql",
    "down": "supabase/rollback/20261103181000_urg_r4_servicos_da_mo_down.sql",
    "drop": "supabase/rollback/20261103181000_urg_r4_servicos_da_mo_down_drop.sql",
    "URGB_SENTINELA": "public._enviar_modelo_para_cad_core(uuid,text,text)",
    "URGB_MD5": {
      "public._enviar_modelo_para_cad_core(uuid,text,text)": {
        "antes": "bf28796bcd86538a3a5b516e9cf356c6",
        "depois": "6c5fc00819b4211eb08d20a1d271c9b2"
      },
      "public._aprovar_servico_mo_core(uuid,uuid,boolean,text)": {
        "antes": "859dd63992e86cc75b7abeab41dee954",
        "depois": "2ff506f1a250d7f4f79e08fc07c640eb"
      }
    },
    "URGB_ACL": {
      "public._enviar_modelo_para_cad_core(uuid,text,text)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._aprovar_servico_mo_core(uuid,uuid,boolean,text)": "{postgres=X/postgres,service_role=X/postgres}"
    },
    "URGB_NOVAS": {
      "public._servicos_da_mo_criar(uuid,uuid)": "9a54575d8595b31d3e89974e23689ecb",
      "public._servico_mo_preencher_preco(uuid)": "f8c56394f5adb07c7a42378978d77aa0"
    }
  }
}
/* URGB_JSON_FIM */;

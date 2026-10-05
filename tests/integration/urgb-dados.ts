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
      },
      "public._salvar_modelo_servico_mo_core(uuid,jsonb)": {
        "antes": "4d13d632ae2c5b931632e93536ae2ddd",
        "depois": "1a4c045651694a64c3a99de522b7be53"
      },
      "public.excluir_cad(uuid)": {
        "antes": "ba41974bab8c81cd2729da7f440dcef3",
        "depois": "a1e9336258c76ca1fc266c6313dcba4f"
      }
    },
    "URGB_ACL": {
      "public._enviar_modelo_para_cad_core(uuid,text,text)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._aprovar_servico_mo_core(uuid,uuid,boolean,text)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._salvar_modelo_servico_mo_core(uuid,jsonb)": "{postgres=X/postgres,service_role=X/postgres}",
      "public.excluir_cad(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"
    },
    "URGB_NOVAS": {
      "public._servicos_da_mo_criar(uuid,uuid)": "9a54575d8595b31d3e89974e23689ecb",
      "public._servico_mo_preencher_preco(uuid)": "f8c56394f5adb07c7a42378978d77aa0"
    }
  },
  "r5": {
    "mig": "supabase/migrations/20261103185000_urg_r5_peca_foto_previsao.sql",
    "down": "supabase/rollback/20261103185000_urg_r5_peca_foto_previsao_down.sql",
    "drop": "supabase/rollback/20261103185000_urg_r5_peca_foto_previsao_down_drop.sql",
    "URGB_SENTINELA": "public.salvar_terceirizados(uuid,jsonb,text,jsonb)",
    "URGB_MD5": {
      "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": {
        "antes": "fe2530878c26ae9a9680a7b1d02eca71",
        "depois": "388454fc81028e43d60878fa75132db2"
      }
    },
    "URGB_ACL": {
      "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"
    }
  },
  "r8a": {
    "mig": "supabase/migrations/20261103190000_urg_r8_titulo_sublinha.sql",
    "down": "supabase/rollback/20261103190000_urg_r8_titulo_sublinha_down.sql",
    "drop": "supabase/rollback/20261103190000_urg_r8_titulo_sublinha_down_drop.sql",
    "URGB_SENTINELA": "public._integracao_retrato_core(uuid,text[],jsonb)",
    "URGB_MD5": {
      "public._integracao_retrato_core(uuid,text[],jsonb)": {
        "antes": "8a5275cf8c145f88e23c5158c22fdfc6",
        "depois": "2635e1833654111858a301f7ef06ccf1"
      },
      "public.integracao_listar(text,jsonb,integer,integer)": {
        "antes": "d2d3c9c55b3a6ce8b42d1842cab415f6",
        "depois": "5fd15e4b95fc5555e055935a67af62e8"
      },
      "public._integracao_exemplo(text[],integer)": {
        "antes": "8882ce651fe5f13a44c60751692da40e",
        "depois": "d57b40f96cc4a4fdbb2f9dc0ddc6c8d7"
      }
    },
    "URGB_ACL": {
      "public._integracao_retrato_core(uuid,text[],jsonb)": "{postgres=X/postgres,service_role=X/postgres}",
      "public.integracao_listar(text,jsonb,integer,integer)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
      "public._integracao_exemplo(text[],integer)": "{postgres=X/postgres,service_role=X/postgres}"
    },
    "URGB_NOVAS": {
      "public._integracao_titulo_sublinha(text,text,text,text)": "a847a61f50f4b72608aa10edaa7ac0c9"
    }
  }
}
/* URGB_JSON_FIM */;

// GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao; rode o gerador de novo).
// Urgentes R9 (plan-c) - contrato dos blocos de migration para urgc-helpers.ts: por bloco, URGC_SENTINELA (assinatura de funcao:
// bloco vivo = md5 dela = o "depois" de URGC_MD5 ou de URGC_NOVAS), URGC_MD5 (ANTES/DEPOIS das funcoes existentes redefinidas),
// URGC_ACL (proacl::text de antes = depois), URGC_NOVAS (funcoes criadas: md5 DEPOIS), URGC_NEUTRAS (funcoes criadas que o _down
// NEUTRALIZA: md5 do texto neutro), URGC_DEPS (funcoes FIXADAS: md5 exigido pela guarda), URGC_GATILHOS (md5 do pg_get_triggerdef;
// antes null = gatilho novo), URGC_TABELAS/URGC_COLUNAS (objetos novos; so o _down_drop apaga), URGC_DROP_GUC e os arquivos.
export type UrgcBloco = {
  mig: string;
  down: string;
  drop: string;
  URGC_SENTINELA: string;
  URGC_MD5: Record<string, { antes: string; depois: string }>;
  URGC_ACL: Record<string, string>;
  URGC_NOVAS?: Record<string, string>;
  URGC_NEUTRAS?: Record<string, string>;
  URGC_DEPS?: Record<string, string>;
  URGC_WRAPPERS?: string[];
  URGC_GATILHOS?: { tabela: string; nome: string; antes: string | null; depois: string }[];
  URGC_TABELAS?: string[];
  URGC_COLUNAS?: string[];
  URGC_DROP_GUC?: string;
};
export const URGC_BLOCOS: Record<string, UrgcBloco> = /* URGC_JSON_INICIO */
{
  "r9a": {
    "mig": "supabase/migrations/20261103192000_urg_r9_peca_teste_base.sql",
    "down": "supabase/rollback/20261103192000_urg_r9_peca_teste_base_down.sql",
    "drop": "supabase/rollback/20261103192000_urg_r9_peca_teste_base_down_drop.sql",
    "URGC_SENTINELA": "public.fn_peca_teste_trava_fornecedor()",
    "URGC_MD5": {},
    "URGC_ACL": {},
    "URGC_NOVAS": {
      "public.fn_peca_teste_regredir()": "9f8ff2ef6d9a31827798470dc73d392b",
      "public.fn_peca_teste_trava_fornecedor()": "eda05ebed95f51f554afe210a5f28c89"
    },
    "URGC_NEUTRAS": {
      "public.fn_peca_teste_regredir()": "9060f2c49f9ebfb7c5e76d393302fd7c",
      "public.fn_peca_teste_trava_fornecedor()": "4b41dd70f4751bd076f6468f2c001c23"
    },
    "URGC_DEPS": {
      "public.enforce_servico_mo_aprovacao()": "1643b69db26e2034905866356b80232e",
      "public._salvar_modelo_servico_mo_core(uuid,jsonb)": "1a4c045651694a64c3a99de522b7be53",
      "public.fn_kanban_fila_por_modelo()": "83b837afaaab012d00afc37cea9b3572",
      "public.fn_kanban_fila_categoria()": "d3c2830087a8e42e72c1fc5eb9d59944",
      "public._kanban_regredir_modelo(uuid)": "77298f6a39fbd9de8954db7b961d83c9",
      "public.fn_colab_touch_rev()": "292f1a1077df1e08fdca7f21eb0d856c",
      "public.fn_audit()": "63e5855f24d17914aef609e35ffc499b",
      "public.enforce_empresa_tenant()": "85c056ec2f65fb0bc3bdab8d6cd7d713"
    },
    "URGC_GATILHOS": [
      {
        "tabela": "public.modelo_peca_teste_tentativas",
        "nome": "trg_colab_rev",
        "antes": null,
        "depois": "fb2990d55e0ab7d2d7d5016c2db6267c"
      },
      {
        "tabela": "public.modelo_peca_teste_tentativas",
        "nome": "audit_modelo_peca_teste_tentativas",
        "antes": null,
        "depois": "e9bd9ead4f5b4da3afd42be8a7949b16"
      },
      {
        "tabela": "public.modelo_peca_teste_tentativas",
        "nome": "trg_empresa_tenant",
        "antes": null,
        "depois": "ea84155f0d24d817a41bfb65127cb888"
      },
      {
        "tabela": "public.modelo_peca_teste_tentativas",
        "nome": "trg_peca_teste_fila_ins",
        "antes": null,
        "depois": "8e14d2be9570c201b6a75cd301a50414"
      },
      {
        "tabela": "public.modelo_peca_teste_tentativas",
        "nome": "trg_peca_teste_fila_upd",
        "antes": null,
        "depois": "dc8fe559e89f950f5b000840fcf7448f"
      },
      {
        "tabela": "public.modelo_peca_teste_tentativas",
        "nome": "trg_peca_teste_fila_del",
        "antes": null,
        "depois": "feb9c988298b2d2b4febb46f03e7f311"
      },
      {
        "tabela": "public.modelo_peca_teste_tentativas",
        "nome": "trg_peca_teste_regredir",
        "antes": null,
        "depois": "e11d48b36b01b420616c78df17b05c04"
      },
      {
        "tabela": "public.modelo_servico_mo",
        "nome": "trg_peca_teste_trava_fornecedor",
        "antes": null,
        "depois": "1a6977ae9829a7725c3c53ed2467dbfa"
      },
      {
        "tabela": "public.categorias_terceirizado",
        "nome": "trg_kanban_fila_upd",
        "antes": "35a23318e5e44ce6af558686b275115e",
        "depois": "da0bdd092856df54079eeb3b3dbab171"
      }
    ],
    "URGC_TABELAS": [
      "public.modelo_peca_teste_tentativas"
    ],
    "URGC_COLUNAS": [
      "public.categorias_terceirizado.exige_peca_teste"
    ],
    "URGC_DROP_GUC": "app.confirmo_apagar_peca_teste"
  },
  "r9b": {
    "mig": "supabase/migrations/20261103193000_urg_r9_peca_teste_rpcs.sql",
    "down": "supabase/rollback/20261103193000_urg_r9_peca_teste_rpcs_down.sql",
    "drop": "supabase/rollback/20261103193000_urg_r9_peca_teste_rpcs_down_drop.sql",
    "URGC_SENTINELA": "public.fn_peca_teste_trava_fornecedor()",
    "URGC_MD5": {
      "public.fn_peca_teste_trava_fornecedor()": {
        "antes": "eda05ebed95f51f554afe210a5f28c89",
        "depois": "982769d4384a04d9a35d53db654667da"
      }
    },
    "URGC_ACL": {
      "public.fn_peca_teste_trava_fornecedor()": "{postgres=X/postgres,service_role=X/postgres}"
    },
    "URGC_NOVAS": {
      "public._peca_teste_aprovada(uuid,uuid,uuid)": "417fa9850a5a52204f62476818dc408c",
      "public._peca_teste_trilhas_core(uuid,uuid)": "5ae0f7025744d63508d7617e6e3a7487",
      "public.peca_teste_modelo(uuid)": "9f5e9a528d3cac6deaf3c34133f5d56b",
      "public._salvar_peca_teste_core(uuid,jsonb,jsonb)": "4b3b1586f5f4ede33d5427a10d7af20a",
      "public.salvar_peca_teste(uuid,jsonb,jsonb)": "74edd9a64f98101476de545ac8361a81",
      "public._peca_teste_quadro_core(uuid)": "6e191644f2fb4acfea04e4ff76a6f5de",
      "public.peca_teste_quadro()": "ad45b8479fb46de11ea265b7ef5a728a"
    },
    "URGC_NEUTRAS": {
      "public.peca_teste_modelo(uuid)": "693da711ec898bdbbc078439ecd1c46e",
      "public.salvar_peca_teste(uuid,jsonb,jsonb)": "4c501cdcdbf99aed1da1aef6d82f853f",
      "public._peca_teste_quadro_core(uuid)": "1821c151ef5963eb95d90167c75ba249",
      "public.peca_teste_quadro()": "d208d91fc9846fd221da953481966968"
    },
    "URGC_WRAPPERS": [
      "public.peca_teste_modelo(uuid)",
      "public.salvar_peca_teste(uuid,jsonb,jsonb)",
      "public.peca_teste_quadro()"
    ],
    "URGC_DEPS": {
      "public._exige_modulos(text[])": "b1d4958f65df2c593366926e2b56903e",
      "public._seg_exige_pagina(text[])": "85eff0037e61fdecefb46154ac9479d2",
      "public.user_can_view(text)": "643c9aa7ef41d52e3193b1e1561e1375",
      "public.enforce_servico_mo_aprovacao()": "1643b69db26e2034905866356b80232e",
      "public._modelo_colecao_rotulo(uuid,uuid,text)": "e9220bc3a67b82ddcd768b8ad5a81a46"
    }
  }
}
/* URGC_JSON_FIM */;

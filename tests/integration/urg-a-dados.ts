// GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao; rode o gerador de novo).
// Urgentes R1-R3 (plan-a) - contrato dos blocos de migration para urg-a-helpers.ts: por bloco, os arquivos (ida, _down, _down_drop),
// a sentinela (bloco vivo = md5 da sentinela = depois), volta (o _down desfaz algo? false = no-op documentado), MD5 (antes/depois de
// cada funcao EXISTENTE redefinida - cadeia de sucessores), NOVAS (funcoes criadas pelo bloco: md5 de depois) e NEUTRO (md5 do texto
// neutro que o _down deixa nas funcoes novas, quando as neutraliza).
export type UrgABloco = {
  mig: string;
  down: string;
  drop: string;
  sentinela: string;
  volta: boolean;
  MD5: Record<string, { antes: string; depois: string }>;
  NOVAS: Record<string, string>;
  NEUTRO?: Record<string, string>;
};
export const URG_A_BLOCOS: Record<string, UrgABloco> = /* URG_A_JSON_INICIO */
{
  "170000": {
    "mig": "supabase/migrations/20261103170000_urg_r1_insumo_tamanho_base.sql",
    "down": "supabase/rollback/20261103170000_urg_r1_insumo_tamanho_base_down.sql",
    "drop": "supabase/rollback/20261103170000_urg_r1_insumo_tamanho_base_down_drop.sql",
    "sentinela": "public._insumo_tamanho_efetivo(text,text,boolean)",
    "volta": false,
    "MD5": {},
    "NOVAS": {
      "public._insumo_tamanho_efetivo(text,text,boolean)": "c3cdade8a88d585492eeb6a01205ce3e",
      "public._insumo_pecas(text,jsonb,numeric)": "2e1b701be975366933e9ad704cb25c18",
      "public._insumo_fator_custo(text,jsonb,numeric)": "c32298c26ec5ed77856fd860299d958a",
      "public._insumo_tamanho_de(uuid)": "46fd6f65599f7de2d3ab12777fefa7d1",
      "public._grade_mapa_modelo(uuid)": "96b2a9c7e16fc789965dbf482b23b4c5",
      "public._grade_mapa_cad(uuid,boolean)": "44224a78f86abff7ac18f8e2051a7067"
    }
  },
  "170500": {
    "mig": "supabase/migrations/20261103170500_urg_r1_tamanho_legado.sql",
    "down": "supabase/rollback/20261103170500_urg_r1_tamanho_legado_down.sql",
    "drop": "supabase/rollback/20261103170500_urg_r1_tamanho_legado_down_drop.sql",
    "sentinela": "public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)",
    "volta": true,
    "MD5": {},
    "NOVAS": {
      "public._urg_r1_tamanho_legado_lista()": "f4445fa3dda66d27ba08faa7c8030991",
      "public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)": "cb855927bc56a6edb0391c78cc390621"
    },
    "NEUTRO": {
      "public._urg_r1_tamanho_legado_lista()": "ec571c054460a10676852e532c931e03",
      "public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)": "f7d613fb53dbaef6be59c467bbaad580"
    }
  },
  "171000": {
    "mig": "supabase/migrations/20261103171000_urg_r1_insumo_tamanho_consumidores.sql",
    "down": "supabase/rollback/20261103171000_urg_r1_insumo_tamanho_consumidores_down.sql",
    "drop": "",
    "sentinela": "public._custo_calcular(uuid,uuid[])",
    "volta": true,
    "MD5": {
      "public._custo_calcular(uuid,uuid[])": {
        "antes": "f9d87d6a1f9f307a7d83cf837730566c",
        "depois": "d10bf1397ea1fb9f37ef9b98d2aa1414"
      },
      "public.fn_custo_fila_preco()": {
        "antes": "cd405a624d82e23f0ce8120472f04471",
        "depois": "4a51428a975227cd4cdae34ae2ce1248"
      },
      "public._estoque_etiqueta_core(uuid)": {
        "antes": "28aa308d297cc18b653c6290a5b3b958",
        "depois": "e7681ebd0e2a32144ca41795735182fc"
      },
      "public._receber_oc_p_acabado_core(uuid,jsonb,jsonb)": {
        "antes": "3f2e2b31f6f28aaa35c9b13c1fb197be",
        "depois": "6cf6fe59c64d01450ce9c8c9a5cac951"
      }
    },
    "NOVAS": {}
  },
  "172000": {
    "mig": "supabase/migrations/20261103172000_urg_r1_custo_fila_grade.sql",
    "down": "supabase/rollback/20261103172000_urg_r1_custo_fila_grade_down.sql",
    "drop": "supabase/rollback/20261103172000_urg_r1_custo_fila_grade_down_drop.sql",
    "sentinela": "public.fn_custo_fila_grade()",
    "volta": true,
    "MD5": {},
    "NOVAS": {
      "public.fn_custo_fila_grade()": "6193e2458d9f566caa3b4ff7d0b6a551"
    },
    "NEUTRO": {
      "public.fn_custo_fila_grade()": "619e266e6dbbc469637802b8acf9920a"
    }
  }
}
/* URG_A_JSON_FIM */;
// ======================== INICIO secao R3 (gerar-a3.mjs) ========================
// GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao; rode o gerador de novo). Blocos R3 (176000..178000) do plan-a numa secao PROPRIA,
// fora do JSON do gerar-a1/a2 (a juncao com a raia 1 e so acrescimo no fim deste arquivo); entram em URG_A_BLOCOS na carga do modulo.
// O gerar-a3 troca SO o JSON entre os marcadores URG_A3_JSON_*.
Object.assign(URG_A_BLOCOS, /* URG_A3_JSON_INICIO */
{
  "176000": {
    "mig": "supabase/migrations/20261103176000_urg_r3_estoque_mov_log.sql",
    "down": "supabase/rollback/20261103176000_urg_r3_estoque_mov_log_down.sql",
    "drop": "supabase/rollback/20261103176000_urg_r3_estoque_mov_log_down_drop.sql",
    "sentinela": "public.fn_estoque_mov_log()",
    "volta": true,
    "MD5": {},
    "NOVAS": {
      "public.fn_estoque_mov_log()": "b50b96f26df262c55a4a9085e56bbb10"
    },
    "NEUTRO": {
      "public.fn_estoque_mov_log()": "910a696b98994505c5257369bb9df434"
    }
  }
}
/* URG_A3_JSON_FIM */);
// ======================== FIM secao R3 (gerar-a3.mjs) ========================

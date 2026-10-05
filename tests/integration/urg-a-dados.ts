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
      "public._urg_r1_tamanho_legado_lista()": "143abc25ee038ec27bd246e51ef0fbcb",
      "public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)": "6d5f3f2998d22ed72fc5ac479932eb44"
    },
    "NEUTRO": {
      "public._urg_r1_tamanho_legado_lista()": "ec571c054460a10676852e532c931e03",
      "public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)": "f7d613fb53dbaef6be59c467bbaad580"
    }
  }
}
/* URG_A_JSON_FIM */;

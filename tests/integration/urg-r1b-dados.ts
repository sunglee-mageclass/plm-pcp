// GERADO por .superpowers/sdd/2026-10-06-r1b/gerar/gerar.py (nunca editar a mao; rode o gerador de novo).
// Urgentes R1b (20261103198000) - contrato do bloco para urg-r1b-helpers.ts: arquivos (ida, _down NEUTRO, _down_drop) e o md5
// (pg_get_functiondef) das 2 funcoes NOVAS no texto de DEPOIS (ida) e no NEUTRO (_down).
export const URG_R1B = {
  mig: "supabase/migrations/20261103198000_urg_r1b_enviar_tamanho.sql",
  down: "supabase/rollback/20261103198000_urg_r1b_enviar_tamanho_down.sql",
  drop: "supabase/rollback/20261103198000_urg_r1b_enviar_tamanho_down_drop.sql",
  previa: "supabase/consultas/urg_r1b_enviar_previa.sql",
  PREVIA: "public._urg_r1b_enviar_previa()",
  RODAR: "public._urg_r1b_enviar_rodar(jsonb,text,integer)",
  BKP: "public._bkp_urg_r1b_enviar",
  DEPOIS: {
    "public._urg_r1b_enviar_previa()": "1158cdbfeaf90192295dfc9f4fdd9295",
    "public._urg_r1b_enviar_rodar(jsonb,text,integer)": "d82b6115a4a511149e7cd9bab7274716",
  } as Record<string, string>,
  NEUTRO: {
    "public._urg_r1b_enviar_previa()": "db45b0b5ef1f5d901d6d916231d7b922",
    "public._urg_r1b_enviar_rodar(jsonb,text,integer)": "ee1f3f18beed61a257e00937e543ac29",
  } as Record<string, string>,
} as const;

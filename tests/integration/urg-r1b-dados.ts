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
    "public._urg_r1b_enviar_previa()": "9d84152d6b374b20fe56d3e7f62fb0f6",
    "public._urg_r1b_enviar_rodar(jsonb,text,integer)": "9ce45cc6527928966d66c748f67f83bd",
  } as Record<string, string>,
  NEUTRO: {
    "public._urg_r1b_enviar_previa()": "406373740d9a3d37e407b0336102fbde",
    "public._urg_r1b_enviar_rodar(jsonb,text,integer)": "ee1f3f18beed61a257e00937e543ac29",
  } as Record<string, string>,
} as const;

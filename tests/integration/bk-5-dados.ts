// GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk5.mjs (nunca editar à mão; rode o gerador de novo).
// Backend B5 — md5 de ANTES e DEPOIS do gatilho fn_seg_modulo_otb e das 9 RPCs DEFINER do OTB (portão de página 'otb'), ACL de
// antes, dependências e as listas conferidas pelo gerador. Contrato de bk-helpers.ts: BK_MD5 + BK_SENTINELA (ver lá).
export const BK_MIG = "supabase/migrations/20261103148000_bk_otb_pagina.sql";
export const BK_DOWN = "supabase/rollback/20261103148000_bk_otb_pagina_down.sql";
export const BK_SENTINELA = "public.fn_seg_modulo_otb()";
export const BK_MD5: Record<string, { antes: string; depois: string }> = {
  "public.fn_seg_modulo_otb()": { antes: "8fda935ba8d7703f03a1d093a00dcbdb", depois: "352310db50b9c65d59ee8cac28b1af80" },
  "public.otb_salvar_colecao(jsonb)": { antes: "df2a3b972a0d48cf80369d029a9fd1bb", depois: "102b85903cb30103c6f68c7715537ba5" },
  "public.otb_confirmar(uuid)": { antes: "0e968a691fb381723c3c5ce1d4b672ba", depois: "514245119b80691ff6e1b32b15f5326e" },
  "public.otb_confirmar_pv(uuid)": { antes: "1c90ab56b3ee72efacece9135a8f58a6", depois: "d7d3895ee574b7a46f32e429cb2faa14" },
  "public.otb_desconfirmar(uuid)": { antes: "2c018e00c2561df61a87300210fc2a4f", depois: "c471d040acd2d5f6ddff2a832450ab50" },
  "public.otb_excluir_colecao(uuid)": { antes: "4ba36eb4972d10832ed8eb1e8b89adea", depois: "2ec1895cfcdc3d741835d4e09eddf60a" },
  "public.otb_importar_colecoes()": { antes: "bdd5472fd355098b0571ba24c67a6306", depois: "50a1006be3ee922d619ec05359845baa" },
  "public.otb_atribuir_card(uuid,uuid,text)": { antes: "3fc94ea41477c519d501d6f040b01507", depois: "d9ce250866d3f8197ec806ac82e52c14" },
  "public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)": { antes: "3e44d809ad10cde058c9ce5c619295b0", depois: "6c8c12d01dcc19b38c2a81c25c895c45" },
  "public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)": { antes: "180344c8d351c594448a3bf47ae72ed1", depois: "05334a66c8736637e40f036f14da1dc6" },
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva). */
export const BK5_ACL: Record<string, string> = {
  "public.fn_seg_modulo_otb()": "{postgres=X/postgres,service_role=X/postgres}",
  "public.otb_salvar_colecao(jsonb)": "{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}",
  "public.otb_confirmar(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.otb_confirmar_pv(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.otb_desconfirmar(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.otb_excluir_colecao(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.otb_importar_colecoes()": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.otb_atribuir_card(uuid,uuid,text)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
};
/** SECURITY DEFINER? (search_path=public em todas) e se authenticated executa — iguais antes/depois. */
export const BK5_SEG: Record<string, { secdef: boolean; cfg: string; authenticated: boolean }> = {
  "public.fn_seg_modulo_otb()": { secdef: false, cfg: "search_path=public", authenticated: false },
  "public.otb_salvar_colecao(jsonb)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.otb_confirmar(uuid)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.otb_confirmar_pv(uuid)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.otb_desconfirmar(uuid)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.otb_excluir_colecao(uuid)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.otb_importar_colecoes()": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.otb_atribuir_card(uuid,uuid,text)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)": { secdef: true, cfg: "search_path=public", authenticated: true },
};
export const BK5_DEPS: Record<string, string> = {
  "public._seg_exige_pagina(text[])": "85eff0037e61fdecefb46154ac9479d2",
  "public.tenant_module_enabled(text)": "ddd46592f2ff7cdb352778c605ecd8a4",
};
/** As 12 tabelas do OTB com o gatilho trg_aaa_seg_modulo (= fn_seg_modulo_otb). */
export const BK5_TABELAS: string[] = ["colecao_pv_itens","colecao_semana_categorias","colecao_semanas","colecao_subcolecoes","colecoes","mix_padrao_linhas","mix_padroes","otb_simulacao_linhas","otb_simulacao_modelos","otb_simulacao_unidades","otb_simulacao_variantes","otb_simulacoes"];
/** As 9 RPCs DEFINER com o portão (as chaves de BK_MD5 menos o gatilho). */
export const BK5_RPCS: string[] = ["public.otb_salvar_colecao(jsonb)","public.otb_confirmar(uuid)","public.otb_confirmar_pv(uuid)","public.otb_desconfirmar(uuid)","public.otb_excluir_colecao(uuid)","public.otb_importar_colecoes()","public.otb_atribuir_card(uuid,uuid,text)","public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)","public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)"];
/** DEFINER com o módulo otb que só leem (sem portão). */
export const BK5_LEITURA: string[] = ["public.otb_orcamento(uuid)","public.sidebar_badges()"];
/** DEFINER que gravam tabela do OTB e não são do OTB (Plan. Tecido). */
export const BK5_DEFINER_FORA: string[] = ["public._plan_tecido_criar_cards_core(uuid,uuid,jsonb)","public.fn_colab_bump_plan()"];
/** INVOKER que gravam as tabelas do OTB (o gatilho as morde). */
export const BK5_INVOKER: string[] = ["public.aplicar_simulacao(uuid,uuid)","public.excluir_mix_padrao(uuid)","public.excluir_simulacao(uuid)","public.salvar_colecao_pv(uuid,jsonb,jsonb)","public.salvar_mix_padrao(uuid,text,jsonb,integer)","public.salvar_simulacao(uuid,jsonb,jsonb)"];

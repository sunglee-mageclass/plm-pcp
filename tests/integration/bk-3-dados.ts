// GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk3.mjs (nunca editar à mão; rode o gerador de novo).
// Backend B3 — md5 de ANTES e DEPOIS das 11 funções com RAISE … P0002 (mensagem "não encontrado" em ASCII), ACL de antes e a
// mensagem nova de cada uma. Contrato de bk-helpers.ts: BK_MD5 + BK_SENTINELA (ver lá).
export const BK_MIG = "supabase/migrations/20261103147000_bk_p0002_ascii.sql";
export const BK_DOWN = "supabase/rollback/20261103147000_bk_p0002_ascii_down.sql";
export const BK_SENTINELA = "public.kanban_restaurar(uuid)";
export const BK_MD5: Record<string, { antes: string; depois: string }> = {
  "public._excluir_oc_importado_core(uuid)": { antes: "7f5fdd3ca5f9e0441d1813cb3e10d530", depois: "32a0d890811febf0583095fc034728a1" },
  "public._excluir_oc_p_acabado_core(uuid)": { antes: "d3be2ff0fccd81dfcbb21c15daddecb9", depois: "af404dd6ad84e6d72e2c64dd728f4607" },
  "public._excluir_oc_tecido_core(uuid)": { antes: "55a43c818a329cf0cd3c26954a00ba64", depois: "24753dee2de67ae71f28c7dd0c0d96ac" },
  "public._excluir_produto_acabado_core(uuid)": { antes: "6d247b831f5bbfcee7404278922431de", depois: "64d5b3688d2708ba929286c709f2a7d4" },
  "public._limpar_produto_acabado_core(uuid)": { antes: "153ebd8d87b1050479e73d9c93a826f1", depois: "4325fa5241b42a504a19f0072b0177f6" },
  "public._limpar_produto_importado_core(uuid)": { antes: "466d486e4e7503a0cf437713372f2d22", depois: "c54c77644a44619354d8c09f3f546a0f" },
  "public.voltar_modelo_desenvolvimento(uuid)": { antes: "a4818dafcdb30ae78e9cb2e1f84feb59", depois: "1c032fe33f9ca7b6c8433e27700c4f3a" },
  "public.kanban_mover(uuid,text)": { antes: "bc7b322df66b3e4f7ea48f5f0fd8660f", depois: "3359a79f9aa0594c2906d2fcc0341d88" },
  "public.kanban_definir_automatico(boolean)": { antes: "82c5b721b8b99611d4bf0cd7ad3be832", depois: "9435ef32a9f505543160f34240ca4c2e" },
  "public.kanban_previa_restauracao(uuid)": { antes: "8753259bb06e4a0dff467c1685bb2d2c", depois: "9cae5150dfd33da8c46fab2548c4cc84" },
  "public.kanban_restaurar(uuid)": { antes: "51897aad19562bf1d62e4aa8cdacd196", depois: "9e4bcc887057838849a2eb72fc173df1" },
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva). */
export const BK3_ACL: Record<string, string> = {
  "public._excluir_oc_importado_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._excluir_oc_p_acabado_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._excluir_oc_tecido_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._excluir_produto_acabado_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._limpar_produto_acabado_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public._limpar_produto_importado_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
  "public.voltar_modelo_desenvolvimento(uuid)": "{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}",
  "public.kanban_mover(uuid,text)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.kanban_definir_automatico(boolean)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.kanban_previa_restauracao(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.kanban_restaurar(uuid)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
};
/** SECURITY DEFINER? (search_path=public em todas) e se authenticated executa — iguais antes/depois. */
export const BK3_SEG: Record<string, { secdef: boolean; cfg: string; authenticated: boolean }> = {
  "public._excluir_oc_importado_core(uuid)": { secdef: true, cfg: "search_path=public", authenticated: false },
  "public._excluir_oc_p_acabado_core(uuid)": { secdef: true, cfg: "search_path=public", authenticated: false },
  "public._excluir_oc_tecido_core(uuid)": { secdef: true, cfg: "search_path=public", authenticated: false },
  "public._excluir_produto_acabado_core(uuid)": { secdef: true, cfg: "search_path=public", authenticated: false },
  "public._limpar_produto_acabado_core(uuid)": { secdef: true, cfg: "search_path=public", authenticated: false },
  "public._limpar_produto_importado_core(uuid)": { secdef: true, cfg: "search_path=public", authenticated: false },
  "public.voltar_modelo_desenvolvimento(uuid)": { secdef: false, cfg: "search_path=public", authenticated: true },
  "public.kanban_mover(uuid,text)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.kanban_definir_automatico(boolean)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.kanban_previa_restauracao(uuid)": { secdef: true, cfg: "search_path=public", authenticated: true },
  "public.kanban_restaurar(uuid)": { secdef: true, cfg: "search_path=public", authenticated: true },
};
/** Mensagem do RAISE … P0002: [antes (PT acentuado), depois (ASCII)]. */
export const BK3_MSG: Record<string, { antes: string; depois: string }> = {
  "public._excluir_oc_importado_core(uuid)": { antes: "OC não encontrada.", depois: "nao_encontrado: oc" },
  "public._excluir_oc_p_acabado_core(uuid)": { antes: "OC não encontrada.", depois: "nao_encontrado: oc" },
  "public._excluir_oc_tecido_core(uuid)": { antes: "OC não encontrada.", depois: "nao_encontrado: oc" },
  "public._excluir_produto_acabado_core(uuid)": { antes: "Produto não encontrado.", depois: "nao_encontrado: produto" },
  "public._limpar_produto_acabado_core(uuid)": { antes: "Produto não encontrado.", depois: "nao_encontrado: produto" },
  "public._limpar_produto_importado_core(uuid)": { antes: "Produto não encontrado.", depois: "nao_encontrado: produto" },
  "public.voltar_modelo_desenvolvimento(uuid)": { antes: "Modelo não encontrado", depois: "nao_encontrado: modelo" },
  "public.kanban_mover(uuid,text)": { antes: "Modelo não encontrado.", depois: "nao_encontrado: modelo" },
  "public.kanban_definir_automatico(boolean)": { antes: "Configuração da loja não encontrada.", depois: "nao_encontrado: config_loja" },
  "public.kanban_previa_restauracao(uuid)": { antes: "Lote de colunas não encontrado.", depois: "nao_encontrado: lote_kanban" },
  "public.kanban_restaurar(uuid)": { antes: "Lote de colunas não encontrado.", depois: "nao_encontrado: lote_kanban" },
};

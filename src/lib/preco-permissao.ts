// Permissão PRÓPRIA do preço de venda (varejo) e do preço de atacado — INDEPENDENTE de custos.
// VER = só na tela (leitura não trancada no banco, D1 A). EDITAR = trancado no banco (fn_modelo_preco_venda_gate).
// ⚠️ ORTOGONALIDADE TOTAL: estes helpers leem SÓ as chaves de preço (via canView/canEdit). Não consultam nenhuma regra
// de custo: exibir preço depende SÓ das chaves de preço; exibir custo continua dependendo SÓ das chaves de custo.
// Nenhum ponto condiciona preço a custo nem custo a preço. (O teste anti-drift lê este arquivo e recusa menções a custos.)
// Admins furam via canView/canEdit (user_can_view/_edit já os libera), como as demais seções.

/** VER preço de venda (varejo) — só tela. */
export const CHAVE_VER_PRECO_VAREJO = "criacao_planejamento:ver_preco_venda" as const;
/** VER preço de atacado — só tela. */
export const CHAVE_VER_PRECO_ATACADO = "criacao_planejamento:ver_preco_atacado" as const;
/** EDITAR preço de venda (varejo) — JÁ EXISTE; tranca no banco. */
export const CHAVE_EDITAR_PRECO_VAREJO = "criacao_planejamento:preco_venda" as const;
/** EDITAR preço de atacado — tranca no banco (ramo novo do gatilho). */
export const CHAVE_EDITAR_PRECO_ATACADO = "criacao_planejamento:preco_atacado" as const;

export function podeVerPrecoVarejo(canView: (k: string) => boolean): boolean {
  return canView(CHAVE_VER_PRECO_VAREJO);
}
export function podeVerPrecoAtacado(canView: (k: string) => boolean): boolean {
  return canView(CHAVE_VER_PRECO_ATACADO);
}
export function podeEditarPrecoVarejo(canEdit: (k: string) => boolean): boolean {
  return canEdit(CHAVE_EDITAR_PRECO_VAREJO);
}
export function podeEditarPrecoAtacado(canEdit: (k: string) => boolean): boolean {
  return canEdit(CHAVE_EDITAR_PRECO_ATACADO);
}

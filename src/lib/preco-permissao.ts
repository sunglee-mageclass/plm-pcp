// Permissão PRÓPRIA do preço de venda (varejo) e do preço de atacado — INDEPENDENTE de custos.
// VER (Leitor) = só na tela (leitura não trancada no banco, D1 A). EDITAR (Editor) = trancado no banco (fn_modelo_preco_venda_gate).
// ⚠️ ORTOGONALIDADE TOTAL: estes helpers leem SÓ as chaves de preço (via canView/canEdit). Não consultam nenhuma regra
// de custo: exibir preço depende SÓ das chaves de preço; exibir custo continua dependendo SÓ das chaves de custo.
// Nenhum ponto condiciona preço a custo nem custo a preço. (O teste anti-drift lê este arquivo e recusa menções a custos.)
// ADMIN/TENANT_ADMIN NÃO FURAM estas 2 chaves (ehPaginaSemBypassAdmin em useAuth; no banco _pode_editar_preco): só o super admin passa direto,
// os demais precisam da permissão concedida pelo super admin (mesma regra da Integração e do Exportar dados).

// UMA chave por preço: Leitor (pode_ver) = VER, Editor (pode_edit) = EDITAR (o Editor inclui ver). Não há chave `ver_*` separada.
/** Preço de venda (varejo): canView = VER (só tela); canEdit = EDITAR (tranca no banco). */
export const CHAVE_EDITAR_PRECO_VAREJO = "criacao_planejamento:preco_venda" as const;
/** Preço de atacado: canView = VER (só tela); canEdit = EDITAR (tranca no banco, ramo novo do gatilho). */
export const CHAVE_EDITAR_PRECO_ATACADO = "criacao_planejamento:preco_atacado" as const;

export function podeVerPrecoVarejo(canView: (k: string) => boolean): boolean {
  return canView(CHAVE_EDITAR_PRECO_VAREJO);
}
export function podeVerPrecoAtacado(canView: (k: string) => boolean): boolean {
  return canView(CHAVE_EDITAR_PRECO_ATACADO);
}
export function podeEditarPrecoVarejo(canEdit: (k: string) => boolean): boolean {
  return canEdit(CHAVE_EDITAR_PRECO_VAREJO);
}
export function podeEditarPrecoAtacado(canEdit: (k: string) => boolean): boolean {
  return canEdit(CHAVE_EDITAR_PRECO_ATACADO);
}

/** As 2 chaves de preço (varejo, atacado). */
export const CHAVES_PRECO: readonly string[] = [CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO];
export const ehChavePreco = (chave: string): boolean => CHAVES_PRECO.includes(chave);

/**
 * Editor de permissões (PermissoesModal/PapelEditor) — DELEGAÇÃO CONDICIONAL ("não dá o que não tem"): a célula de preço fica DESABILITADA
 * p/ quem edita se ELE não tem aquela permissão (ver → canView, editar → canEdit). Super admin passa sempre (canView/canEdit já devolvem
 * true); admin da loja só se tiver a permissão (pós "admin não fura"). UX apenas: a trava real é do banco (_exige_delegacao_preco → 42501
 * `preco_sem_delegacao`). Chave que não é de preço nunca trava aqui.
 */
export function precoTravadoNoEditor(
  chave: string,
  campo: "pode_ver" | "pode_editar",
  canView: (k: string) => boolean,
  canEdit: (k: string) => boolean,
): boolean {
  if (!ehChavePreco(chave)) return false;
  return !(campo === "pode_ver" ? canView(chave) : canEdit(chave));
}

/** Texto PT da recusa 42501 `preco_sem_delegacao: <chave>` (set_user_permissions/salvar_papel): o admin tentou conceder/retirar preço que ele não tem. */
export const TEXTO_PRECO_SEM_DELEGACAO =
  "Você não tem a permissão de preço que tentou conceder ou retirar. Só quem a tem (ou o super admin) pode concedê-la.";
/** `msg` de erro do banco → texto PT quando for a recusa de delegação do preço; senão null. */
export function mensagemPrecoSemDelegacao(msg: string): string | null {
  return msg.startsWith("preco_sem_delegacao:") ? TEXTO_PRECO_SEM_DELEGACAO : null;
}

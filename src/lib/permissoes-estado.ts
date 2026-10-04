// Transformações PURAS do estado do editor de permissões [modularidade F2, F10]. Extraídas do `PermissoesModal` para serem
// testáveis: a regra que importa é que a página de módulo DESLIGADO na loja editada nunca muda por "marcar todos" nem por
// "Voltar ao papel" (o `set_user_permissions` grava o delta: perder a linha apagaria o acesso ao religar o módulo).
import type { ModuleDef, PageKey } from "@/lib/permissions-catalog";

export type PermLinha = { pode_ver: boolean; pode_editar: boolean };
export type PermState = Record<string, PermLinha>;
export const PERM_VAZIA: PermLinha = { pode_ver: false, pode_editar: false };

/** "Marcar todos" (Leitor/Editor) de um módulo. Pula a página de módulo desligado; `soEdicao` só reage ao master Editor. */
export function marcarTodosNoModulo(
  state: PermState,
  mod: ModuleDef | undefined,
  field: "pode_ver" | "pode_editar",
  v: boolean,
  desligada: (key: PageKey) => boolean,
): PermState {
  if (!mod) return state;
  const next = { ...state };
  for (const p of mod.pages) {
    if (desligada(p.key)) continue;
    if (p.soEdicao) {
      if (field === "pode_editar") next[p.key] = { ...next[p.key], pode_editar: v };
      continue;
    }
    next[p.key] = { ...next[p.key], [field]: v };
    if (field === "pode_editar" && v) next[p.key].pode_ver = true;
    if (field === "pode_ver" && !v) next[p.key].pode_editar = false;
  }
  return next;
}

/** "Voltar ao papel": zera as exceções, EXCETO as das páginas de módulo desligado (mantém o valor atual do estado). */
export function voltarAoPapelEstado(
  state: PermState,
  papelBase: PermState,
  pageKeys: readonly PageKey[],
  desligada: (key: PageKey) => boolean,
): PermState {
  const next: PermState = {};
  for (const key of pageKeys) next[key] = desligada(key) ? { ...(state[key] ?? PERM_VAZIA) } : { ...(papelBase[key] ?? PERM_VAZIA) };
  return next;
}

/** Linhas enviadas ao Salvar (usuário comum): TODA página com ver/editar marcado, esmaecida ou não. */
export function montarPermsPayload(pageKeys: readonly PageKey[], state: PermState): { pagina: string; pode_ver: boolean; pode_editar: boolean }[] {
  return pageKeys.map((k) => ({ pagina: k, ...state[k] })).filter((p) => p.pode_ver || p.pode_editar);
}

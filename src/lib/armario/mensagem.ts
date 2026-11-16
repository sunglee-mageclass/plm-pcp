// F7 Armário — tradução dos erros das RPCs `armario_*` (P0001/42501 ASCII com prefixo `armario_xxx:`) para PT-BR.
// Lib pura sobre o `mensagemErro` genérico: o que não é do Armário cai nele.
import { mensagemErro } from "@/lib/erro-mensagem";

const POR_PREFIXO: Record<string, string> = {
  armario_publicado_travado: "Armário publicado é somente leitura. Despublique antes de renomear, excluir ou editar.",
  armario_nome_obrigatorio: "Informe o nome do armário.",
  armario_nao_encontrado: "Armário não encontrado (já foi excluído ou é de outra loja). Atualize a tela.",
  armario_colecao_invalida: "Coleção não encontrada nesta loja.",
  armario_ids_invalido: "A ordem dos armários mudou enquanto você arrastava. Atualize a tela e tente de novo.",
  armario_status_invalido: "Essa mudança de status não é permitida.",
  armario_sem_loja: "Seu usuário não tem loja ativa. Entre novamente.",
  armario_nao_autenticado: "Sua sessão expirou. Entre novamente.",
  modulo_desligado: "O módulo Criação está desligado nesta loja.",
};

export const PREFIXOS_ARMARIO = Object.keys(POR_PREFIXO);

/** Mensagem PT-BR de um erro das RPCs do Armário; sem prefixo conhecido, delega ao `mensagemErro` genérico. */
export function mensagemArmario(e: unknown, fallback?: string): string {
  const msg = String((e as any)?.message ?? (e as any)?.error?.message ?? "");
  const m = /^\s*([a-z_0-9]+)\s*(?::|$)/.exec(msg);
  if (m && POR_PREFIXO[m[1]]) return POR_PREFIXO[m[1]];
  return mensagemErro(e, fallback);
}

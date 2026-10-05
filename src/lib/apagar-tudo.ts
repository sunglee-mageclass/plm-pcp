// [camada C2 · P-262 A / C1 · P-77 A] "Apagar tudo": quando a PESSOA remove TODAS as linhas de uma lista de ESTADO COMPLETO
// (serviços do PCP, itens de OC) e clica em Salvar, o sistema pergunta "Apagar todos os N…?" e SÓ ao confirmar manda a marca
// explícita ao servidor. Sem a marca, a trava do servidor (C1) recusa o Salvar vazio (`estado_vazio_recusado:`).
//
// Os NOMES das marcas abaixo são os que a migration da C1 (`20261103160000_camada_estado_vazio`, desenho §2.4) lê — único lugar
// no front; o anti-drift `tests/unit/camada-c1-marcas.test.ts` confere contra o texto da migration. A marca vai como `true`
// (o servidor aceita boolean ou "true"). Banco velho (sem a C1) ignora a chave extra — o diálogo já protege a pessoa.
// O Direcionamento NÃO tem marca na tela: o servidor recusa sempre a lista vazia com linhas (`_rev_base->'apagar_tudo'` existe só
// para manutenção).

/** `salvar_terceirizados`: chave reservada dentro do `_rev_base` (o laço do servidor só lê chaves de bloco). */
export const MARCA_APAGAR_TUDO_SERVICOS = "_apagar_tudo";
/** `salvar_oc_tecido` / `salvar_oc_aviamento` / `salvar_oc_etiqueta`: chave dentro do `_oc`. */
export const MARCA_APAGAR_TUDO_ITENS_OC = "_apagar_itens";

/** Lançada pelo `mutationFn` quando o Salvar iria esvaziar uma lista que tem linhas no servidor e a pessoa ainda não confirmou. */
export class ApagarTudoPendenteError extends Error {
  readonly n: number;
  constructor(n: number) {
    super("apagar_tudo_pendente");
    this.name = "ApagarTudoPendenteError";
    this.n = n;
  }
}

export const ehApagarTudoPendente = (e: unknown): e is ApagarTudoPendenteError =>
  e instanceof ApagarTudoPendenteError;

/**
 * Chame no `mutationFn` DEPOIS de montar o payload e ANTES do RPC.
 * - `nPayload`: linhas que vão no payload; `nServidor`: linhas que EXISTEM hoje no servidor (as que seriam apagadas).
 * - Só exige confirmação se o payload é vazio E o servidor tem linhas (lista vazia por não ter carregado, ou servidor já
 *   vazio, não pergunta nada). Devolve `true` quando a marca "apagar tudo" deve ir junto (já confirmado).
 */
export function exigirConfirmacaoApagarTudo(p: {
  nPayload: number;
  nServidor: number;
  confirmado: boolean;
}): boolean {
  if (p.nPayload > 0 || p.nServidor <= 0) return false;
  if (!p.confirmado) throw new ApagarTudoPendenteError(p.nServidor);
  return true;
}

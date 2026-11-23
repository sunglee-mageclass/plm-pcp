// Ajuda dos testes da grade de Tecidos: a lista nasce com os tecidos RECOLHIDOS (só os cabeçalhos). Os testes que mexem nas cores
// (editar, excluir, colar, teclado) abrem tudo antes, como a pessoa faria clicando no chevron da linha-pai.
import { act } from "react";

/** Clica o chevron de cada tecido que ainda está recolhido. */
export async function expandirTudo(container: ParentNode): Promise<void> {
  const fechados = Array.from(container.querySelectorAll('[data-acao="alternar-cores"][aria-expanded="false"]')) as HTMLElement[];
  for (const b of fechados) await act(async () => { b.click(); });
}

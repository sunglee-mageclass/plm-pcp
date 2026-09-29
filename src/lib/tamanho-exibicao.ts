// "Tamanho em" nos cards (Plan. Tecido, Produto Acabado, Importado) — Tarefa 3 do plano
// `.superpowers/sdd/2026-09-29-tamanho-em/plan.md`. Camada FINA de EXIBIÇÃO sobre `src/lib/distribuicao-produto.ts`
// (`tamanhosDoTipo`/`rotuloTamanho`/`tipoDoProduto`, já testados no dialog "Distribuir por loja" — R11): NÃO
// duplica a regra de par/solto/fallback, só ACRESCENTA o que falta pros 3 cards (a regra `esmaecido`/`comValor`).
// NÃO mexe em `src/lib/tamanho.ts` (espelho SQL byte a byte). PURO (sem I/O), sem estado.
//
// ⚠️ Isto é filtro de EXIBIÇÃO, nunca de gravação: `tamanhosVisiveis` decide o que aparece na tela, mas os
// tamanhos que já têm valor lançado (chaves de `comValor`) NUNCA são removidos da lista (viram `esmaecido`,
// não desaparecem) e nada aqui apaga/edita a grade salva (`grades`/`proporcoes` continuam com a chave cheia,
// como no card Plan.Produto — plan.md Tarefa 7). Quem chama continua guardando/mandando TODAS as chaves da
// grade; este helper só escolhe quais mostrar e com qual rótulo.
import type { TamanhoTipo } from "@/lib/tamanho";
import { rotuloTamanho, tamanhosDoTipo, tipoDoProduto } from "@/lib/distribuicao-produto";

/** Item da grade filtrada p/ exibição: `chave` = a chave cheia da grade ("34|PPP"), `rotulo` = o lado escolhido
 *  (ou a própria chave, p/ solto/"UN" sem esse lado), `esmaecido` = tamanho SOLTO do lado NÃO escolhido que já
 *  tem valor lançado — fica visível (nunca esconde dado real), mas esmaecido. */
export type TamanhoVisivel = { chave: string; rotulo: string; esmaecido: boolean };

/** Tipo EFETIVO de exibição: `modelo` é a fonte de verdade (`modelos.tamanho_tipo`, já salva no card); `local` é o
 *  valor guardado em quem AINDA não tem card (vaga do Plan. Tecido `plan_tecido_slots.tamanho_tipo` ou produto sem
 *  card, P-119 A) — só vale quando `modelo` está ausente. Sem os dois ⇒ Letra (`tipoDoProduto` já cobre esse default
 *  e o legado `NULL`, P-25). */
export function tipoEfetivo(modelo?: string | null, local?: string | null): TamanhoTipo {
  return tipoDoProduto(modelo ?? local);
}

/** Rótulo de UM tamanho no tipo escolhido: o lado pedido; sem esse lado (solto do outro lado, "UN") cai na própria
 *  chave — nunca fica em branco. Reexporta `rotuloTamanho` de `distribuicao-produto.ts` sob o nome do plano
 *  (`rotuloDoTamanho`) — mesma função, sem duplicar. */
export const rotuloDoTamanho = (t: string, tipo: TamanhoTipo): string => rotuloTamanho(t, tipo);

/** Tamanhos da grade a MOSTRAR no card, no tipo escolhido: base = `tamanhosDoTipo` (R11 da Distribuição — par
 *  sempre entra, solto só com o lado escolhido, fallback mostra TUDO se nenhum item tiver esse lado), só
 *  ACRESCENTANDO a regra `esmaecido` que os 3 cards precisam e o dialog não tinha: um tamanho SOLTO do lado
 *  OPOSTO que `tamanhosDoTipo` excluiu, mas que já tem quantidade lançada (`comValor`), volta pra lista com
 *  `esmaecido: true` — dado real nunca desaparece, só perde destaque (mesma ideia do "Distribuir por loja",
 *  que esmaece proporção 0 em vez de escondê-la). Não reordena: os da base entram na ordem de `tamanhosDoTipo`;
 *  os "resgatados" por `comValor` entram depois, na ordem da grade original. */
export function tamanhosVisiveis(grade: string[], tipo: TamanhoTipo, comValor: Set<string>): TamanhoVisivel[] {
  const base = tamanhosDoTipo(grade, tipo);
  const item = (t: string, esmaecido: boolean): TamanhoVisivel => ({ chave: t, rotulo: rotuloDoTamanho(t, tipo), esmaecido });
  const naBase = new Set(base);
  const out = base.map((t) => item(t, false));
  // Fallback "mostra tudo" (`tamanhosDoTipo` devolve a grade inteira quando ninguém tem o lado escolhido): nada
  // fica de fora, então não há o que resgatar por `comValor` — evita marcar `esmaecido` sem um "lado escolhido"
  // real pra comparar.
  if (naBase.size === grade.length) return out;
  for (const t of grade) if (!naBase.has(t) && comValor.has(t)) out.push(item(t, true));
  return out;
}

// F3.3 — "abrir a seção X" por pedido (links do "Para enviar, falta…" do rodapé — porta do `irParaSecao` do Dev,
// ModeloDetailPanel.tsx:3107-3147). O orquestrador guarda o ÚLTIMO pedido e o provê; a `Secao`/`SecaoBom` com o MESMO
// `id` abre e rola até si. Um contador faz o mesmo link funcionar de novo.
import { createContext, useContext, useEffect, useRef, type RefObject } from "react";

/**
 * `inicial` (PR-GRADE-2): a seção pedida JÁ NA ABERTURA do Sheet (ex.: "Editar a grade no Sheet" da Lista tipo Excel). As seções nascem DEPOIS do
 * card carregar, então o "pedido que já existia ao montar não conta" (abaixo) não serve: a seção com o `id` pedido abre e rola até si UMA vez
 * ao montar (`usado` é consumido — remontar a seção depois não a reabre). Sem `inicial`, nada muda.
 */
export type PedidoSecao = { chave: string; n: number; inicial?: { usado: boolean } } | null;

export const PedidoSecaoContext = createContext<PedidoSecao>(null);

/** Pedido da seção que o Sheet abre ao nascer (`n: 0` — o 1º pedido de verdade, `proximoPedido`, é o `n: 1`). */
export function pedidoInicial(chave: string | null | undefined): PedidoSecao {
  return chave ? { chave, n: 0, inicial: { usado: false } } : null;
}

export function proximoPedido(atual: PedidoSecao, chave: string): PedidoSecao {
  return { chave, n: (atual?.n ?? 0) + 1 };
}

/** Abre (`abrir`) e rola até a seção quando chega um pedido NOVO para ela (o pedido que já existia ao montar não conta). */
export function usePedidoAbertura(
  id: string | undefined,
  abrir: () => void,
  ref: RefObject<HTMLElement | null>,
) {
  const pedido = useContext(PedidoSecaoContext);
  const inicialRef = useRef(pedido);
  // Seção pedida JÁ NA ABERTURA do Sheet: abre e rola até si 1× ao montar (as seções montam depois do card carregar).
  useEffect(() => {
    if (!id || !pedido?.inicial || pedido.inicial.usado || pedido.chave !== id) return;
    pedido.inicial.usado = true;
    abrir();
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!id || !pedido || pedido === inicialRef.current || pedido.chave !== id) return;
    abrir();
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);
}

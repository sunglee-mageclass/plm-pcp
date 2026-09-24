// F3.3 — "abrir a seção X" por pedido (links do "Para enviar, falta…" do rodapé — porta do `irParaSecao` do Dev,
// ModeloDetailPanel.tsx:3107-3147). O orquestrador guarda o ÚLTIMO pedido e o provê; a `Secao`/`SecaoBom` com o MESMO
// `id` abre e rola até si. Um contador faz o mesmo link funcionar de novo.
import { createContext, useContext, useEffect, useRef, type RefObject } from "react";

export type PedidoSecao = { chave: string; n: number } | null;

export const PedidoSecaoContext = createContext<PedidoSecao>(null);

export function proximoPedido(atual: PedidoSecao, chave: string): PedidoSecao {
  return { chave, n: (atual?.n ?? 0) + 1 };
}

/** Abre (`abrir`) e rola até a seção quando chega um pedido NOVO para ela (o pedido que já existia ao montar não conta). */
export function usePedidoAbertura(id: string | undefined, abrir: () => void, ref: RefObject<HTMLElement | null>) {
  const pedido = useContext(PedidoSecaoContext);
  const inicialRef = useRef(pedido);
  useEffect(() => {
    if (!id || !pedido || pedido === inicialRef.current || pedido.chave !== id) return;
    abrir();
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);
}

import { describe, it, expect } from "vitest";
import { proximoPedido } from "@/components/planejamento/planejamento-detail/secoes-abertas";

// F3.3 — links do "Para enviar, falta…" (Dev ModeloDetailPanel.tsx:3107-3147): cada clique é um pedido NOVO, mesmo para
// a mesma seção (o usuário fecha a seção e clica de novo ⇒ ela reabre e rola).
describe("proximoPedido", () => {
  it("numera cada pedido e guarda a seção pedida", () => {
    const a = proximoPedido(null, "grade");
    const b = proximoPedido(a, "grade");
    const c = proximoPedido(b, "desenvolvimento");
    expect(a).toEqual({ chave: "grade", n: 1 });
    expect(b).toEqual({ chave: "grade", n: 2 });
    expect(c).toEqual({ chave: "desenvolvimento", n: 3 });
    expect(b).not.toBe(a);
  });
});

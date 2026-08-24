import { describe, it, expect } from "vitest";
import { placeholderNumeroPedido } from "@/hooks/useNumeroPedidoAuto";

describe("placeholderNumeroPedido", () => {
  it("tecido", () => {
    expect(placeholderNumeroPedido("tecido")).toBe("T-… (escolha fornecedor e tecido)");
  });
  it("aviamento", () => {
    expect(placeholderNumeroPedido("aviamento")).toBe("A-… (escolha fornecedor e aviamento)");
  });
  it("insumo", () => {
    expect(placeholderNumeroPedido("insumo")).toBe("I-… (escolha fornecedor e insumo)");
  });
});

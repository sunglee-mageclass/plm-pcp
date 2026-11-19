import { describe, it, expect } from "vitest";
import { labelVarianteComSigla, labelVarianteRowComSigla, labelVarianteRow } from "@/lib/variante";

describe("labelVarianteComSigla", () => {
  it("cor base e apelido com sigla", () => {
    expect(labelVarianteComSigla({ cor: "AMARELO", corSigla: "AM", apelido: "AMARELO", apelidoSigla: "019" }))
      .toBe("AMARELO (AM) - AMARELO (019)");
  });
  it("cor sem sigla → parênteses vazios", () => {
    expect(labelVarianteComSigla({ cor: "AMARELO", corSigla: null, apelido: "AMARELO", apelidoSigla: "019" }))
      .toBe("AMARELO () - AMARELO (019)");
  });
  it("sem apelido → só a cor base com sigla", () => {
    expect(labelVarianteComSigla({ cor: "PRETO", corSigla: "PT" })).toBe("PRETO (PT)");
  });
  it("com nome de variante na frente", () => {
    expect(labelVarianteComSigla({ nome: "Tec1", cor: "PRETO", corSigla: "PT" })).toBe("Tec1 - PRETO (PT)");
  });
  it("apelido sem sigla → ()", () => {
    expect(labelVarianteComSigla({ cor: "AZUL", corSigla: "AZ", apelido: "MARINHO", apelidoSigla: "" }))
      .toBe("AZUL (AZ) - MARINHO ()");
  });
  it("sem cor nenhuma → '—'", () => {
    expect(labelVarianteComSigla({})).toBe("—");
  });
});

describe("labelVarianteRowComSigla", () => {
  it("linha embedada com sigla_sku na cor e no apelido", () => {
    expect(labelVarianteRowComSigla({
      nome_variante: null, codigo_variante: "V1",
      cor: { nome: "AMARELO", sigla_sku: "AM" }, apelido: { nome: "AMARELO", sigla_sku: "019" },
    })).toBe("AMARELO (AM) - AMARELO (019)");
  });
  it("cor sem sigla → ()", () => {
    expect(labelVarianteRowComSigla({ cor: { nome: "AZUL", sigla_sku: null } })).toBe("AZUL ()");
  });
  it("sem cor/nome cai no código da variante, depois '—'", () => {
    expect(labelVarianteRowComSigla({ codigo_variante: "V9" })).toBe("V9");
    expect(labelVarianteRowComSigla(null)).toBe("—");
  });
  it("fonte única labelVarianteRow segue SEM sigla", () => {
    expect(labelVarianteRow({ cor: { nome: "AMARELO" }, apelido: { nome: "AMARELO" } })).toBe("AMARELO - AMARELO");
  });
});

import { describe, it, expect } from "vitest";
import { requisitosOkPL, CONDICAO_PL_BY_KEY } from "@/lib/etapas-pl-condicoes";
describe("requisitosOkPL", () => {
  it("vazio = ok", () => expect(requisitosOkPL([], {}).ok).toBe(true));
  it("falta uma = não ok, lista o label", () => {
    const r = requisitosOkPL(["peca_teste_aprovada"], { peca_teste_aprovada: false });
    expect(r.ok).toBe(false);
    expect(r.faltando[0].label).toBe("Peça teste aprovada");
  });
  it("key desconhecida é ignorada", () => expect(requisitosOkPL(["xxx"], {}).faltando).toEqual([]));
  // CONDICAO_PL_BY_KEY: sanidade de que o catálogo expõe as 7 keys esperadas.
  it("catálogo tem as 7 condições esperadas", () => {
    for (const k of [
      "peca_teste_aprovada",
      "enviado_a_servicos",
      "materiais_separados",
      "grade_cortada_retornou",
      "oficina_entregue",
      "cq_liberado",
      "lancado",
    ]) {
      expect(CONDICAO_PL_BY_KEY.has(k), k).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import { requisitosOkPL, CONDICAO_PL_BY_KEY } from "@/lib/etapas-pl-condicoes";
describe("requisitosOkPL", () => {
  it("as 2 condições do Desenvolvimento: keys IGUAIS às do Dev (kanban-condicoes) e labels do pedido", () => {
    expect(CONDICAO_PL_BY_KEY.get("servico_aprovado")?.label).toBe("M.O. aprovada");
    expect(CONDICAO_PL_BY_KEY.get("grade_preenchida")?.label).toBe("Grade preenchida");
    const r = requisitosOkPL(["servico_aprovado", "grade_preenchida"], { servico_aprovado: true, grade_preenchida: false });
    expect(r.ok).toBe(false);
    expect(r.faltando.map((c) => c.key)).toEqual(["grade_preenchida"]);
  });
  it("vazio = ok", () => expect(requisitosOkPL([], {}).ok).toBe(true));
  it("falta uma = não ok, lista o label", () => {
    const r = requisitosOkPL(["peca_teste_aprovada"], { peca_teste_aprovada: false });
    expect(r.ok).toBe(false);
    expect(r.faltando[0].label).toBe("Peça teste aprovada");
  });
  it("key desconhecida é ignorada", () => expect(requisitosOkPL(["xxx"], {}).faltando).toEqual([]));
  // CONDICAO_PL_BY_KEY: sanidade de que o catálogo expõe as keys esperadas (as 2 do Desenvolvimento entraram na reforma de nov/2026).
  it("catálogo tem as 9 condições esperadas (7 de produção + M.O. aprovada e Grade preenchida)", () => {
    for (const k of [
      "peca_teste_aprovada",
      "servico_aprovado",
      "grade_preenchida",
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

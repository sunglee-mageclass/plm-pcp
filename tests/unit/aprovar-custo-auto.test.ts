import { describe, it, expect } from "vitest";
import { MODOS_APROVAR_CUSTO_AUTO, modoAprovarCustoAutoDoServidor } from "@/lib/aprovar-custo-auto";
import { serializarColuna } from "@/lib/config-loja-colab";

describe("R12 — modo da aprovação automática de custo por versão", () => {
  it("lista os 3 modos do CHECK do banco, 'nenhum' primeiro", () => {
    expect(MODOS_APROVAR_CUSTO_AUTO.map((m) => m.value)).toEqual(["nenhum", "interno", "todos"]);
    expect(MODOS_APROVAR_CUSTO_AUTO.map((m) => m.label)).toEqual([
      "Nenhum",
      "Só produtos internos",
      "Todos (inclui revenda e importado)",
    ]);
  });
  it("valor do servidor: os 3 passam; ausente/desconhecido cai em 'nenhum'", () => {
    expect(modoAprovarCustoAutoDoServidor("interno")).toBe("interno");
    expect(modoAprovarCustoAutoDoServidor("todos")).toBe("todos");
    expect(modoAprovarCustoAutoDoServidor("nenhum")).toBe("nenhum");
    for (const v of [null, undefined, "", "TODOS", "qualquer", 1, {}]) expect(modoAprovarCustoAutoDoServidor(v)).toBe("nenhum");
  });
  it("vai ao payload da RPC como texto, sem transformação", () => {
    expect(serializarColuna("aprovar_custo_auto_por_versao", "interno")).toBe("interno");
  });
});

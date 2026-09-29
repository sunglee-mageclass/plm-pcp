import { describe, it, expect } from "vitest";
import { pathDoElemento } from "@/lib/colab/colab-field-path";

// Vitest roda sem DOM: elemento-stub só com o que pathDoElemento lê.
const stub = (attrs: Record<string, string>, ehCampo: boolean, parent: any = null) =>
  ({
    getAttribute: (k: string) => attrs[k] ?? null,
    matches: () => ehCampo,
    parentElement: parent,
    ownerDocument: null,
    // Fix round pós-QA (F2) — `closest` MÍNIMO: só entende o seletor usado pelo fix
    // (`[role="radiogroup"][data-colab-path]`), suficiente pra exercitar pathDoElemento sem jsdom
    // (o projeto não depende de jsdom — os outros testes deste arquivo usam stub sem DOM real).
    closest(sel: string) {
      if (sel !== '[role="radiogroup"][data-colab-path]') throw new Error(`stub.closest não entende: ${sel}`);
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let cur: any = this;
      while (cur) {
        if (cur.getAttribute("role") === "radiogroup" && cur.getAttribute("data-colab-path")) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
  }) as unknown as HTMLElement;
const scope = { querySelectorAll: () => [] } as unknown as HTMLElement;

describe("colab-field-path — data-colab-path explícito vale em QUALQUER elemento (Distribuição R20)", () => {
  it("botão/checkbox com data-colab-path participa (ex.: 'atende a')", () => {
    expect(pathDoElemento(stub({ "data-colab-path": "pt-atende:m1:v1" }, false), scope)).toBe("pt-atende:m1:v1");
  });
  it("botão SEM data-colab-path continua fora", () => {
    expect(pathDoElemento(stub({}, false), scope)).toBeNull();
  });
  it("campo de texto segue a regra de sempre (data-colab-path > name > id)", () => {
    expect(pathDoElemento(stub({ "data-colab-path": "x", name: "n" }, true), scope)).toBe("x");
    expect(pathDoElemento(stub({ name: "n" }, true), scope)).toBe("name:n");
  });
});

// Fix round pós-QA (F2) — "Tamanho em" nunca mostrava o anel de presença: o foco cai no `<input type="radio">`,
// mas o `data-colab-path` mora no `<div role="radiogroup">` (o CONTAINER), não no radio. `ehCampoColab` exclui
// radio de propósito (não é "campo de texto"); sem subir ao ancestral marcado, `pathDoElemento` sempre voltava
// null pra um radio (mesmo dentro de um grupo com path). O fix sobe até o `[role="radiogroup"][data-colab-path]`
// mais próximo e publica O PATH DO GRUPO — só pra radio, e só quando o grupo TEM a marcação.
describe("colab-field-path — radio dentro de radiogroup MARCADO publica o path do GRUPO (F2)", () => {
  it("radio SEM data-colab-path próprio, dentro de um radiogroup COM data-colab-path: usa o do grupo", () => {
    const grupo = stub({ role: "radiogroup", "data-colab-path": "tamanho_tipo" }, false);
    const radio = stub({ type: "radio", name: "codigos-tamanho-em", value: "letra" }, false, grupo);
    expect(pathDoElemento(radio, scope)).toBe("tamanho_tipo");
  });
  it("radio com data-colab-path PRÓPRIO explícito continua vencendo (nunca perde a marcação direta, se algum dia existir)", () => {
    const grupo = stub({ role: "radiogroup", "data-colab-path": "tamanho_tipo" }, false);
    const radio = stub({ type: "radio", "data-colab-path": "x-proprio" }, false, grupo);
    expect(pathDoElemento(radio, scope)).toBe("x-proprio");
  });
  it("radio SOLTO (sem ancestral radiogroup marcado) segue EXCLUÍDO — comportamento intacto", () => {
    const semGrupo = stub({ type: "radio" }, false, null);
    expect(pathDoElemento(semGrupo, scope)).toBeNull();
  });
  it("radio dentro de um radiogroup SEM data-colab-path (não participante) segue EXCLUÍDO", () => {
    const grupoSemPath = stub({ role: "radiogroup" }, false);
    const radio = stub({ type: "radio" }, false, grupoSemPath);
    expect(pathDoElemento(radio, scope)).toBeNull();
  });
  it("checkbox/botão soltos (não-radio) NÃO sobem por ancestral — só o comportamento de sempre (ehCampoColab exclui)", () => {
    const grupo = stub({ role: "radiogroup", "data-colab-path": "tamanho_tipo" }, false);
    const checkbox = stub({ type: "checkbox" }, false, grupo);
    expect(pathDoElemento(checkbox, scope)).toBeNull();
  });
});

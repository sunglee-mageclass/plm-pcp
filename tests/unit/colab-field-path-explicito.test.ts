import { describe, it, expect } from "vitest";
import { pathDoElemento } from "@/lib/colab/colab-field-path";

// Vitest roda sem DOM: elemento-stub só com o que pathDoElemento lê.
const stub = (attrs: Record<string, string>, ehCampo: boolean) =>
  ({ getAttribute: (k: string) => attrs[k] ?? null, matches: () => ehCampo, parentElement: null, ownerDocument: null }) as unknown as HTMLElement;
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

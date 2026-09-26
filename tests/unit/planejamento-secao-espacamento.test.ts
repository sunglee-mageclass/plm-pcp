import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const campos = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/campos.tsx", "utf8");
const info = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx", "utf8");

describe("Seções do Sheet: espaçamento entre linhas com a trava por seção (dono 26/set)", () => {
  it("a <section> usa gap (flex col), não space-y — space-y não alcança os filhos de <fieldset className=\"contents\">", () => {
    expect(campos).toContain('<section ref={ref} className="flex flex-col gap-3" data-secao={id}>');
    expect(campos).not.toContain('<section ref={ref} className="space-y-3" data-secao={id}>');
  });
  it("a seção 1 continua usando <fieldset className=\"contents\"> na raiz das linhas (por isso o gap é necessário)", () => {
    expect(info).toMatch(/<fieldset disabled=\{(planBloqueado|compartilhadoBloqueado)\} className="contents">/);
  });
});

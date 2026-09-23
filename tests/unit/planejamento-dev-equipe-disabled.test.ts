import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// F3.1 T5 fix round 1 (revisão Opus, Important): o Radix Select abre no `pointerdown` e só respeita a
// prop `disabled` do próprio componente — o `<fieldset disabled>` do orquestrador NÃO trava um FieldSelect
// (não é um <select> nativo). Sem repassar `disabled={bloqueado}` a CADA FieldSelect de
// DevEquipeSection.tsx (Modelista, Piloteiro 1/2/3), o card enviado à Explosão continua editável com o
// mouse e a troca GRAVA no Salvar.
//
// Sem @testing-library neste repo (grep -c "testing-library" package.json = 0) — esta é a alternativa
// pedida pelo brief: um gate de FONTE que falha se qualquer `<FieldSelect` dentro do componente não
// carregar `disabled=`. Não prova runtime (isso pediria testing-library), mas barra a regressão óbvia
// (alguém adiciona um FieldSelect novo e esquece o `disabled`).

const CAMINHO = fileURLToPath(
  new URL("../../src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx", import.meta.url),
);

function blocosFieldSelect(src: string): string[] {
  // Cada uso começa em "<FieldSelect" e vai até o primeiro "/>" ou "\n            />" que fecha a tag —
  // como o componente é usado ora numa linha só, ora multi-linha, cortamos até o primeiro "/>" OU ">"
  // que aparece DEPOIS do "<FieldSelect" (nenhum uso aqui tem children, então a própria tag sempre
  // se autofecha com "/>").
  const blocos: string[] = [];
  const re = /<FieldSelect[\s\S]*?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) blocos.push(m[0]);
  return blocos;
}

describe("DevEquipeSection — todo FieldSelect trava com disabled (fix round 1)", () => {
  const src = readFileSync(CAMINHO, "utf8");
  const usos = blocosFieldSelect(src);

  it("achou pelo menos 1 uso de FieldSelect no arquivo (a lista de usos abaixo não pode ficar vazia por engano)", () => {
    expect(usos.length).toBeGreaterThanOrEqual(4); // Modelista, Piloteiro 1, 2, 3
  });

  it("TODO uso de FieldSelect recebe disabled=", () => {
    const semDisabled = usos.filter((u) => !/\bdisabled=/.test(u));
    expect(semDisabled).toEqual([]);
  });

  it("o componente declara a prop `bloqueado` e a repassa (não é um disabled hard-coded solto)", () => {
    expect(src).toMatch(/bloqueado:\s*boolean/);
    const usaBloqueado = usos.filter((u) => /disabled=\{bloqueado\}/.test(u));
    expect(usaBloqueado.length).toBe(usos.length);
  });
});

describe("PlanejamentoDetail — DevEquipeSection recebe bloqueado={devBloqueado}", () => {
  it("a fiação do orquestrador passa a trava real, não um placeholder", () => {
    const caminhoDetail = fileURLToPath(
      new URL("../../src/components/planejamento/PlanejamentoDetail.tsx", import.meta.url),
    );
    const srcDetail = readFileSync(caminhoDetail, "utf8");
    const usoNoDetail = /<DevEquipeSection[\s\S]*?\/>/.exec(srcDetail)?.[0] ?? "";
    expect(usoNoDetail).toMatch(/bloqueado=\{devBloqueado\}/);
  });
});

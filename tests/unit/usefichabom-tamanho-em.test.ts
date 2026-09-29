// @vitest-environment happy-dom
// Ressalva R-1 (re-review, `.superpowers/sdd/2026-09-29-tamanho-em/review-t3-t7.md`): a divisão IGUAL da Grade
// Total (sem proporção, `tamanhoTipo` presente) tem que cair SÓ nos tamanhos do LADO ESCOLHIDO — um tamanho
// esmaecido (solto do lado oposto, mostrado na tela só porque já tem valor lançado) NÃO recebe cota; ele
// mantém o valor que já tinha, intocado pela divisão. Este arquivo testa `useFichaBom` de verdade (hook-level,
// R-4), montado com `habilitada: false` (a query interna de variante↔artigo fica `enabled: false` — sem
// Supabase real) e um `dados` mínimo compatível com `FichaDados`.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, act as act2 } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFichaBom } from "@/components/planejamento/planejamento-detail/ficha/useFichaBom";
import type { FichaDados } from "@/components/planejamento/planejamento-detail/ficha/useFichaDados";
import type { GradeRow } from "@/components/desenvolvimento/modelo-detail/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `import.meta.url` sob `@vitest-environment happy-dom` não resolve pra um `file:` URL utilizável por
// `fileURLToPath` (o polyfill de window/location do happy-dom interfere) — usa `process.cwd()` (a raiz do
// projeto, onde o `vitest` sempre roda, por `vitest.config.ts`) em vez de derivar do módulo.
const ROOT = process.cwd() + "/";
const ler = (p: string) => readFileSync(ROOT + p, "utf8");

// Grade tipo Ark Store: soltos em número (36…44) + soltos em letra (PP…GG) — o caso exato do achado I-1/R-1.
const ARK_TAMANHOS = ["36", "38", "40", "42", "44", "PP", "P", "M", "G", "GG"];

function dadosMinimos(tamanhos: string[]): FichaDados {
  return {
    artigos: [], artigoMap: {}, artigosForro: [], artigosEntretela: [],
    aviamentos: [], aviamentoMap: {}, etiquetaOpts: [], etiquetaMap: {},
    tamanhos, tenantCfg: null, revendaCfg: {} as any,
    tecidosData: undefined, ocLinksData: undefined,
    frozenPrecos: {},
    aviamentosData: undefined, etiquetasData: undefined,
    etiquetasDataRef: { current: undefined } as any,
    gradesData: undefined,
    bomFetching: false,
    condicoes: {},
    cadExiste: false, cadFetched: false, cadErro: false, cadData: undefined,
    condicoesProntas: false,
    catalogosProntos: false,
  } as unknown as FichaDados;
}

/** Monta `useFichaBom` de verdade num QueryClient real (o hook faz `useQuery` internamente, mesmo com
 *  `habilitada: false` — a query fica `enabled: false`, então não dispara rede). `onResult` recebe o retorno
 *  do hook a CADA render, sempre com a referência mais atual — o teste chama os handlers direto dela. */
function montarFichaBom(params: {
  tamanhos: string[];
  proporcoes: Record<string, number>;
  tamanhoTipo?: "letra" | "numero" | null;
  onResult: (r: ReturnType<typeof useFichaBom>) => void;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const bom = useFichaBom({
      modeloId: null,
      habilitada: false,
      dados: dadosMinimos(params.tamanhos),
      tecidosPlanejados: [],
      proporcoes: params.proporcoes,
      setDraftTracked: vi.fn(),
      tamanhoTipo: params.tamanhoTipo,
    });
    params.onResult(bom);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act2(() => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness))); });
  return { unmount: () => { act2(() => { root.unmount(); }); container.remove(); } };
}

describe("useFichaBom — R-1: esmaecido não recebe cota na divisão igual (hook-level, R-4)", () => {
  it("Ark em Letra, sem proporção, '38' já tem 3 (esmaecido) → digitar Grade Total 10 cai SÓ em PP…GG; '38' continua com 3", () => {
    let atual: ReturnType<typeof useFichaBom> | null = null;
    const { unmount } = montarFichaBom({
      tamanhos: ARK_TAMANHOS,
      proporcoes: {}, // sem proporção — ramo "divide igualmente" de distribuiTotal
      tamanhoTipo: "letra",
      onResult: (r) => { atual = r; },
    });
    // Semeia "38"=3 (esmaecido: solto do lado NÚMERO, mas a coluna aparece porque já tem valor) via
    // updateGradeCell — o mesmo caminho que uma edição anterior deixaria no estado.
    act2(() => { atual!.handlers.updateGradeCell(1, "38", 3); });
    expect(atual!.grades.find((g) => g.variante_numero === 1)?.grades["38"]).toBe(3);

    // Agora digita a Grade Total = 10 (o input "Grade Total" do card, sem proporção definida).
    act2(() => { atual!.handlers.updateGradeTotal(1, 10); });
    const linha = atual!.grades.find((g) => g.variante_numero === 1)!;

    // "38" (esmaecido) NÃO foi zerado nem recebeu cota — mantém o valor que já tinha.
    expect(linha.grades["38"]).toBe(3);
    // Os demais soltos em número (fora da divisão) continuam a 0 (nunca tiveram valor).
    for (const t of ["36", "40", "42", "44"]) expect(linha.grades[t] ?? 0).toBe(0);
    // PP…GG (o lado escolhido) dividem os 10 igualmente entre si (5 tamanhos → 2 cada).
    for (const t of ["PP", "P", "M", "G", "GG"]) expect(linha.grades[t]).toBe(2);
    // grade_total reflete a SOMA REAL da linha (10 do lado Letra + os 3 do "38" esmaecido preservado) —
    // documentado: não é literalmente o `10` digitado, é a soma de tudo que está na linha (mesmo padrão de
    // `updateGradeCell`, que já recomputava `grade_total` como soma real antes desta ressalva).
    expect(linha.grade_total).toBe(13);
    unmount();
  });

  it("sem tamanhoTipo (comportamento de sempre): a divisão igual cai em TODOS os tamanhos, sem proteger nada", () => {
    let atual: ReturnType<typeof useFichaBom> | null = null;
    const { unmount } = montarFichaBom({
      tamanhos: ARK_TAMANHOS,
      proporcoes: {},
      tamanhoTipo: null,
      onResult: (r) => { atual = r; },
    });
    act2(() => { atual!.handlers.updateGradeCell(1, "38", 3); });
    act2(() => { atual!.handlers.updateGradeTotal(1, 10); });
    const linha = atual!.grades.find((g) => g.variante_numero === 1)!;
    // 10 tamanhos, total 10 → 1 cada (inclusive "38", que É zerado — sem filtro não há "esmaecido" a proteger).
    for (const t of ARK_TAMANHOS) expect(linha.grades[t]).toBe(1);
    expect(linha.grade_total).toBe(10);
    unmount();
  });

  it("com proporção definida (Σprop > 0): o ramo proporcional aplica em TODOS os tamanhos, mesmo com tamanhoTipo (visiveis não entra em jogo aqui)", () => {
    let atual: ReturnType<typeof useFichaBom> | null = null;
    const props = { PP: 1, P: 1, M: 1, G: 1, GG: 1 }; // só o lado Letra tem proporção > 0
    const { unmount } = montarFichaBom({
      tamanhos: ARK_TAMANHOS,
      proporcoes: props,
      tamanhoTipo: "letra",
      onResult: (r) => { atual = r; },
    });
    act2(() => { atual!.handlers.updateGradeCell(1, "38", 3); });
    act2(() => { atual!.handlers.updateGradeTotal(1, 10); });
    const linha = atual!.grades.find((g) => g.variante_numero === 1)!;
    // Ramo proporcional: "38" tem proporção 0 → recebe 0 (a proporção decide, não o filtro de exibição) — o
    // valor esmaecido antigo (3) É sobrescrito aqui, porque a conta cobre a linha inteira pela proporção real.
    expect(linha.grades["38"]).toBe(0);
    for (const t of ["PP", "P", "M", "G", "GG"]) expect(linha.grades[t]).toBe(2);
    expect(linha.grade_total).toBe(10);
    unmount();
  });

  it("Grade Total zerada ('limpar tudo'): zera a linha inteira, esmaecido incluso", () => {
    let atual: ReturnType<typeof useFichaBom> | null = null;
    const { unmount } = montarFichaBom({
      tamanhos: ARK_TAMANHOS,
      proporcoes: {},
      tamanhoTipo: "letra",
      onResult: (r) => { atual = r; },
    });
    act2(() => { atual!.handlers.updateGradeCell(1, "38", 3); });
    act2(() => { atual!.handlers.updateGradeTotal(1, 0); });
    const linha = atual!.grades.find((g) => g.variante_numero === 1)!;
    for (const t of ARK_TAMANHOS) expect(linha.grades[t] ?? 0).toBe(0);
    expect(linha.grade_total).toBe(0);
    unmount();
  });
});

// R-4 — fiação `PlanejamentoDetail` → `useFichaTecnica` → `useFichaBom`: checagem de fonte (mesmo padrão já
// usado em tests/unit/integracao-tela-fonte.test.ts p/ wiring sem lógica própria — `useFichaTecnica` depende de
// useAuth()/useEtapasAfetadas()/várias queries que tornariam um render-test frágil só p/ provar uma passagem de
// prop literal). Prova que o parâmetro realmente atravessa as 3 camadas, não só que os tipos aceitam.
describe("fiação do tamanhoTipo — PlanejamentoDetail → useFichaTecnica → useFichaBom (R-4)", () => {
  it("PlanejamentoDetail passa draft.tamanho_tipo pro useFichaTecnica", () => {
    const src = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    const inicio = src.indexOf("const ficha = useFichaTecnica({");
    expect(inicio, "chamada de useFichaTecnica não encontrada — arquivo mudou de forma?").toBeGreaterThanOrEqual(0);
    const fim = src.indexOf("});", inicio);
    const trecho = src.slice(inicio, fim);
    expect(trecho).toMatch(/tamanhoTipo:\s*draft\.tamanho_tipo/);
  });

  it("useFichaTecnica repassa a.tamanhoTipo pro useFichaBom (null no comprado, direto no interno)", () => {
    const src = ler("src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts");
    const inicio = src.indexOf("const bom = useFichaBom({");
    expect(inicio, "chamada de useFichaBom não encontrada — arquivo mudou de forma?").toBeGreaterThanOrEqual(0);
    const fim = src.indexOf("});", inicio);
    const trecho = src.slice(inicio, fim);
    expect(trecho).toMatch(/tamanhoTipo:\s*a\.isComprado\s*\?\s*null\s*:\s*a\.tamanhoTipo/);
  });

  it("useFichaBom usa o tamanhoTipo recebido pra computar tamanhosVisiveisLista (não ignora o parâmetro)", () => {
    const src = ler("src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts");
    expect(src).toMatch(/tamanhosVisiveis\(tamanhos,\s*tamanhoTipo,\s*comValor\)/);
    // E o resultado realmente entra no `distribuiTotal` de `updateGradeTotal` (não fica órfão/sem uso).
    const iUpdate = src.indexOf("const updateGradeTotal =");
    const fimUpdate = src.indexOf("const updateGradeCell =", iUpdate);
    expect(src.slice(iUpdate, fimUpdate)).toContain("tamanhosVisiveisLista");
  });
});

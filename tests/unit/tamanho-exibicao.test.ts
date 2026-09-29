// @vitest-environment happy-dom
// Tarefa 3 do plano `.superpowers/sdd/2026-09-29-tamanho-em/plan.md` — `src/lib/tamanho-exibicao.ts` +
// `src/components/shared/TamanhoEmToggle.tsx`. Casos do aceite: "PPP|34" invertido, Ark Store (soltos 36…44/PP…GG),
// solto com valor esmaecido, "UN" (Acessórios), fallback show-all.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rotuloDoTamanho, tamanhosVisiveis, tipoEfetivo } from "@/lib/tamanho-exibicao";
import { TamanhoEmToggle } from "@/components/shared/TamanhoEmToggle";

// Mesmo padrão de tests/unit/integracao-trava-tela.test.ts: sem isto, `act()` sob React 19 dev loga
// "not configured to support act(...)" e esconde falhas reais no ruído.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Monta uma raiz react-dom/client num <div> anexado ao body (happy-dom). unmount() limpa. */
function montar(el: ReturnType<typeof createElement>): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

describe("tipoEfetivo", () => {
  it("modelo é a fonte: 'numero' do card vale mesmo com local diferente", () => {
    expect(tipoEfetivo("numero", "letra")).toBe("numero");
  });
  it("sem modelo, usa o local (vaga/produto sem card, P-119 A)", () => {
    expect(tipoEfetivo(null, "numero")).toBe("numero");
    expect(tipoEfetivo(undefined, "numero")).toBe("numero");
  });
  it("sem os dois (ou legado NULL) ⇒ Letra (P-25)", () => {
    expect(tipoEfetivo(null, null)).toBe("letra");
    expect(tipoEfetivo()).toBe("letra");
    expect(tipoEfetivo(null, undefined)).toBe("letra");
  });
  it("valor desconhecido em modelo/local não vira 'numero' por acidente", () => {
    expect(tipoEfetivo("lixo", "numero")).toBe("letra"); // "lixo" não é "numero" válido → tipoDoProduto cai em letra
  });
});

describe("rotuloDoTamanho", () => {
  it("par 'PPP|34' invertido (letra à ESQUERDA, número à DIREITA) — destrincha pelo CONTEÚDO, não pela posição", () => {
    expect(rotuloDoTamanho("PPP|34", "letra")).toBe("PPP");
    expect(rotuloDoTamanho("PPP|34", "numero")).toBe("34");
  });
  it("par na ordem comum '34|PPP'", () => {
    expect(rotuloDoTamanho("34|PPP", "numero")).toBe("34");
    expect(rotuloDoTamanho("34|PPP", "letra")).toBe("PPP");
  });
  it("solto sem o lado pedido cai na própria chave (nunca em branco)", () => {
    expect(rotuloDoTamanho("PP", "numero")).toBe("PP");
    expect(rotuloDoTamanho("36", "letra")).toBe("36");
  });
  it("'UN' (Acessórios) não tem nenhum lado numérico/letra útil — cai nela mesma nos dois tipos", () => {
    expect(rotuloDoTamanho("UN", "letra")).toBe("UN");
    expect(rotuloDoTamanho("UN", "numero")).toBe("UN");
  });
});

describe("tamanhosVisiveis", () => {
  const GRADE_PAR = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
  const GRADE_PAR_INVERTIDO = ["PPP|34", "PP|36", "P|38", "M|40", "G|42", "GG|44"];
  const GRADE_ARK = ["36", "38", "40", "42", "44", "PP", "P", "M", "G", "GG"];

  it("par sempre entra nos dois tipos, com o rótulo do lado escolhido", () => {
    const letra = tamanhosVisiveis(GRADE_PAR, "letra", new Set());
    expect(letra.map((v) => v.rotulo)).toEqual(["PPP", "PP", "P", "M", "G", "GG"]);
    expect(letra.every((v) => !v.esmaecido)).toBe(true);
    const numero = tamanhosVisiveis(GRADE_PAR, "numero", new Set());
    expect(numero.map((v) => v.rotulo)).toEqual(["34", "36", "38", "40", "42", "44"]);
    expect(numero.every((v) => !v.esmaecido)).toBe(true);
  });

  it("par com chave 'PPP|34' INVERTIDA (letra à esquerda) também entra sempre, rótulo pelo CONTEÚDO", () => {
    const letra = tamanhosVisiveis(GRADE_PAR_INVERTIDO, "letra", new Set());
    expect(letra.map((v) => v.chave)).toEqual(GRADE_PAR_INVERTIDO);
    expect(letra.map((v) => v.rotulo)).toEqual(["PPP", "PP", "P", "M", "G", "GG"]);
    const numero = tamanhosVisiveis(GRADE_PAR_INVERTIDO, "numero", new Set());
    expect(numero.map((v) => v.rotulo)).toEqual(["34", "36", "38", "40", "42", "44"]);
  });

  it("Ark Store (soltos 36…44 / PP…GG): filtra pelo lado escolhido, sem esmaecer nada (nenhum tem valor)", () => {
    const letra = tamanhosVisiveis(GRADE_ARK, "letra", new Set());
    expect(letra.map((v) => v.chave)).toEqual(["PP", "P", "M", "G", "GG"]);
    expect(letra.every((v) => !v.esmaecido)).toBe(true);
    const numero = tamanhosVisiveis(GRADE_ARK, "numero", new Set());
    expect(numero.map((v) => v.chave)).toEqual(["36", "38", "40", "42", "44"]);
    expect(numero.every((v) => !v.esmaecido)).toBe(true);
  });

  it("solto do lado NÃO escolhido com valor lançado fica visível, porém esmaecido (nunca escondido)", () => {
    const comValor = new Set(["PP"]); // "PP" (letra) tem quantidade lançada, mesmo escolhendo Número
    const numero = tamanhosVisiveis(GRADE_ARK, "numero", comValor);
    // os 5 números entram normalmente + o "PP" solto esmaecido; os outros soltos de letra sem valor ficam fora
    expect(numero.map((v) => v.chave)).toEqual(["36", "38", "40", "42", "44", "PP"]);
    const pp = numero.find((v) => v.chave === "PP");
    expect(pp).toEqual({ chave: "PP", rotulo: "PP", esmaecido: true });
    const outros = numero.filter((v) => v.chave !== "PP");
    expect(outros.every((v) => !v.esmaecido)).toBe(true);
  });

  it("'UN' (Acessórios, sem tamanho) sempre entra e nunca esmaece", () => {
    expect(tamanhosVisiveis(["UN"], "numero", new Set())).toEqual([{ chave: "UN", rotulo: "UN", esmaecido: false }]);
    expect(tamanhosVisiveis(["UN"], "letra", new Set())).toEqual([{ chave: "UN", rotulo: "UN", esmaecido: false }]);
  });

  it("fallback show-all: grade sem NENHUM item do lado escolhido mostra todos sem filtrar (nunca esconde a grade)", () => {
    const soLetra = ["PP", "P", "M", "G", "GG"];
    const numero = tamanhosVisiveis(soLetra, "numero", new Set());
    expect(numero.map((v) => v.chave)).toEqual(soLetra);
    expect(numero.every((v) => !v.esmaecido)).toBe(true); // sem "lado escolhido" nenhum, não há o que comparar
  });

  it("grade vazia não quebra (mostra vazio, tipo qualquer)", () => {
    expect(tamanhosVisiveis([], "letra", new Set())).toEqual([]);
  });
});

describe("TamanhoEmToggle — render", () => {
  it("radiogroup rotulado 'Tamanho em' com as 2 opções, valor marcado e onChange", () => {
    const onChange = vi.fn();
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, { value: "letra", onChange }),
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("data-colab-path")).toBe("tamanho_tipo");
    expect(container.textContent).toContain("Tamanho em");
    const radios = Array.from(container.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    const letraInput = radios.find((r) => r.value === "letra")!;
    const numeroInput = radios.find((r) => r.value === "numero")!;
    expect(letraInput.checked).toBe(true);
    expect(numeroInput.checked).toBe(false);
    act(() => { numeroInput.click(); });
    expect(onChange).toHaveBeenCalledWith("numero");
    unmount();
  });

  it("2 instâncias na mesma página não compartilham o name do grupo de rádio nativo (useId por instância)", () => {
    const { container, unmount } = montar(
      createElement("div", null,
        createElement(TamanhoEmToggle, { value: "letra", onChange: vi.fn() }),
        createElement(TamanhoEmToggle, { value: "numero", onChange: vi.fn() }),
      ),
    );
    const groups = Array.from(container.querySelectorAll('[role="radiogroup"]'));
    expect(groups).toHaveLength(2);
    const nomesPorGrupo = groups.map((g) =>
      new Set(Array.from(g.querySelectorAll('input[type="radio"]')).map((r) => (r as HTMLInputElement).name)),
    );
    // dentro de cada grupo os 2 rádios (Letra/Número) compartilham o MESMO name (é o que os torna mutuamente
    // exclusivos); entre os 2 grupos o name tem que ser DIFERENTE.
    expect(nomesPorGrupo[0].size).toBe(1);
    expect(nomesPorGrupo[1].size).toBe(1);
    expect([...nomesPorGrupo[0]][0]).not.toBe([...nomesPorGrupo[1]][0]);
    // e cada valor continua marcado no grupo certo (a independência não é só de nome, é de estado)
    const radiosOf = (g: Element) => Array.from(g.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radiosOf(groups[0]).find((r) => r.value === "letra")!.checked).toBe(true);
    expect(radiosOf(groups[1]).find((r) => r.value === "numero")!.checked).toBe(true);
    unmount();
  });

  it("InfoHover renderiza o botão 'i' (a explicação só aparece no hover/toque — não vai ao textContent estático)", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, { value: "letra", onChange: vi.fn() }),
    );
    const info = container.querySelector('button[aria-label="Sobre o Tamanho em"]');
    expect(info).not.toBeNull();
    unmount();
  });

  it("desabilitado com motivo: os 2 rádios ficam disabled e o motivo aparece como texto e como title do grupo", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, {
        value: "numero", onChange: vi.fn(), disabled: true, motivoDesabilitado: "Integrável em 26/09 — travado",
      }),
    );
    const radios = Array.from(container.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios.every((r) => r.disabled)).toBe(true);
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("title")).toBe("Integrável em 26/09 — travado");
    expect(container.textContent).toContain("Integrável em 26/09 — travado");
    unmount();
  });

  it("motivoDesabilitado aceita ReactNode (ex.: o selo pronto da Integração) e renderiza; sem string, sem title", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, {
        value: "letra", onChange: vi.fn(), disabled: true,
        motivoDesabilitado: createElement("span", { "data-testid": "selo-integracao" }, "Integrado em 26/09 — travado"),
      }),
    );
    const selo = container.querySelector('[data-testid="selo-integracao"]');
    expect(selo).not.toBeNull();
    expect(selo?.textContent).toBe("Integrado em 26/09 — travado");
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("title")).toBeNull(); // não é string — não dá pra virar title, e não inventamos um
    unmount();
  });

  it("sem motivo, disabled não exibe title nem texto extra", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, { value: "letra", onChange: vi.fn(), disabled: true }),
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("title")).toBeNull();
    unmount();
  });

  // Fix M-4 (revisão T3+T7) — o InfoHover não fica mais DENTRO do <Label> (um <label> sem `htmlFor` ativa o 1º
  // elemento rotulável por baixo, que era o botão do InfoHover — clicar no TEXTO "Tamanho em" abria/fechava o
  // tooltip). Clicar no texto do rótulo não deve mais alternar o InfoHover.
  it("clicar no texto do rótulo 'Tamanho em' NÃO abre/fecha o InfoHover (fix M-4)", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, { value: "letra", onChange: vi.fn() }),
    );
    const label = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.startsWith("Tamanho em")) as HTMLElement;
    expect(label).toBeTruthy();
    const info = container.querySelector('button[aria-label="Sobre o Tamanho em"]') as HTMLButtonElement;
    expect(info).toBeTruthy();
    // Simula um clique de mouse no PRÓPRIO <label> (não no botão) — antes da fix, o label ativava o InfoHover
    // por estar dentro dele; agora são irmãos, então o clique no label não tem efeito sobre o tooltip.
    act(() => { label.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // O tooltip content só monta quando `open` fica true (Radix) — como não há como consultar `open` direto,
    // a prova é estrutural: o InfoHover não é descendente do <label> (não pode ser "ativado" por ele).
    expect(label.contains(info)).toBe(false);
    unmount();
  });

  // Fix M-4 (N-3) — opção desabilitada não mostra `cursor-pointer` (parecia clicável sem ser).
  it("disabled: as opções (label) trocam cursor-pointer por cursor-not-allowed + opacidade", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, { value: "letra", onChange: vi.fn(), disabled: true }),
    );
    const opcoes = Array.from(container.querySelectorAll("label")).filter((l) => l.querySelector('input[type="radio"]'));
    expect(opcoes.length).toBe(2);
    for (const o of opcoes) {
      expect(o.className).not.toContain("cursor-pointer");
      expect(o.className).toContain("cursor-not-allowed");
      expect(o.className).toContain("opacity-60");
    }
    unmount();
  });

  it("habilitado: as opções mantêm cursor-pointer (sem opacidade)", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, { value: "letra", onChange: vi.fn() }),
    );
    const opcoes = Array.from(container.querySelectorAll("label")).filter((l) => l.querySelector('input[type="radio"]'));
    for (const o of opcoes) {
      expect(o.className).toContain("cursor-pointer");
      expect(o.className).not.toContain("cursor-not-allowed");
    }
    unmount();
  });

  // Fix M-4 — `tituloDesabilitado` novo (opcional): dá `title` ao grupo mesmo quando `motivoDesabilitado` é um
  // ReactNode (não string) — sem o prop, mantém o comportamento de hoje (sem title, teste já existente acima).
  it("motivoDesabilitado ReactNode + tituloDesabilitado: o grupo ganha o title explícito", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, {
        value: "letra", onChange: vi.fn(), disabled: true,
        motivoDesabilitado: createElement("span", { "data-testid": "selo-integracao" }, "Integrado em 26/09 — travado"),
        tituloDesabilitado: "Integrado em 26/09 — travado",
      }),
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("title")).toBe("Integrado em 26/09 — travado");
    unmount();
  });

  it("motivoDesabilitado ReactNode SEM tituloDesabilitado: sem title (comportamento de sempre, API compatível)", () => {
    const { container, unmount } = montar(
      createElement(TamanhoEmToggle, {
        value: "letra", onChange: vi.fn(), disabled: true,
        motivoDesabilitado: createElement("span", null, "Integrado em 26/09 — travado"),
      }),
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("title")).toBeNull();
    unmount();
  });
});

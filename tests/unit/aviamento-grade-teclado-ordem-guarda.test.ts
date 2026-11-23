// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom */
// Grade "Lista tipo Excel" de Cadastro > Aviamentos (AV-2): TECLADO (Enter/Tab), ORDENAÇÃO por coluna (por GRUPO: as cores de um
// aviamento ficam juntas) e GUARDA do rascunho na troca de visão/filtro (a MESMA `useGuardaTrocaLista` do Tecido, com o texto da lista
// de aviamentos). Render de verdade da `AviamentosGradeAba` com `supabase` mockado (harness compartilhado).
import { describe, it, expect, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  aviamento,
  aviamentoUpdates,
  botaoSalvar,
  clicar,
  digitar,
  esperarLinhas,
  estado,
  expandirTudo,
  flush,
  linhas,
  mocks,
  montar,
  porLabel,
  PROPS,
  resetar,
  variante,
} from "./aviamento-grade-harness";

beforeEach(() => {
  resetar();
  // av1 "Zeta" (2 cores: Verde antes de Azul no servidor), av2 "Alfa" (1 cor), av3 "Meio" (sem cor)
  estado.aviamentos = [
    aviamento("av1", { codigo_nome: "Zeta", preco: 10 }),
    aviamento("av2", { codigo_nome: "Alfa", preco: 30 }),
    aviamento("av3", { codigo_nome: "Meio", preco: 20 }),
  ];
  estado.variantes = [
    variante("v1", "av1", { cor_id: "cor2" }),
    variante("v2", "av1", { cor_id: "cor1" }),
    variante("v3", "av2", { cor_id: "cor1" }),
  ];
});

const celulas = (raiz: ParentNode) =>
  Array.from(raiz.querySelectorAll("[data-grade-cel]")) as HTMLElement[];
const cel = (raiz: ParentNode, id: string) =>
  raiz.querySelector(`[data-grade-cel="${id}"]`) as HTMLInputElement | null;
async function tecla(el: HTMLElement, key: string, shiftKey = false) {
  el.focus();
  const ev = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  await act(async () => {
    el.dispatchEvent(ev);
  });
  await flush(40); // resolve o requestAnimationFrame do foco
  return ev;
}
/** Linhas (data-aviamento-id) na ordem da tela: o aviamento (linha-pai) e, logo abaixo, cada cor dele (`<aviamento>/<variante>`). */
const ordemTela = (c: HTMLElement) =>
  linhas(c)
    .filter((tr) => tr.dataset.aviamentoId)
    .map(
      (tr) =>
        `${tr.dataset.aviamentoId}${tr.dataset.varianteId ? `/${tr.dataset.varianteId}` : ""}`,
    );
const cabecalho = (c: HTMLElement, rotulo: string) =>
  Array.from(c.querySelectorAll("thead th button")).find(
    (b) => b.textContent?.trim() === rotulo,
  ) as HTMLButtonElement | undefined;
const nomesNaTela = (c: HTMLElement) =>
  linhas(c)
    .filter((tr) => tr.dataset.pai !== undefined)
    .map((tr) => (tr.querySelector('[data-col="codigo_nome"] input') as HTMLInputElement).value);

// colunas = posição em COLUNAS_AVIAMENTO: Código 0, Nome 1, Fornecedor 2, Preço 3, NCM 4, Categoria 5, Subcategoria 6, Material 7,
// Composição 8, Intervalo 9, Largura exata 10, Observações 11, Cor base 12, Cor apelido 13, Nome da variante 14, Código da variante 15,
// Preço da variante 16, Foto 17

describe("AviamentosGradeAba: teclado (Enter/Tab)", () => {
  it("toda célula de digitação ganha data-grade-cel com a linha GLOBAL da tela; Select/foto ficam de fora", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    expect(trs).toHaveLength(6); // av1: pai + 2 cores; av2: pai + 1 cor; av3 (sem cor): só o pai
    trs.forEach((tr, i) => {
      const cs = celulas(tr);
      expect(cs.length).toBeGreaterThan(0);
      cs.forEach((c) => expect(c.getAttribute("data-grade-cel")!.startsWith(`${i}:`)).toBe(true));
    });
    expect(cel(trs[0], "0:0")?.getAttribute("aria-label")).toBe("Código de Zeta");
    expect(cel(trs[0], "0:1")?.getAttribute("aria-label")).toBe("Nome de Zeta");
    expect(cel(trs[0], "0:3")?.getAttribute("aria-label")).toBe("Preço de Zeta");
    expect(cel(trs[4], "4:14")?.getAttribute("aria-label")).toBe("Nome da variante da cor de Alfa");
    // controles que não são campo de digitação: sem endereço (o foco pula por cima)
    for (const rotulo of [
      "Fornecedor de Zeta",
      "Categoria de Zeta",
      "Subcategoria de Zeta",
      "Material de Zeta",
      "Intervalo de largura de Zeta",
    ]) {
      const el = porLabel(trs[0], rotulo)[0];
      expect(el, rotulo).toBeTruthy();
      expect(el.hasAttribute("data-grade-cel"), rotulo).toBe(false);
    }
    expect(porLabel(trs[1], "Cor base da cor de Zeta")[0].hasAttribute("data-grade-cel")).toBe(
      false,
    );
    // o cabeçalho só tem célula na linha-pai (colunas 0..11) e a cor só nas colunas da cor (14..16): nunca misturam
    const colunasDe = (tr: HTMLElement) =>
      celulas(tr).map((c) => Number(c.getAttribute("data-grade-cel")!.split(":")[1]));
    for (const i of [0, 3, 5])
      expect(
        colunasDe(trs[i]).every((n) => n <= 11),
        `pai ${i}`,
      ).toBe(true);
    for (const i of [1, 2, 4])
      expect(
        colunasDe(trs[i]).every((n) => [14, 15, 16].includes(n)),
        `cor ${i}`,
      ).toBe(true);
    await t.desmontar();
  });

  it("Enter desce na mesma coluna, atravessando de um aviamento para o outro", async () => {
    const t = await montar(PROPS());
    // Nome só existe na linha-pai: desce por cima das cores de Zeta direto para o Nome do aviamento de baixo
    await tecla(cel(t.container, "0:1")!, "Enter");
    expect(document.activeElement).toBe(cel(t.container, "3:1")); // Nome de Alfa (outro aviamento)
    // Nome da variante: desce de cor em cor e, ao acabar as cores de um aviamento, atravessa para as do próximo (pulando a linha-pai)
    await tecla(cel(t.container, "1:14")!, "Enter");
    expect(document.activeElement).toBe(cel(t.container, "2:14")); // 2ª cor de Zeta
    await tecla(cel(t.container, "2:14")!, "Enter");
    expect(document.activeElement).toBe(cel(t.container, "4:14")); // cor de Alfa (outro aviamento)
    await t.desmontar();
  });

  it("Tab anda para o lado e PULA o Select; da última célula do cabeçalho segue para a 1ª cor", async () => {
    const t = await montar(PROPS());
    // Código(0) -> Nome(1) -> Fornecedor(2) é Select: do Nome cai direto no Preço(3)
    await tecla(cel(t.container, "0:1")!, "Tab");
    expect(document.activeElement).toBe(cel(t.container, "0:3"));
    // Preço(3) -> NCM(4) -> Categoria..Material (5..7) são Select -> Composição(8)
    await tecla(cel(t.container, "0:4")!, "Tab");
    expect(document.activeElement).toBe(cel(t.container, "0:8"));
    // Observações(11) é a última do cabeçalho; 12/13 são Select e a linha-pai não tem as colunas da cor: segue para a 1ª cor (Nome da variante, 14)
    await tecla(cel(t.container, "0:11")!, "Tab");
    expect(document.activeElement).toBe(cel(t.container, "1:14"));
    // Shift+Tab volta
    await tecla(cel(t.container, "1:14")!, "Tab", true);
    expect(document.activeElement).toBe(cel(t.container, "0:11"));
    await t.desmontar();
  });

  it("Enter na Composição/Observações (várias linhas) NÃO navega; Tab sim", async () => {
    const t = await montar(PROPS());
    for (const [id, proxima] of [
      ["0:8", "0:10"],
      ["0:11", "1:14"],
    ] as const) {
      const campo = cel(t.container, id)!;
      expect(campo.tagName).toBe("TEXTAREA");
      const ev = await tecla(campo, "Enter");
      expect(ev.defaultPrevented).toBe(false); // o Enter segue como quebra de linha
      expect(document.activeElement).toBe(campo);
      await tecla(campo, "Tab");
      expect(document.activeElement).toBe(cel(t.container, proxima));
    }
    await t.desmontar();
  });

  it("com os aviamentos RECOLHIDOS as cores escondidas não recebem foco: o Enter pula para o próximo aviamento", async () => {
    const t = await montar(PROPS(), {}, false);
    expect(celulas(linhas(t.container)[1]).length).toBeGreaterThan(0); // montadas (escondidas)…
    expect(linhas(t.container)[1].hidden).toBe(true);
    await tecla(cel(t.container, "0:1")!, "Enter"); // …e o Enter desce para o aviamento seguinte
    expect(document.activeElement).toBe(cel(t.container, "3:1"));
    await t.desmontar();
  });
});

describe("AviamentosGradeAba: ordenação por coluna (por GRUPO)", () => {
  it("sem clique = a ordem da lista; as cores de um aviamento não se espalham", async () => {
    const t = await montar(PROPS());
    expect(ordemTela(t.container)).toEqual(["av1", "av1/v1", "av1/v2", "av2", "av2/v3", "av3"]);
    await t.desmontar();
  });

  it("clicar em Nome ordena os AVIAMENTOS (asc, depois desc) e mantém as cores juntas, na ordem de antes", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Nome"));
    expect(nomesNaTela(t.container)).toEqual(["Alfa", "Meio", "Zeta"]);
    expect(ordemTela(t.container)).toEqual(["av2", "av2/v3", "av3", "av1", "av1/v1", "av1/v2"]);
    expect(t.container.querySelector('thead th[aria-sort="ascending"]')?.textContent).toContain(
      "Nome",
    );
    await clicar(cabecalho(t.container, "Nome"));
    expect(nomesNaTela(t.container)).toEqual(["Zeta", "Meio", "Alfa"]);
    expect(ordemTela(t.container)).toEqual(["av1", "av1/v1", "av1/v2", "av3", "av2", "av2/v3"]);
    await t.desmontar();
  });

  it("número ordena como número; vazio vai sempre para o fim", async () => {
    const t = await montar(PROPS()); // preços: Zeta 10, Alfa 30, Meio 20
    await clicar(cabecalho(t.container, "Preço"));
    expect(nomesNaTela(t.container)).toEqual(["Zeta", "Meio", "Alfa"]);
    await clicar(cabecalho(t.container, "Preço"));
    expect(nomesNaTela(t.container)).toEqual(["Alfa", "Meio", "Zeta"]);
    await t.desmontar();
  });

  it("coluna de seleção ordena pelo NOME mostrado (Fornecedor), não pelo id", async () => {
    estado.aviamentos[0].empresa_id = "emp3"; // Botões Gama
    estado.aviamentos[1].empresa_id = "emp1"; // Armarinho Alfa
    estado.aviamentos[2].empresa_id = "emp2"; // Tecelagem Beta
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Fornecedor"));
    expect(nomesNaTela(t.container)).toEqual(["Alfa", "Zeta", "Meio"]); // Armarinho Alfa < Botões Gama < Tecelagem Beta
    await t.desmontar();
  });

  it("coluna da COR ordena as cores DENTRO do aviamento, pelo NOME da cor, e o aviamento sem cor vai para o fim", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Cor base")); // Azul (cor1) < Verde (cor2)
    expect(ordemTela(t.container)).toEqual(["av1", "av1/v2", "av1/v1", "av2", "av2/v3", "av3"]);
    await clicar(cabecalho(t.container, "Cor base")); // desc: Verde primeiro dentro de Zeta
    expect(ordemTela(t.container)).toEqual(["av1", "av1/v1", "av1/v2", "av2", "av2/v3", "av3"]);
    await t.desmontar();
  });

  it("a Foto não é ordenável (sem botão no cabeçalho)", async () => {
    const t = await montar(PROPS());
    expect(cabecalho(t.container, "Foto")).toBeUndefined();
    expect(
      Array.from(t.container.querySelectorAll("thead th")).some((th) => th.textContent === "Foto"),
    ).toBe(true);
    await t.desmontar();
  });

  it("ordena pelo valor SALVO: digitar no nome NÃO faz a linha pular", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Nome"));
    const antes = ordemTela(t.container);
    await digitar(porLabel(linhas(t.container)[0], "Nome de Alfa")[0], "Zzz Novo");
    expect(ordemTela(t.container)).toEqual(antes);
    expect(nomesNaTela(t.container)[0]).toBe("Zzz Novo");
    await t.desmontar();
  });

  it("o teclado segue a ordem da TELA depois de ordenar (Enter desce para o aviamento que está embaixo)", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Nome")); // Alfa, Meio, Zeta
    await tecla(cel(t.container, "0:1")!, "Enter"); // Alfa (0) -> pula a cor dele -> Meio (2)
    expect(document.activeElement).toBe(cel(t.container, "2:1"));
    expect((document.activeElement as HTMLInputElement).value).toBe("Meio");
    await t.desmontar();
  });
});

/** Tela-mãe mínima: a MESMA guarda da tela de Aviamentos (`useGuardaTrocaLista("aviamentos")`) ligada a um toggle Cards|Lista e a um filtro. */
async function montarTela(aviamentosProp: any[]) {
  mocks();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { AviamentosGradeAba } = await import("@/components/aviamento/grade/AviamentosGradeAba");
  const { useGuardaTrocaLista } = await import("@/components/shared/useGuardaTrocaLista");
  const { useState } = await import("react");
  const trocas: string[] = [];
  function Tela() {
    const [visao, setVisao] = useState<"cards" | "lista">("lista");
    const [filtro, setFiltro] = useState<string[]>([]);
    const guarda = useGuardaTrocaLista("aviamentos");
    const visiveis = filtro.length
      ? aviamentosProp.filter((a) => filtro.includes(a.id))
      : aviamentosProp;
    return createElement(
      "div",
      null,
      createElement(
        "button",
        {
          "data-test": "cards",
          onClick: guarda.proteger(() => {
            trocas.push("cards");
            setVisao("cards");
          }),
        },
        "Cards",
      ),
      createElement(
        "button",
        {
          "data-test": "so-av2",
          onClick: guarda.proteger(() => {
            trocas.push("filtro");
            setFiltro(["av2"]);
          }),
        },
        "Só av2",
      ),
      createElement("span", { "data-test": "visao" }, visao),
      visao === "lista"
        ? createElement(AviamentosGradeAba, {
            aviamentos: visiveis as any,
            onDirtyChange: guarda.aoMudarSujo,
          })
        : createElement("p", null, "CARDS"),
      guarda.dialog,
    );
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Tela)));
  });
  await esperarLinhas(container);
  await expandirTudo(container);
  return {
    container,
    trocas,
    desmontar: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      document.body.innerHTML = "";
    },
  };
}
const dialogo = () => document.body.querySelector('[role="alertdialog"]') as HTMLElement | null;
const botaoDoDialogo = (txt: string) =>
  Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find(
    (b) => b.textContent === txt,
  ) as HTMLButtonElement;

describe("AviamentosGradeAba: guarda do rascunho na troca de visão/filtro", () => {
  it("sem rascunho, trocar de visão/filtro roda direto (sem diálogo)", async () => {
    const t = await montarTela(PROPS());
    await clicar(t.container.querySelector('[data-test="cards"]'));
    expect(dialogo()).toBeNull();
    expect(t.trocas).toEqual(["cards"]);
    await t.desmontar();
  });

  it("com rascunho, pede confirmação ('lista de aviamentos'); Continuar editando mantém a Lista e o rascunho", async () => {
    const t = await montarTela(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Nome de Zeta")[0], "Zeta Novo");
    await clicar(t.container.querySelector('[data-test="cards"]'));
    expect(dialogo()).not.toBeNull();
    expect(dialogo()!.textContent).toContain("Há alterações não salvas na lista de aviamentos.");
    expect(dialogo()!.textContent).not.toContain("tecidos");
    expect(t.trocas).toEqual([]); // ainda não trocou
    await clicar(botaoDoDialogo("Continuar editando"));
    expect(dialogo()).toBeNull();
    expect(t.container.querySelector('[data-test="visao"]')!.textContent).toBe("lista");
    expect(porLabel(linhas(t.container)[0], "Nome de Zeta")[0].value).toBe("Zeta Novo"); // rascunho intacto
    await t.desmontar();
  });

  it("Descartar confirma a troca (Cards) e o rascunho se vai; trocar de filtro idem", async () => {
    const t = await montarTela(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Nome de Zeta")[0], "Zeta Novo");
    await clicar(t.container.querySelector('[data-test="so-av2"]'));
    expect(dialogo()).not.toBeNull();
    await clicar(botaoDoDialogo("Descartar"));
    expect(t.trocas).toEqual(["filtro"]);
    expect(ordemTela(t.container)).toEqual(["av2", "av2/v3"]);
    expect(aviamentoUpdates).toHaveLength(0); // descartar nunca grava
    // sem rascunho de novo (o filtro tirou o aviamento editado): a troca seguinte roda direto
    await clicar(t.container.querySelector('[data-test="cards"]'));
    expect(dialogo()).toBeNull();
    expect(t.container.querySelector('[data-test="visao"]')!.textContent).toBe("cards");
    await t.desmontar();
  });

  it("depois de Salvar o rascunho está limpo e a troca roda direto", async () => {
    const t = await montarTela(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "NCM de Zeta")[0], "1234");
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates).toHaveLength(1);
    await clicar(t.container.querySelector('[data-test="cards"]'));
    expect(dialogo()).toBeNull();
    await t.desmontar();
  });
});

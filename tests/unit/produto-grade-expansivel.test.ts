// @vitest-environment happy-dom
// PR-GRADE-1 — Lista tipo Excel: cada produto é EXPANSÍVEL (nasce recolhido) e, aberto, mostra as cores + a matriz cor × tamanho em
// SÓ-LEITURA (PR-GRADE-2: a REVENDA com permissão edita — ver `produto-grade-edicao-revenda.test.ts`; aqui a revenda SEM permissão). Prova: nasce recolhido e SEM consultar a grade (sob demanda); interno lê as variantes do Tecido 1 + `modelo_grades`;
// comprado lê as variantes do produto (`ordem`) e as colunas vêm de `grade_proporcao`; "Tamanho em" filtra as colunas; Acessórios =
// UN; enviado à Explosão (e importado) mostram o motivo; erro de leitura é honesto; nada grava.
import { describe, it, expect, beforeEach } from "vitest";
import {
  chamadas,
  clicar,
  estado,
  flush,
  linhaDe,
  mod,
  montar,
  resetar,
  updates,
  rpc,
} from "./produto-grade-harness";

beforeEach(() => resetar());

const TAMANHOS = ["34|PPP", "36|PP", "38|P", "M", "42"];

/** Tecido 1 do modelo M1 com 2 variantes (cores) + a grade salva por variante. */
function internoComGrade(id = "M1") {
  estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
  estado.extra.modelo_tecidos = [{ id: "t1", modelo_id: id, tipo: "tecido", numero: 1 }];
  estado.extra.modelo_tecido_variantes = [
    {
      modelo_tecido_id: "t1",
      ordem: 1,
      variante_tecido_id: "v1",
      variantes_tecido: {
        nome_variante: null,
        codigo_variante: "V1",
        cor: { nome: "Preto", sigla_sku: "PT" },
        apelido: { nome: "Noite", sigla_sku: "NT" },
      },
    },
    {
      modelo_tecido_id: "t1",
      ordem: 2,
      variante_tecido_id: "v2",
      variantes_tecido: {
        nome_variante: null,
        codigo_variante: "V2",
        cor: { nome: "Rosa", sigla_sku: "RS" },
        apelido: null,
      },
    },
  ];
  estado.extra.modelo_grades = [
    {
      modelo_id: id,
      variante_numero: 1,
      grades: { "34|PPP": 2, "36|PP": 3, "38|P": 5, M: 10 },
      grade_total: 20,
    },
    { modelo_id: id, variante_numero: 2, grades: { "34|PPP": 1, M: 4 }, grade_total: 5 },
  ];
}

const abrir = async (c: HTMLElement, id: string) => {
  await clicar(linhaDe(c, id).querySelector("[data-expandir-grade]"));
  await flush();
};
const expandida = (c: HTMLElement) =>
  c.querySelector("[data-testid=produto-linha-expandida]") as HTMLElement | null;
/** A matriz desktop (a mobile repete o conteúdo empilhado, escondida por CSS). */
const tabela = (c: HTMLElement) => expandida(c)!.querySelector("table") as HTMLTableElement;
const cabecalho = (c: HTMLElement) =>
  Array.from(tabela(c).querySelectorAll("thead th")).map((th) => th.textContent);
const linhasMatriz = (c: HTMLElement) =>
  Array.from(tabela(c).querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent),
  );
const leituras = () => chamadas.filter((x) => x.tabela === "modelo_grades");

describe("ProdutosGradeTabela — expandir (PR-GRADE-1)", () => {
  it("nasce RECOLHIDO e NÃO carrega a grade de nenhum modelo (sob demanda)", async () => {
    internoComGrade();
    const t = await montar();
    expect(t.container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(expandida(t.container)).toBeNull();
    expect(t.container.querySelectorAll("[data-expandir-grade][aria-expanded=false]")).toHaveLength(
      3,
    );
    expect(leituras()).toHaveLength(0);
    expect(
      chamadas.some((x) => x.tabela === "modelo_tecidos" || x.tabela === "modelo_tecido_variantes"),
    ).toBe(false);
    await t.desmontar();
  });

  it("expandir UM modelo carrega SÓ a grade dele e mostra as cores + a matriz (Tecido 1, 'Tamanho em' Letra)", async () => {
    internoComGrade();
    const t = await montar();
    await abrir(t.container, "M1");
    expect(leituras()).toHaveLength(1);
    expect(leituras()[0].eqs.modelo_id).toBe("M1");
    expect(
      linhaDe(t.container, "M1")
        .querySelector("[data-expandir-grade]")!
        .getAttribute("aria-expanded"),
    ).toBe("true");
    // colunas = lado LETRA dos pares + solto de letra; o solto numérico ("42") some (sem quantidade lançada)
    expect(cabecalho(t.container)).toEqual(["Variante", "PPP", "PP", "P", "M", "Total"]);
    const [l1, l2] = linhasMatriz(t.container);
    expect(l1[0]).toBe("Preto (PT) - Noite (NT)");
    expect(l1.slice(1)).toEqual(["2", "3", "5", "10", "20"]);
    expect(l2[0]).toBe("Rosa (RS)");
    expect(l2.slice(1)).toEqual(["1", "0", "0", "4", "5"]);
    await t.desmontar();
  });

  it("recolher esconde a matriz; outros modelos seguem sem ser lidos", async () => {
    internoComGrade();
    const t = await montar();
    await abrir(t.container, "M1");
    await abrir(t.container, "M1");
    expect(expandida(t.container)).toBeNull();
    expect(leituras()).toHaveLength(1);
    expect(linhaDe(t.container, "M2")).not.toBeNull();
    await t.desmontar();
  });

  it("'Tamanho em' Número usa o lado numérico dos pares e o solto numérico", async () => {
    internoComGrade();
    estado.modelos = [mod("M1", { tamanho_tipo: "numero" })];
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { "34|PPP": 2, "38|P": 5 }, grade_total: 7 },
    ];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(cabecalho(t.container)).toEqual(["Variante", "34", "36", "38", "42", "Total"]);
    await t.desmontar();
  });

  it("'Tamanho em' Número com quantidade no solto de letra (M): ele fica VISÍVEL, esmaecido (nunca esconde dado)", async () => {
    internoComGrade();
    estado.modelos = [mod("M1", { tamanho_tipo: "numero" })];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(cabecalho(t.container)).toEqual(["Variante", "34", "36", "38", "42", "M", "Total"]);
    expect(
      expandida(t.container)!
        .querySelector("table thead th:nth-child(6)")!
        .parentElement!.parentElement!.parentElement!.querySelector("td.opacity-50"),
    ).not.toBeNull();
    await t.desmontar();
  });

  it("quantidade em tamanho que o filtro esconderia NUNCA some (o total sempre bate com o que se vê)", async () => {
    internoComGrade();
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { "42": 7, M: 1 }, grade_total: 8 },
    ];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(cabecalho(t.container)).toContain("42");
    expect(linhasMatriz(t.container)[0].slice(1)).toEqual(["0", "0", "0", "1", "7", "8"]);
    await t.desmontar();
  });

  it("interno só com variantes até o 1º buraco do Tecido 1 (igual à ficha)", async () => {
    internoComGrade();
    estado.extra.modelo_tecido_variantes[1].ordem = 3; // buraco na ordem 2
    const t = await montar();
    await abrir(t.container, "M1");
    expect(linhasMatriz(t.container)).toHaveLength(1);
    await t.desmontar();
  });

  it("interno sem Tecido 1 mostra o aviso (não inventa cores)", async () => {
    internoComGrade();
    estado.extra.modelo_tecidos = [];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(expandida(t.container)!.textContent).toContain("ainda não tem cores");
    expect(expandida(t.container)!.querySelector("table")).toBeNull();
    await t.desmontar();
  });

  it("Acessórios = coluna única UN", async () => {
    internoComGrade();
    estado.modelos = [mod("M1", { categoria_principal_id: "cat3" })]; // cat3 = Bolsa, grupo Acessórios
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { UN: 12 }, grade_total: 12 },
    ];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(cabecalho(t.container)).toEqual(["Variante", "UN", "Total"]);
    expect(linhasMatriz(t.container)[0].slice(1)).toEqual(["12", "12"]);
    await t.desmontar();
  });

  it("COMPRADO (revenda): cores = variantes do produto por `ordem`; colunas = tenant ∩ grade_proporcao", async () => {
    estado.modelos = [mod("M1", { origem: "revenda" })];
    estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
    estado.extra.produtos_acabados = [
      {
        modelo_id: "M1",
        id: "pa1",
        grade_proporcao: { "36|PP": 1, "38|P": 1 },
        variantes: [
          { ordem: 2, cor: { nome: "Azul" }, apelido: { nome: "Mar" } },
          { ordem: 1, cor: { nome: "Branco" }, apelido: null },
        ],
      },
    ];
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { "36|PP": 6, "38|P": 4 }, grade_total: 10 },
      { modelo_id: "M1", variante_numero: 2, grades: { "36|PP": 2 }, grade_total: 2 },
    ];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(chamadas.some((x) => x.tabela === "produtos_acabados")).toBe(true);
    expect(chamadas.some((x) => x.tabela === "modelo_tecidos")).toBe(false); // comprado NÃO usa o Tecido 1
    expect(cabecalho(t.container)).toEqual(["Variante", "PP", "P", "Total"]);
    const [l1, l2] = linhasMatriz(t.container);
    expect(l1).toEqual(["Branco", "6", "4", "10"]);
    expect(l2).toEqual(["Azul - Mar", "2", "0", "2"]);
    // PR-GRADE-2: revenda SEM permissão de editar (o harness nasce sem permissões) = leitura + o motivo (nunca um campo editável que o banco recusaria)
    expect(t.container.querySelector("[data-testid=grade-somente-leitura]")!.textContent).toBe(
      "Sem permissão para editar esta grade.",
    );
    expect(expandida(t.container)!.querySelectorAll("input")).toHaveLength(0);
    await t.desmontar();
  });

  it("COMPRADO sem produto vinculado: aviso honesto (não é erro)", async () => {
    estado.modelos = [mod("M1", { origem: "revenda" })];
    estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
    estado.extra.produtos_acabados = [];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(expandida(t.container)!.textContent).toContain("ainda não tem produto vinculado");
    expect(t.container.querySelector("[role=alert]")).toBeNull();
    await t.desmontar();
  });

  it("IMPORTADO lê `produtos_importados` e mostra o motivo da trava (grava pela ficha)", async () => {
    estado.modelos = [mod("M1", { origem: "importado" })];
    estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
    estado.extra.produtos_importados = [
      {
        modelo_id: "M1",
        id: "pi1",
        grade_proporcao: { M: 1 },
        variantes: [{ ordem: 1, cor: { nome: "Verde" }, apelido: null }],
      },
    ];
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { M: 9 }, grade_total: 9 },
    ];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(chamadas.some((x) => x.tabela === "produtos_importados")).toBe(true);
    expect(linhasMatriz(t.container)[0]).toEqual(["Verde", "9", "9"]);
    expect(t.container.querySelector("[data-testid=grade-somente-leitura]")!.textContent).toContain(
      "grava junto com a ficha",
    );
    await t.desmontar();
  });

  it("ENVIADO à Explosão mostra o motivo da trava", async () => {
    internoComGrade();
    estado.modelos = [mod("M1", { enviado_cad: true })];
    const t = await montar();
    await abrir(t.container, "M1");
    expect(t.container.querySelector("[data-testid=grade-somente-leitura]")!.textContent).toContain(
      "enviado à Explosão",
    );
    await t.desmontar();
  });

  it("erro de leitura da grade é HONESTO (aviso + tentar de novo; nunca 'sem cores')", async () => {
    internoComGrade();
    estado.falhaTabela = "modelo_grades";
    const t = await montar();
    await abrir(t.container, "M1");
    expect(expandida(t.container)!.querySelector("[role=alert]")).not.toBeNull();
    expect(expandida(t.container)!.textContent).toContain("Não foi possível carregar a grade");
    expect(expandida(t.container)!.textContent).not.toContain("ainda não tem cores");
    await t.desmontar();
  });

  it("é SÓ-LEITURA: a matriz não tem campo editável e expandir não grava nada", async () => {
    internoComGrade();
    const t = await montar();
    await abrir(t.container, "M1");
    expect(expandida(t.container)!.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(rpc.mock.calls.every(([nome]) => nome === "integracao_estado_modelos")).toBe(true);
    await t.desmontar();
  });
});

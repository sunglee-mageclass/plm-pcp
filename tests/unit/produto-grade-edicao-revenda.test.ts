// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks do banco/DOM nos testes (mesmo padrão do harness da grade) */
// PR-GRADE-2 — Lista tipo Excel: a grade de tamanhos da REVENDA EDITA na própria lista (rascunho + selo âmbar; NADA grava antes do Salvar; o Salvar
// chama `salvar_grade_revenda` — a RPC do Sheet — com o estado COMPLETO e o CAS por `rev`); INTERNO e IMPORTADO ficam só-leitura + botão
// "Editar a grade no Sheet" (abre o Sheet na seção da grade). P0409 recarrega SÓ aquela grade e mantém o rascunho.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  celula,
  clicar,
  digitar,
  estado,
  flush,
  linhaDe,
  mod,
  montar,
  resetar,
  rpc,
  salvar,
  selos,
  toast,
  updates,
} from "./produto-grade-harness";

beforeEach(() => resetar());

const TAMANHOS = ["34|PPP", "36|PP", "38|P", "M", "42"];

/** Revenda M1: 2 cores (Branco, Azul-Mar) × 2 tamanhos (PP, P) + 1 linha ÓRFÃ (variante 9, sem cor no produto) que NÃO pode ser apagada. */
function revenda(extra: Record<string, unknown> = {}) {
  estado.todasPermissoes = true;
  estado.modelos = [mod("M1", { origem: "revenda", rev: 5, ...extra }), mod("M2")];
  estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
  estado.extra.produtos_acabados = [
    {
      modelo_id: "M1",
      id: "pa1",
      grade_proporcao: { "36|PP": 1, "38|P": 1 },
      variantes: [
        { ordem: 1, cor: { nome: "Branco" }, apelido: null },
        { ordem: 2, cor: { nome: "Azul" }, apelido: { nome: "Mar" } },
      ],
    },
  ];
  estado.extra.modelo_grades = [
    { modelo_id: "M1", variante_numero: 1, grades: { "36|PP": 6, "38|P": 4 }, grade_total: 10 },
    { modelo_id: "M1", variante_numero: 2, grades: { "36|PP": 2 }, grade_total: 2 },
    { modelo_id: "M1", variante_numero: 9, grades: { "36|PP": 3 }, grade_total: 3 },
  ];
}

const abrir = async (c: HTMLElement, id = "M1") => {
  await clicar(linhaDe(c, id).querySelector("[data-expandir-grade]"));
  await flush();
};
const expandida = (c: HTMLElement) =>
  c.querySelector("[data-testid=produto-linha-expandida]") as HTMLElement;
/** A célula (a matriz mobile repete o input, escondida por CSS: vale a 1ª). */
const cel = (c: HTMLElement, num: number, t: string) =>
  expandida(c).querySelector(`input[data-qtd-celula="${num}:${t}"]`) as HTMLInputElement;
const chamadasGrade = () => rpc.mock.calls.filter(([n]) => n === "salvar_grade_revenda");
const botaoSheet = (c: HTMLElement) =>
  expandida(c).querySelector("[data-abrir-sheet-grade]") as HTMLButtonElement | null;
const chevron = (c: HTMLElement, id = "M1") =>
  linhaDe(c, id).querySelector("[data-expandir-grade]") as HTMLButtonElement;

describe("grade da REVENDA editável na lista (PR-GRADE-2)", () => {
  it("com permissão, a matriz tem campo por célula (cor × tamanho) e o Total é derivado (sem campo)", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    expect(expandida(t.container).querySelector("[data-testid=grade-editavel]")).not.toBeNull();
    expect(cel(t.container, 1, "36|PP").value).toBe("6");
    expect(cel(t.container, 1, "38|P").value).toBe("4");
    expect(cel(t.container, 2, "38|P").value).toBe(""); // 0 = em branco (placeholder)
    // 2 cores × 2 colunas = 4 campos na matriz desktop (a mobile repete): nenhum campo no Total
    const linhas = expandida(t.container).querySelectorAll("table tbody tr");
    expect(linhas[0].querySelectorAll("td")[3].querySelector("input")).toBeNull();
    expect(linhas[0].querySelectorAll("td")[3].textContent).toBe("10");
    await t.desmontar();
  });

  it("STAGING: digitar vira rascunho (selo âmbar, célula marcada, Total recalcula) e NADA grava antes do Salvar", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    expect(selos(t.container)).toBe(0);
    await digitar(cel(t.container, 2, "38|P"), "5");
    expect(selos(t.container)).toBe(1); // o pontinho âmbar na linha do produto
    expect(cel(t.container, 2, "38|P").hasAttribute("data-editada")).toBe(true);
    expect(cel(t.container, 1, "36|PP").hasAttribute("data-editada")).toBe(false);
    expect(expandida(t.container).querySelector("[data-testid=grade-nao-salva]")).not.toBeNull();
    expect(
      expandida(t.container).querySelectorAll("table tbody tr")[1].querySelectorAll("td")[3]
        .textContent,
    ).toBe("7"); // 2 + 5
    expect(chamadasGrade()).toHaveLength(0);
    expect(updates).toHaveLength(0);
    // a barra de Salvar da Lista aparece com a contagem
    expect(
      Array.from(document.querySelectorAll("button")).some((b) =>
        /^Salvar \(1\)/.test(b.textContent ?? ""),
      ),
    ).toBe(true);
    await t.desmontar();
  });

  it("SALVAR chama `salvar_grade_revenda` com o estado COMPLETO (inclui o não editado e a linha órfã) e o `rev` lido", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    await digitar(cel(t.container, 2, "38|P"), "5");
    await salvar();
    const chs = chamadasGrade();
    expect(chs).toHaveLength(1);
    const args = chs[0][1] as { _modelo_id: string; _grades: any[]; _rev_base: number };
    expect(args._modelo_id).toBe("M1");
    expect(args._rev_base).toBe(5);
    const porVar = Object.fromEntries(args._grades.map((g) => [g.variante_numero, g]));
    expect(Object.keys(porVar).sort()).toEqual(["1", "2", "9"]); // a órfã (9) NÃO foi apagada
    expect(porVar[1].grades).toEqual({ "36|PP": 6, "38|P": 4 });
    expect(porVar[2].grades).toEqual({ "36|PP": 2, "38|P": 5 });
    expect(porVar[2].grade_total).toBe(7);
    expect(porVar[9].grades).toEqual({ "36|PP": 3 });
    expect(toast.success).toHaveBeenCalled();
    expect(updates).toHaveLength(0); // a grade NÃO passa pelo UPDATE de `modelos` (nem BOM)
    expect(rpc.mock.calls.some(([n]) => /modelo_bom/.test(String(n)))).toBe(false);
    await t.desmontar();
  });

  it("depois de salvar a linha fica limpa (sem selo) e a grade relida é a nova", async () => {
    revenda();
    rpc.mockImplementation(async (nome: string, args: any) => {
      if (nome === "salvar_grade_revenda") {
        estado.extra.modelo_grades = args._grades.map((g: any) => ({ modelo_id: "M1", ...g }));
      }
      return { data: null, error: null };
    });
    const t = await montar();
    await abrir(t.container);
    await digitar(cel(t.container, 2, "38|P"), "5");
    await salvar();
    await flush();
    expect(selos(t.container)).toBe(0);
    expect(cel(t.container, 2, "38|P").value).toBe("5");
    expect(cel(t.container, 2, "38|P").hasAttribute("data-editada")).toBe(false);
    // uma 2ª edição + Salvar parte da grade NOVA (não dá falso conflito)
    await digitar(cel(t.container, 1, "36|PP"), "7");
    await salvar();
    expect(chamadasGrade()).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    await t.desmontar();
  });

  it("Descartar volta ao servidor e libera o recolher", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    await digitar(cel(t.container, 1, "36|PP"), "99");
    expect(chevron(t.container).disabled).toBe(true); // com rascunho NÃO recolhe (a matriz some e perderia o que foi digitado)
    const descartar = Array.from(document.querySelectorAll("button")).find((b) =>
      /Descartar alterações/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    await clicar(descartar);
    await flush();
    // confirmação do Descartar
    const ok = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Descartar",
    ) as HTMLButtonElement;
    await clicar(ok);
    await flush();
    expect(cel(t.container, 1, "36|PP").value).toBe("6");
    expect(chevron(t.container).disabled).toBe(false);
    expect(selos(t.container)).toBe(0);
    await t.desmontar();
  });

  it("P0409 por CONTEÚDO: alguém salvou a grade antes → NÃO grava, recarrega SÓ essa grade e MANTÉM o rascunho", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    await digitar(cel(t.container, 2, "38|P"), "5");
    // outra pessoa salva a grade no meio (a RPC não sobe o `rev`)
    estado.extra.modelo_grades[0].grades = { "36|PP": 60, "38|P": 4 };
    await salvar();
    expect(chamadasGrade()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
    expect(cel(t.container, 2, "38|P").value).toBe("5"); // rascunho mantido
    expect(cel(t.container, 1, "36|PP").value).toBe("60"); // a célula NÃO editada mostra o servidor novo
    expect(expandida(t.container).querySelector("[data-erro-grade]")!.textContent).toContain(
      "Outra pessoa alterou a grade",
    );
    // reconferido: salvar de novo agora passa
    await salvar();
    expect(chamadasGrade()).toHaveLength(1);
    const args = chamadasGrade()[0][1] as { _grades: any[] };
    expect(args._grades.find((g) => g.variante_numero === 1).grades["36|PP"]).toBe(60);
    await t.desmontar();
  });

  it("P0409 por `rev`: o card mudou depois da leitura → não grava, relê e avisa", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    await digitar(cel(t.container, 2, "38|P"), "5");
    estado.modelos[0].rev = 6; // outra pessoa salvou o cabeçalho
    await salvar();
    expect(chamadasGrade()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
    expect(cel(t.container, 2, "38|P").value).toBe("5");
    await salvar(); // já com o rev novo (6)
    expect(chamadasGrade()).toHaveLength(1);
    expect((chamadasGrade()[0][1] as any)._rev_base).toBe(6);
    await t.desmontar();
  });

  it("P0409 devolvido pela RPC também é conflito (aviso na grade, rascunho fica)", async () => {
    revenda();
    rpc.mockImplementation(async (nome: string) =>
      nome === "salvar_grade_revenda"
        ? { data: null, error: { code: "P0409", message: "conflito_versao" } }
        : { data: null, error: null },
    );
    const t = await montar();
    await abrir(t.container);
    await digitar(cel(t.container, 2, "38|P"), "5");
    await salvar();
    expect(expandida(t.container).querySelector("[data-erro-grade]")).not.toBeNull();
    expect(cel(t.container, 2, "38|P").value).toBe("5");
    await t.desmontar();
  });

  it("erro da RPC (ex.: sem permissão no banco) mostra o aviso e não perde o rascunho", async () => {
    revenda();
    rpc.mockImplementation(async (nome: string) =>
      nome === "salvar_grade_revenda"
        ? { data: null, error: { code: "42501", message: "sem permissao" } }
        : { data: null, error: null },
    );
    const t = await montar();
    await abrir(t.container);
    await digitar(cel(t.container, 2, "38|P"), "5");
    await salvar();
    expect(toast.error).toHaveBeenCalled();
    expect(expandida(t.container).querySelector("[data-erro-grade]")).not.toBeNull();
    expect(cel(t.container, 2, "38|P").value).toBe("5");
    await t.desmontar();
  });

  it("o cabeçalho do MESMO produto salvo no mesmo Salvar não vira conflito da grade (o `rev` dele subiu)", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    await digitar(celula(t.container, "Nome de Modelo M1"), "Novo nome");
    await digitar(cel(t.container, 2, "38|P"), "5");
    await salvar();
    expect(updates).toHaveLength(1);
    expect(chamadasGrade()).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    await t.desmontar();
  });
});

describe("trava da grade da REVENDA na lista", () => {
  it("PR-3: enviada à Explosão a REVENDA continua EDITÁVEL (igual ao Sheet): campos na matriz, nota de edição, e o Salvar grava a grade", async () => {
    revenda({ enviado_cad: true });
    const t = await montar();
    await abrir(t.container);
    expect(expandida(t.container).querySelector("[data-testid=grade-editavel]")).not.toBeNull();
    expect(expandida(t.container).querySelector("[data-testid=grade-somente-leitura]")).toBeNull();
    expect(cel(t.container, 1, "36|PP")).not.toBeNull();
    await digitar(cel(t.container, 2, "38|P"), "5");
    expect(chamadasGrade()).toHaveLength(0); // staging: nada grava antes do Salvar
    await salvar();
    const chs = chamadasGrade();
    expect(chs).toHaveLength(1);
    const args = chs[0][1] as { _modelo_id: string; _grades: any[]; _rev_base: number };
    expect(args._modelo_id).toBe("M1");
    expect(args._grades.find((g) => g.variante_numero === 2).grades).toEqual({
      "36|PP": 2,
      "38|P": 5,
    });
    await t.desmontar();
  });

  it("PR-3: enviada à Explosão, quem edita SÓ o Desenvolvimento fica em só-leitura com o motivo da Explosão", async () => {
    revenda({ enviado_cad: true });
    estado.todasPermissoes = false;
    estado.permissoes = new Set(["criacao_desenvolvimento"]);
    const t = await montar();
    await abrir(t.container);
    expect(expandida(t.container).querySelectorAll("input")).toHaveLength(0);
    expect(
      expandida(t.container).querySelector("[data-testid=grade-somente-leitura]")!.textContent,
    ).toContain("enviado à Explosão");
    expect(expandida(t.container).querySelector("[data-qtd]")!.getAttribute("title")).toContain(
      "Explosão",
    );
    await t.desmontar();
  });

  it("sem permissão de editar o Planejamento/Desenvolvimento: só-leitura com o motivo", async () => {
    revenda();
    estado.todasPermissoes = false;
    const t = await montar();
    await abrir(t.container);
    expect(expandida(t.container).querySelectorAll("input")).toHaveLength(0);
    expect(
      expandida(t.container).querySelector("[data-testid=grade-somente-leitura]")!.textContent,
    ).toBe("Sem permissão para editar esta grade.");
    await t.desmontar();
  });

  it("só com a permissão do Planejamento (card não enviado) edita", async () => {
    revenda();
    estado.todasPermissoes = false;
    estado.permissoes = new Set(["criacao_planejamento"]);
    const t = await montar();
    await abrir(t.container);
    expect(cel(t.container, 1, "36|PP")).not.toBeNull();
    await t.desmontar();
  });

  it("tela inteira só-leitura (ReadOnlyScope): sem campo", async () => {
    revenda();
    const t = await montar({}, { somenteLeitura: true });
    await abrir(t.container);
    expect(expandida(t.container).querySelectorAll("input")).toHaveLength(0);
    expect(
      expandida(t.container).querySelector("[data-testid=grade-somente-leitura]"),
    ).not.toBeNull();
    await t.desmontar();
  });
});

describe("INTERNO e IMPORTADO: só-leitura + botão que abre o Sheet na seção da grade", () => {
  it("INTERNO: matriz sem campo + botão → onAbrirNoSheet(id, 'grade')", async () => {
    estado.todasPermissoes = true;
    estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
    estado.extra.modelo_tecidos = [{ id: "t1", modelo_id: "M1", tipo: "tecido", numero: 1 }];
    estado.extra.modelo_tecido_variantes = [
      {
        modelo_tecido_id: "t1",
        ordem: 1,
        variante_tecido_id: "v1",
        variantes_tecido: {
          nome_variante: null,
          codigo_variante: "V1",
          cor: { nome: "Preto", sigla_sku: "PT" },
          apelido: null,
        },
      },
    ];
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { M: 3 }, grade_total: 3 },
    ];
    const onAbrir = vi.fn();
    const t = await montar({ onAbrirNoSheet: onAbrir });
    await abrir(t.container);
    expect(expandida(t.container).querySelectorAll("input")).toHaveLength(0);
    expect(botaoSheet(t.container)!.textContent).toContain("Editar a grade no Sheet");
    await clicar(botaoSheet(t.container));
    expect(onAbrir).toHaveBeenCalledWith("M1", "grade");
    expect(updates).toHaveLength(0);
    expect(chamadasGrade()).toHaveLength(0);
    await t.desmontar();
  });

  it("IMPORTADO: só-leitura (grava pelo BOM) + botão → 'grade_revenda'; NUNCA chama a RPC da revenda", async () => {
    estado.todasPermissoes = true;
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
    const onAbrir = vi.fn();
    const t = await montar({ onAbrirNoSheet: onAbrir });
    await abrir(t.container);
    expect(expandida(t.container).querySelectorAll("input")).toHaveLength(0);
    expect(
      expandida(t.container).querySelector("[data-testid=grade-somente-leitura]")!.textContent,
    ).toContain("grava junto com a ficha");
    await clicar(botaoSheet(t.container));
    expect(onAbrir).toHaveBeenCalledWith("M1", "grade_revenda");
    expect(chamadasGrade()).toHaveLength(0);
    // o `rev` só é lido para a revenda (a única que edita na lista)
    expect(onAbrir).toHaveBeenCalledTimes(1);
    await t.desmontar();
  });

  it("REVENDA também tem o atalho do Sheet (cores e demais dados) na seção 'grade_revenda'", async () => {
    revenda();
    const onAbrir = vi.fn();
    const t = await montar({ onAbrirNoSheet: onAbrir });
    await abrir(t.container);
    await clicar(botaoSheet(t.container));
    expect(onAbrir).toHaveBeenCalledWith("M1", "grade_revenda");
    await t.desmontar();
  });

  it("sem `onAbrirNoSheet` não há botão (a tela-mãe decide)", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    expect(botaoSheet(t.container)).toBeNull();
    await t.desmontar();
  });
});

// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks do banco/DOM nos testes (mesmo padrão do harness da grade) */
// PR-3 (Produto) — COLAR do Excel na `ProdutosGradeAba` de verdade: o bloco só EDITA os modelos que já existem (nada de linha nova),
// vai ao RASCUNHO (nada grava antes do Salvar), respeita a trava por célula e mostra o resumo em toast.
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { colunasNaOrdemDaTela, colunasVisiveis } from "@/lib/produto-grade/colunas";
import {
  celula,
  clicar,
  digitar,
  estado,
  flush,
  linhaDe,
  linhas,
  mod,
  montar,
  resetar,
  salvar,
  selos,
  toast,
  updates,
} from "./produto-grade-harness";

beforeEach(() => resetar());

const tudo = () => true;
const COLS = colunasNaOrdemDaTela(colunasVisiveis(tudo, tudo));
const idx = (k: string) => COLS.findIndex((c) => c.key === k);
/** Uma linha de TSV com os textos nas colunas pedidas, começando em `de`. */
function linhaTsv(de: string, textos: Record<string, string>): string {
  const fim = Math.max(...Object.keys(textos).map(idx));
  return COLS.slice(idx(de), fim + 1)
    .map((c) => textos[c.key] ?? "")
    .join("\t");
}
const NOME = (id: string) => `Nome de Modelo ${id}`;
const integravel = (campos: string[]) => ({
  estado: "integravel",
  campos,
  marcado_em: "2026-11-20T12:00:00Z",
  integrado_em: null,
});

/** Ctrl+V de `texto` com o foco em `el` (o evento sobe até a tabela). */
async function colar(el: Element, texto: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  (ev as any).clipboardData = { getData: (t: string) => (t === "text/plain" ? texto : "") };
  await act(async () => {
    el.dispatchEvent(ev);
  });
  await flush();
  return ev;
}
const valorSelect = (raiz: ParentNode, label: string) =>
  (
    Array.from(raiz.querySelectorAll("[data-select]")).find((d) =>
      d.querySelector(`[aria-label="${label}"]`),
    ) as HTMLElement | undefined
  )?.dataset.value;
const ids = (c: HTMLElement) => linhas(c).map((r) => r.dataset.modeloId);

describe("COLAR na grade do Produto (PR-3)", () => {
  it("bloco 2×2 a partir do Nome de M1: vai ao RASCUNHO (selo âmbar, nada grava) e o Salvar grava só o colado", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    const bloco = [
      linhaTsv("nome", { nome: "Vestido A", descricao_produto: "Desc A" }),
      linhaTsv("nome", { nome: "Vestido B", descricao_produto: "Desc B" }),
    ].join("\r\n");
    const ev = await colar(celula(t.container, NOME("M1")), bloco);
    expect(ev.defaultPrevented).toBe(true);
    expect(celula(t.container, NOME("M1")).value).toBe("Vestido A");
    expect(celula(t.container, "Descrição de Modelo M1").value).toBe("Desc A");
    expect(celula(t.container, NOME("M1")).className).toContain("border-amber-500");
    expect(selos(t.container)).toBe(2);
    expect(updates).toHaveLength(0); // NADA grava antes do Salvar
    expect(toast.success).toHaveBeenCalledWith(
      "Coladas 4 células em 2 produtos · 0 ignoradas",
      undefined,
    );
    await salvar();
    expect(updates).toHaveLength(2);
    expect(updates.find((u) => u.id === "M1")).toMatchObject({
      rev: 1,
      payload: { nome: "Vestido A", descricao_produto: "Desc A" },
    });
    expect(updates.find((u) => u.id === "M2")!.payload).toEqual({
      nome: "Vestido B",
      descricao_produto: "Desc B",
    });
    await t.desmontar();
  });

  it("Produto NÃO cria: linhas além do fim são ignoradas com aviso e a lista continua com 3 produtos", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    const bloco = ["X1", "X2", "X3", "X4"]
      .map((n) => linhaTsv("nome", { nome: n, descricao_produto: `d${n}` }))
      .join("\n");
    await colar(celula(t.container, NOME("M3")), bloco);
    expect(ids(t.container)).toEqual(["M1", "M2", "M3"]);
    expect(celula(t.container, NOME("M3")).value).toBe("X1");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const [texto, opts] = toast.warning.mock.calls[0] as [string, { description: string }];
    expect(texto).toBe("Coladas 2 células em 1 produto · 3 ignoradas");
    expect(opts.description).toContain("3 linhas além do último produto");
    await salvar();
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("M3");
    await t.desmontar();
  });

  it("campo travado pela Integração é ignorado (não grava); o outro produto recebe; resumo conta a ignorada", async () => {
    estado.todasPermissoes = true;
    estado.estadosIntegracao = { M1: integravel(["nome"]) };
    const t = await montar();
    const bloco = ["A", "B"]
      .map((n) => linhaTsv("nome", { nome: `Novo ${n}`, descricao_produto: `d${n}` }))
      .join("\n");
    await colar(celula(t.container, NOME("M1")), bloco);
    expect(celula(t.container, NOME("M1")).value).toBe("Modelo M1"); // travado: ficou
    expect(celula(t.container, "Descrição de Modelo M1").value).toBe("dA"); // não travada: entrou
    expect(celula(t.container, NOME("M2")).value).toBe("Novo B");
    const [texto, opts] = toast.warning.mock.calls[0] as [string, { description: string }];
    expect(texto).toContain("1 ignorada");
    expect(opts.description).toContain("travada pela Integração");
    await salvar();
    const m1 = updates.find((u) => u.id === "M1")!;
    expect(m1.payload).toEqual({ descricao_produto: "dA" }); // o nome travado NUNCA vai
    await t.desmontar();
  });

  it("texto → id por nome (Linha, Estilista, Categoria) e o que não resolve NÃO grava: célula com aviso, que some ao editar", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    const bloco = linhaTsv("peso_kg", {
      peso_kg: "abc",
      linha_id: "casual",
      estilista_id: "Fulana",
      categoria_principal_id: "Vestido",
    });
    await colar(celula(t.container, "Peso (kg) de Modelo M1"), bloco);
    expect(valorSelect(t.container, "Linha de Modelo M1")).toBe("lin1");
    expect(valorSelect(t.container, "Categoria de Modelo M1")).toBe("cat1");
    expect(valorSelect(t.container, "Estilista de Modelo M1")).toBe("");
    const peso = celula(t.container, "Peso (kg) de Modelo M1");
    expect(peso.value).toBe("");
    expect(peso.hasAttribute("data-aviso-colar")).toBe(true);
    expect(peso.getAttribute("title")).toContain("abc");
    const triggerEst = t.container.querySelector(
      'span[aria-label="Estilista de Modelo M1"]',
    ) as HTMLElement;
    expect(triggerEst.getAttribute("title")).toContain("Fulana");
    // editar a célula apaga o aviso
    await digitar(peso, "2");
    expect(celula(t.container, "Peso (kg) de Modelo M1").hasAttribute("data-aviso-colar")).toBe(
      false,
    );
    expect(updates).toHaveLength(0);
    await t.desmontar();
  });

  it("valor simples (sem TAB/quebra) NÃO é interceptado: o colar normal do campo segue", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    const ev = await colar(celula(t.container, NOME("M1")), "so um valor");
    expect(ev.defaultPrevented).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    await t.desmontar();
  });

  it("colar DENTRO da matriz de tamanhos não é interceptado pela tabela", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [mod("M1", { origem: "revenda" }), mod("M2")];
    estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: ["36|PP", "38|P"] }];
    estado.extra.produtos_acabados = [
      {
        modelo_id: "M1",
        id: "pa1",
        grade_proporcao: { "36|PP": 1, "38|P": 1 },
        variantes: [{ ordem: 1, cor: { nome: "Branco" }, apelido: null }],
      },
    ];
    estado.extra.modelo_grades = [];
    const t = await montar();
    await clicar(linhaDe(t.container, "M1").querySelector("[data-expandir-grade]"));
    await flush();
    const entrada = t.container.querySelector('input[data-qtd-celula="1:36|PP"]')!;
    const ev = await colar(entrada, "1\t2\n3\t4");
    expect(ev.defaultPrevented).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(celula(t.container, NOME("M1")).value).toBe("Modelo M1");
    await t.desmontar();
  });

  it("tela só-leitura: o colar não faz nada", async () => {
    estado.todasPermissoes = true;
    const t = await montar({}, { somenteLeitura: true });
    const alvo = t.container.querySelector('td[data-col="nome"]')!;
    const ev = await colar(alvo, "a\tb\nc\td");
    expect(ev.defaultPrevented).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    await t.desmontar();
  });
});

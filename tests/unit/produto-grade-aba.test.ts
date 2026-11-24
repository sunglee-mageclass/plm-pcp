// @vitest-environment happy-dom
// Grade "Lista" do Planejamento de Produto: render de verdade da `ProdutosGradeAba` + `useProdutosGrade` com `supabase` mockado (harness).
// Prova (PR-1, mantido na PR-2): 1 linha por MODELO (contagem), query com `rev` e SEM `ref_auto`/custo, paginação (>1.000), erro HONESTO
// (C3), queryKey única que reaproveita as invalidações de ["modelos-planejamento"], colunas visíveis por permissão e a ordem da tela.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { chamadas, estado, flush, mod, montar, preparar, resetar } from "./produto-grade-harness";

beforeEach(() => resetar());

/** Colunas desenhadas no cabeçalho (sem a 1ª, que é o "Estado" da linha). */
const colunasNaTabela = (c: HTMLElement) => c.querySelectorAll("thead th").length - 1;

describe("ProdutosGradeAba (leitura: contagem, colunas, ordem)", () => {
  it("mostra a contagem de PRODUTOS (1 por modelo) e a TABELA (1 linha por modelo)", async () => {
    const t = await montar();
    const txt = t.container.textContent ?? "";
    expect(t.container.querySelector("[data-testid=produtos-grade-aba]")).not.toBeNull();
    expect(txt).toMatch(/3\s*produtos/);
    expect(t.container.querySelector("[data-testid=produtos-grade-tabela]")).not.toBeNull();
    expect(t.container.querySelectorAll("tbody tr")).toHaveLength(3);
    await t.desmontar();
  });

  it("singular com 1 produto", async () => {
    estado.modelos = [mod("M1")];
    const t = await montar();
    expect(t.container.textContent).toMatch(/(?<![\d.])1\s*produto(?!s)/);
    await t.desmontar();
  });

  it("a prop `modelos` restringe os produtos mostrados (filtro da tela)", async () => {
    const t = await montar({ modelos: [{ id: "M2" }] });
    expect(t.container.textContent).toMatch(/(?<![\d.])1\s*produto(?!s)/);
    await t.desmontar();
  });

  it("produto da tela que a consulta ainda não trouxe NÃO vira linha (nunca inventa)", async () => {
    const t = await montar({ modelos: [{ id: "M1" }, { id: "RECEM-CRIADO" }] });
    expect(t.container.textContent).toMatch(/(?<![\d.])1\s*produto(?!s)/);
    await t.desmontar();
  });

  it("avisa a tela-mãe que não há rascunho (onDirtyChange(false)) e não monta a tabela no celular", async () => {
    const onDirtyChange = vi.fn();
    const t = await montar({ onDirtyChange, isMobile: true });
    expect(onDirtyChange).toHaveBeenCalledWith(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    expect(t.container.querySelector("[data-testid=produtos-grade-tabela]")).toBeNull();
    await t.desmontar();
  });

  it("colunas visíveis seguem a PERMISSÃO (sem seção: 4 colunas de preço/custo somem; com tudo: todas)", async () => {
    const { COLUNAS_PRODUTO } = await import("@/lib/produto-grade/colunas");
    const t1 = await montar();
    const semPermissao = colunasNaTabela(t1.container);
    await t1.desmontar();

    estado.todasPermissoes = true;
    const t2 = await montar();
    const comTudo = colunasNaTabela(t2.container);
    await t2.desmontar();

    expect(comTudo).toBe(COLUNAS_PRODUTO.length);
    expect(semPermissao).toBe(COLUNAS_PRODUTO.length - 4);
  });
});

describe("C3 — erro honesto", () => {
  it("leitura dos modelos que falha mostra aviso + 'Tentar de novo' e NUNCA '0 produtos'", async () => {
    estado.falhaTabela = "modelos";
    const t = await montar();
    const txt = t.container.textContent ?? "";
    expect(t.container.querySelector("[role=alert]")).not.toBeNull();
    expect(txt).toContain("Não foi possível carregar a lista de produtos.");
    expect(txt).toContain("Tentar de novo");
    expect(txt).not.toMatch(/0\s*produtos/);
    expect(t.container.querySelector("[data-testid=produtos-grade-tabela]")).toBeNull();
    await t.desmontar();
  });

  it("opção que o hook controla (subcategorias) e falha também vira erro — não cai em lista vazia calada", async () => {
    estado.falhaTabela = "subcategorias1_produto";
    const t = await montar();
    expect(t.container.querySelector("[role=alert]")).not.toBeNull();
    expect(t.container.textContent).not.toMatch(/\d+\s*produtos/);
    await t.desmontar();
  });

  it("com OTB ligado, coleção que falha também vira erro (a da tela engole; a da grade não)", async () => {
    estado.otb = true;
    estado.falhaTabela = "colecoes";
    const t = await montar();
    expect(t.container.querySelector("[role=alert]")).not.toBeNull();
    await t.desmontar();
  });
});

describe("useProdutosGrade — consulta de `modelos`", () => {
  it("traz `rev` e as colunas que o card não traz; NUNCA `ref_auto` nem custo; sem filtro de loja no cliente", async () => {
    const t = await montar();
    const q = chamadas.find((c) => c.tabela === "modelos")!;
    expect(q).toBeDefined();
    const campos = q.select!.split(",").map((s) => s.trim());
    for (const k of [
      "id",
      "rev",
      "subcategoria2_id",
      "ncm",
      "titulo_pagina",
      "peso_kg",
      "comprimento_cm",
      "largura_cm",
      "altura_cm",
      "preco_venda",
      "preco_anterior",
      "preco_atacado",
      "tamanho_tipo",
      "descricao_produto",
      "enviado_cad",
      "colecoes(nome)",
      "categoria_principal_id",
      "subcategoria1_id",
      "status_planejamento",
      "observacoes_gerais",
      "observacoes_mao_obra",
    ]) {
      expect(campos, k).toContain(k);
    }
    expect(campos).not.toContain("ref_auto");
    expect(campos.filter((c) => c.startsWith("custo"))).toEqual([]);
    expect(q.eqs).toEqual({}); // a loja vem da RLS
    await t.desmontar();
  });

  it("PAGINA: 2.500 modelos chegam todos (PostgREST corta em 1.000) — e nada 'some' calado", async () => {
    estado.modelos = Array.from({ length: 2500 }, (_, i) => mod(`M${i}`));
    const t = await montar();
    expect(t.container.textContent).toMatch(/2500\s*produtos|2\.500\s*produtos/);
    const paginas = chamadas.filter((c) => c.tabela === "modelos").length;
    expect(paginas).toBe(3);
    await t.desmontar();
  });

  it("queryKey ÚNICA com o prefixo de invalidação do card (Realtime/salvar refrescam a grade) sem colidir com a chave curta", async () => {
    const t = await montar();
    const keys = t.qc
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    const daGrade = keys.find((k) => k[0] === "modelos-planejamento");
    expect(daGrade).toEqual(["modelos-planejamento", "grade"]);
    // a chave EXATA do card (["modelos-planejamento"]) não é tocada: o cache da tela não recebe o shape da grade
    expect(t.qc.getQueryData(["modelos-planejamento"])).toBeUndefined();
    // invalidar o prefixo (como o resto do app faz) marca a grade como desatualizada
    await act(async () => {
      await t.qc.invalidateQueries({ queryKey: ["modelos-planejamento"], refetchType: "none" });
    });
    expect(t.qc.getQueryState(["modelos-planejamento", "grade"])?.isInvalidated).toBe(true);
    // demais chaves próprias: prefixo "produtos-grade" (únicas) ou as MESMAS chaves compartilhadas da tela/Sheet
    const proprios = new Set([
      "modelos-planejamento",
      "produtos-grade",
      "opt",
      "colab-estilistas",
      "artigos-planejamento",
      "integracao-estado",
      "tenant_config", // fuso da loja (selo "Integrável em dd/mm — travado")
    ]);
    for (const k of keys)
      expect(proprios.has(String(k[0])), `queryKey inesperada: ${JSON.stringify(k)}`).toBe(true);
    await t.desmontar();
  });

  it("módulo OTB desligado não consulta coleções/subcoleções; ligado consulta", async () => {
    const t1 = await montar();
    expect(chamadas.map((c) => c.tabela)).not.toContain("colecoes");
    expect(chamadas.map((c) => c.tabela)).not.toContain("colecao_subcolecoes");
    await t1.desmontar();

    chamadas.length = 0;
    estado.otb = true;
    const t2 = await montar();
    expect(chamadas.map((c) => c.tabela)).toContain("colecoes");
    expect(chamadas.map((c) => c.tabela)).toContain("colecao_subcolecoes");
    await t2.desmontar();
  });
});

describe("useProdutosGrade — dados e opções", () => {
  async function rodarHook() {
    preparar();
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { useProdutosGrade } = await import("@/components/planejamento/grade/useProdutosGrade");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let ultimo: ReturnType<typeof useProdutosGrade> | null = null;
    function Sonda() {
      ultimo = useProdutosGrade();
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda)));
    });
    await flush();
    return { get: () => ultimo!, desmontar: () => act(async () => root.unmount()) };
  }

  it("coleção: guarda o texto CRU e entrega o rótulo (nome do OTB, senão o texto) separado; o embed não segue adiante", async () => {
    estado.modelos = [
      mod("A", { colecao: "texto", colecao_id: "col1", colecoes: { nome: "Verão 27" } }),
      mod("B", { colecao: "  só texto  ", colecoes: null }),
      mod("C", { colecao: null, colecoes: null }),
    ];
    const h = await rodarHook();
    const [a, b, c] = h.get().modelos;
    expect(a.colecao).toBe("texto");
    expect(a.colecao_rotulo).toBe("Verão 27");
    expect(b.colecao_rotulo).toBe("só texto");
    expect(c.colecao_rotulo).toBeNull();
    expect("colecoes" in a).toBe(false);
    await h.desmontar();
  });

  it("entrega modelos, opções (taxonomia + coleção/subcoleção do OTB) e as permissões/estado da Integração", async () => {
    estado.otb = true;
    estado.estadosIntegracao = {
      M1: { estado: "integravel", campos: ["nome"], marcado_em: null, integrado_em: null },
    };
    const h = await rodarHook();
    const d = h.get();
    expect(d.isLoading).toBe(false);
    expect(d.isError).toBe(false);
    expect(d.modelos.map((m) => m.id)).toEqual(["M1", "M2", "M3"]);
    expect(d.opcoes.categorias.map((c) => c.id)).toEqual(["cat1", "cat2", "cat3"]);
    expect(d.opcoes.categorias[0]).toEqual({ id: "cat1", nome: "Vestido", grupo_id: "g1" });
    expect(d.opcoes.subcategorias1.map((s) => s.id)).toEqual(["s1", "s1b"]);
    expect(d.opcoes.subcategorias2.map((s) => s.id)).toEqual(["s2"]);
    expect(d.opcoes.colecoes).toEqual([
      { id: "col1", nome: "Verão 27", mes_id: "mes1", ano_id: "ano1" },
    ]);
    expect(d.opcoes.subcolecoesPorColecao.get("col1")).toEqual(["Sub A"]);
    expect(d.opcoes.semanas.map((s) => s.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(d.opcoes.tamanhoTipos.map((s) => s.id)).toEqual(["letra", "numero"]);
    expect(d.otbOn).toBe(true);
    expect(d.estadosIntegracao.M1?.estado).toBe("integravel");
    expect(typeof d.canView).toBe("function");
    expect(typeof d.canEdit).toBe("function");
    await h.desmontar();
  });
});

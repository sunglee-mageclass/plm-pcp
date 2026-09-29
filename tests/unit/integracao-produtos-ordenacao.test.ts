// Integração — ordenação da tabela de Produtos (owner: "senti falta de ordenar por título; todos deveriam ter
// uma ordenação" — o pedido citava "título" no sentido coloquial de "o nome do produto"; a coluna Nome, key
// `"nome"`/rótulo "Nome", é a que o owner queria ordenável, e É a testada abaixo. A tabela TEM uma coluna própria
// chamada "Título" (key `"titulo"`, rótulo "Título para a página" — `modelos.titulo_pagina`), uma coisa
// DIFERENTE (o <title> da página no site) — os testes abaixo clicam no cabeçalho "Nome", nunca no "Título";
// review 685544fa (LOW) apontou a prosa antiga confundindo os dois. Cobre: (1) a camada pura em produtos.ts
// (`acessorOrdenacao`/`acessorEstado`) usada pelos accessors do `useSort` em ProdutosTabela.tsx — número-vs-texto,
// vazio por último, campo soVariante lido pela 1ª variante; (2) o RENDER de verdade de `ProdutosTabela`
// (react-dom/client + happy-dom, mesmo padrão de integracao-celula.test.ts) provando que clicar no cabeçalho Nome
// ordena os PRODUTOS mantendo cada sublinha de variante presa embaixo do produto dela, e que uma edição em
// rascunho (staging, ainda não salva) NÃO reordena a tabela — a ordenação lê o valor SALVO/servidor
// (`acessorOrdenacao` usa `fonteExibida`/`p.raw`, nunca `r.valores`).
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CAMPO_BY_KEY } from "@/lib/integracao/campos";
import {
  acessorEstado, acessorOrdenacao, lerLista, SORT_KEY_ESTADO, type ProdutoLista,
} from "@/lib/integracao/produtos";
import { editar, novoRascunho, type Rascunho } from "@/lib/integracao/rascunho";
import { ProdutosTabela } from "@/components/integracao/ProdutosTabela";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const gate = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
const G = {
  modulo_bloqueado: false,
  compartilhado: gate(true), planejamento: gate(true), preco: gate(true), ref: gate(true), sku: gate(true), keywords: gate(true),
};
const linhaProduto = (valores: Record<string, string | null>, fotos: string[] = []) => ({
  tipo: "produto", ordem: 0, valores, fotos,
});
const linhaVariante = (varianteKey: string, tamanhoKey: string, valores: Record<string, string | null> = {}) => ({
  tipo: "variante", ordem: 1, variante_key: varianteKey, tamanho_key: tamanhoKey, valores, fotos: [],
});
/** Fixture de 1 produto cru (shape de `integracao_listar`) — `raw`/`vivo` são o valor SALVO; sem `retrato`
 *  (estado "nao_integravel" por padrão), então `fonteExibida` sempre lê o VIVO, nunca staging. */
function produtoCru(o: {
  id: string; nome: string; ref?: string | null; precoVenda?: number | null; pesoKg?: number | null;
  fotos?: string[]; estado?: "nao_integravel" | "integravel" | "integrado"; completo?: boolean;
  sublinhas?: { varianteKey: string; tamanhoKey: string; corNome?: string | null; corBase?: string | null }[];
}) {
  const sub = o.sublinhas ?? [];
  return {
    modelo_id: o.id, origem: "interno", colecao: null, etapa: null, estado: o.estado ?? "nao_integravel",
    marcado_em: null, integrado_em: o.estado === "integrado" ? "2026-09-01T12:00:00Z" : null, rev: 1,
    raw: {
      nome: o.nome, ref: o.ref ?? null, preco_anterior: null, preco_venda: o.precoVenda ?? null,
      peso_kg: o.pesoKg ?? null, ncm: null, titulo_pagina: null, descricao_produto: null,
      comprimento_cm: null, largura_cm: null, altura_cm: null, fotos_modelo: o.fotos ?? [], tamanho_tipo: "letra",
    },
    vivo: {
      v: 1,
      campos: ["nome", "ref_sku", "preco_venda", "peso", "foto", "cor_base"],
      linhas: [
        linhaProduto({ nome: o.nome, ref_sku: o.ref ?? null, preco_venda: o.precoVenda != null ? String(o.precoVenda) : null, peso: o.pesoKg != null ? String(o.pesoKg) : null }, o.fotos ?? []),
        // cor_base SÓ existe na linha de VARIANTE (é soVariante — nunca aparece na linha do produto) — o teste
        // positivo do accessor (LOW, review 685544fa) depende de valores["cor_base"] estar aqui de verdade.
        ...sub.map((s) => linhaVariante(s.varianteKey, s.tamanhoKey, {
          nome: `${o.nome} ${s.corNome ?? ""}`.trim(), cor_base: s.corBase ?? null,
        })),
      ],
    },
    faltas: [], completo: o.completo ?? true,
    sublinhas: sub.map((s, i) => ({
      variante_key: s.varianteKey, tamanho_key: s.tamanhoKey, variante_ordem: i + 1, tamanho_ordem: 1,
      cor_nome: s.corNome ?? null, apelido_nome: null, tamanho: "P", sku_id: null, sku: null, sku_rev: null, manual: false,
    })),
    retrato: null, retrato_difere: [], gates: G,
  };
}
function lista(produtos: unknown[]) {
  return lerLista({
    pagina: 1, por_pagina: 50, total: produtos.length,
    contagens: { nao_integrados: produtos.length, integrados: 0, todos: produtos.length },
    campos: ["nome", "ref_sku", "preco_venda", "peso"],
    opcoes: { colecoes: [], etapas: [] },
    pode: { editar: true, ver_custos: true, super: false, keywords: true },
    keywords: null, produtos,
  });
}

describe("acessorOrdenacao/acessorEstado (produtos.ts) — a camada pura por trás do useSort da tabela", () => {
  it("campo texto (nome): lê o valor SALVO da linha do produto, não o rascunho", () => {
    const p = lista([produtoCru({ id: "m1", nome: "Blusa Brisa" })]).produtos[0];
    const acc = acessorOrdenacao(CAMPO_BY_KEY.get("nome")!);
    expect(acc(p)).toBe("Blusa Brisa");
  });
  it("campo dinheiro/medida devolve NÚMERO cru (nunca o texto formatado 'R$ 179,90') — useSort decide numérico sozinho", () => {
    const p = lista([produtoCru({ id: "m1", nome: "X", precoVenda: 179.9, pesoKg: 0.22 })]).produtos[0];
    expect(acessorOrdenacao(CAMPO_BY_KEY.get("preco_venda")!)(p)).toBe(179.9);
    expect(acessorOrdenacao(CAMPO_BY_KEY.get("peso")!)(p)).toBe(0.22);
  });
  it("valor ausente = null (useSort já joga null pro fim — 'vazio sempre por último')", () => {
    const p = lista([produtoCru({ id: "m1", nome: "X" })]).produtos[0];
    expect(acessorOrdenacao(CAMPO_BY_KEY.get("preco_venda")!)(p)).toBeNull();
    expect(acessorOrdenacao(CAMPO_BY_KEY.get("ref_sku")!)(p)).toBeNull();
  });
  it("campo soVariante (cor_base) sem sublinha nenhuma = null", () => {
    const semVariante = lista([produtoCru({ id: "m1", nome: "X" })]).produtos[0];
    expect(acessorOrdenacao(CAMPO_BY_KEY.get("cor_base")!)(semVariante)).toBeNull();
  });
  // LOW (review 685544fa): a asserção acima só provava o caso NULO (sem sublinha) — nunca confirmava de verdade
  // que "lê a PRIMEIRA variante" funciona quando HÁ sublinhas. Positivo: 2 variantes, a 1ª (ordem 1, "Azul") tem
  // que vencer — a 2ª ("Verde") nunca aparece no valor do accessor pro produto.
  it("campo soVariante (cor_base) COM sublinhas lê a PRIMEIRA variante (nunca a 2ª)", () => {
    const p = lista([produtoCru({
      id: "m1", nome: "X",
      sublinhas: [
        { varianteKey: "v1", tamanhoKey: "P", corBase: "Azul" },
        { varianteKey: "v2", tamanhoKey: "M", corBase: "Verde" },
      ],
    })]).produtos[0];
    expect(acessorOrdenacao(CAMPO_BY_KEY.get("cor_base")!)(p)).toBe("Azul");
  });
  // completo/moduloBloqueado/reprovado (MEDIUM-1, review 685544fa) — `acessorEstado` exige os 4 campos agora
  // (nivelDoProduto/podeIntegrarAgora); os 2 exemplos abaixo passam o objeto COMPLETO, nunca só `{estado}`.
  it("acessorEstado ordena pelo funil: faltam dados < completo < integrável < integrado", () => {
    const faltam = { estado: "nao_integravel" as const, completo: false, moduloBloqueado: false, reprovado: false };
    const completo = { estado: "nao_integravel" as const, completo: true, moduloBloqueado: false, reprovado: false };
    const integravel = { estado: "integravel" as const, completo: false, moduloBloqueado: false, reprovado: false };
    const integrado = { estado: "integrado" as const, completo: false, moduloBloqueado: false, reprovado: false };
    expect(acessorEstado(faltam)).toBeLessThan(acessorEstado(completo));
    expect(acessorEstado(completo)).toBeLessThan(acessorEstado(integravel));
    expect(acessorEstado(integravel)).toBeLessThan(acessorEstado(integrado));
  });
  it("SORT_KEY_ESTADO é a chave 'estado' (usada como sortKey do cabeçalho Estado)", () => {
    expect(SORT_KEY_ESTADO).toBe("estado");
  });
});

describe("ProdutosTabela — clicar no cabeçalho Nome ordena PRODUTOS e mantém sublinhas presas (render de verdade)", () => {
  function montar(produtosCrus: unknown[]) {
    const l = lista(produtosCrus);
    const rascunhos = new Map<string, Rascunho>();
    const rascunhoDe = (p: ProdutoLista) => rascunhos.get(p.modeloId) ?? novoRascunho(p);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const arvore = () =>
      createElement(ProdutosTabela, {
        lista: l, rascunhoDe, previas: {}, salvando: false,
        onAtualizar: (p: ProdutoLista, f: (r: Rascunho) => Rascunho) => rascunhos.set(p.modeloId, f(rascunhoDe(p))),
        onKeywords: () => {}, onFotos: () => {},
        estadoCelula: () => createElement("span", null, "estado"),
      });
    return {
      container,
      montar: () => act(() => { root.render(arvore()); }),
      // Uma linha por <tr>, na ordem em que aparecem no <tbody>. A célula "Nome" é um <input value="...">, cujo
      // texto NÃO entra em `textContent` — por isso a identidade de cada linha vem do `aria-label` do botão de
      // abrir/fechar sublinhas ("Abrir/Fechar sublinhas de <nome>", sempre presente na linha do PRODUTO) e, pra
      // sublinha (sem esse botão), do texto literal "sublinha" que a própria tabela renderiza na célula.
      textoLinhas: () => Array.from(container.querySelectorAll("tbody tr")).map((tr) => {
        const seta = tr.querySelector("button[aria-expanded]");
        if (seta) return seta.getAttribute("aria-label") ?? "";
        return tr.textContent ?? ""; // linha de sublinha: sem seta, "sublinha" aparece como texto puro na célula
      }),
      clicarCabecalho: (rotulo: string) => {
        const th = Array.from(container.querySelectorAll("thead button")).find((b) => b.textContent?.includes(rotulo)) as HTMLButtonElement;
        act(() => { th.click(); });
      },
      desmontar: () => act(() => { root.unmount(); container.remove(); }),
    };
  }

  it("asc/desc por Nome mantém cada sublinha de variante junto do SEU produto", async () => {
    // "Abrir" as sublinhas exige clicar na seta — mas a checagem de agrupamento não depende disso: mesmo com as
    // sublinhas fechadas, o array `sorted` já reordenou os PRODUTOS (as sublinhas de cada `LinhaProduto` seguem o
    // MESMO produto quando abertas). Aqui abrimos as sublinhas de todos antes de ordenar, pra provar que elas
    // continuam atreladas ao produto certo depois do clique de ordenação.
    const view = montar([
      produtoCru({ id: "m-zebra", nome: "Zebra", sublinhas: [{ varianteKey: "v1", tamanhoKey: "P", corNome: "Preta" }] }),
      produtoCru({ id: "m-abacate", nome: "Abacate", sublinhas: [{ varianteKey: "v2", tamanhoKey: "M", corNome: "Verde" }] }),
      produtoCru({ id: "m-melancia", nome: "Melancia" }),
    ]);
    await view.montar();
    // Abre as sublinhas de Zebra e Abacate clicando na seta (2ª coluna) de cada linha do produto.
    const abrirSublinhas = () => {
      const setas = Array.from(view.container.querySelectorAll("tbody button")).filter((b) => b.getAttribute("aria-expanded") !== null);
      for (const s of setas) (s as HTMLButtonElement).click();
    };
    await act(() => abrirSublinhas());
    // Ordem original (a que o servidor devolveu — default, ninguém clicou ainda): 3 produtos + 2 sublinhas abertas.
    expect(view.textoLinhas().length).toBe(5);
    view.clicarCabecalho("Nome");
    await view.montar();
    let linhas = view.textoLinhas();
    // asc: Abacate, Melancia, Zebra — e a sublinha "Verde" (do Abacate) vem IMEDIATAMENTE depois da linha do
    // Abacate, nunca solta ou junto de outro produto. Só a linha do PRODUTO tem o botão "Abrir/Fechar sublinhas
    // de …" — usa isso (não `.includes("sublinha")`, que dá falso positivo em "Fechar SUBLINHAS de Zebra").
    const ehLinhaDoProduto = (t: string) => /^(Abrir|Fechar) sublinhas de /.test(t);
    const idxAbacate = linhas.findIndex((t) => ehLinhaDoProduto(t) && t.includes("Abacate"));
    const idxMelancia = linhas.findIndex((t) => ehLinhaDoProduto(t) && t.includes("Melancia"));
    const idxZebra = linhas.findIndex((t) => ehLinhaDoProduto(t) && t.includes("Zebra"));
    expect(idxAbacate).toBeLessThan(idxMelancia);
    expect(idxMelancia).toBeLessThan(idxZebra);
    expect(ehLinhaDoProduto(linhas[idxAbacate + 1])).toBe(false); // a sublinha "Verde" logo após o produto Abacate
    expect(linhas[idxAbacate + 1]).not.toContain("Zebra");
    view.clicarCabecalho("Nome");
    await view.montar();
    linhas = view.textoLinhas();
    // desc: Zebra, Melancia, Abacate — a sublinha "Preta" do Zebra continua logo depois dele.
    const idxZebra2 = linhas.findIndex((t) => ehLinhaDoProduto(t) && t.includes("Zebra"));
    expect(idxZebra2).toBe(0);
    expect(ehLinhaDoProduto(linhas[idxZebra2 + 1])).toBe(false);
    await view.desmontar();
  });

  it("coluna numérica (Preço de venda) ordena por NÚMERO, não por texto (10 > 9, nunca '10' < '9' como string)", async () => {
    const view = montar([
      produtoCru({ id: "m1", nome: "A", precoVenda: 9 }),
      produtoCru({ id: "m2", nome: "B", precoVenda: 10 }),
      produtoCru({ id: "m3", nome: "C", precoVenda: 2 }),
    ]);
    await view.montar();
    view.clicarCabecalho("Preço de venda");
    await view.montar();
    const ordem = view.textoLinhas().map((t) => (t.match(/de\s+([ABC])$/)?.[1] ?? "?"));
    expect(ordem).toEqual(["C", "A", "B"]); // 2, 9, 10 numérico — nunca "10" antes de "2" por ordem de string
    await view.desmontar();
  });

  it("vazio sempre por último, nos dois sentidos (asc e desc)", async () => {
    const view = montar([
      produtoCru({ id: "m1", nome: "Com preço", precoVenda: 50 }),
      produtoCru({ id: "m2", nome: "Sem preço" }), // preco_venda ausente
      produtoCru({ id: "m3", nome: "Outro com preço", precoVenda: 10 }),
    ]);
    await view.montar();
    view.clicarCabecalho("Preço de venda");
    await view.montar();
    let linhas = view.textoLinhas();
    expect(linhas[linhas.length - 1]).toContain("Sem preço"); // asc: vazio no fim
    view.clicarCabecalho("Preço de venda");
    await view.montar();
    linhas = view.textoLinhas();
    expect(linhas[linhas.length - 1]).toContain("Sem preço"); // desc: vazio continua no fim
    await view.desmontar();
  });

  it("uma edição em rascunho (staging, ainda não salva) NÃO reordena a tabela — ordena pelo valor SALVO", async () => {
    const l = lista([
      produtoCru({ id: "m1", nome: "Abacate" }),
      produtoCru({ id: "m2", nome: "Melancia" }),
      produtoCru({ id: "m3", nome: "Zebra" }),
    ]);
    const rascunhos = new Map<string, Rascunho>();
    const rascunhoDe = (p: ProdutoLista) => rascunhos.get(p.modeloId) ?? novoRascunho(p);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const arvore = () =>
      createElement(ProdutosTabela, {
        lista: l, rascunhoDe, previas: {}, salvando: false,
        onAtualizar: (p: ProdutoLista, f: (r: Rascunho) => Rascunho) => { rascunhos.set(p.modeloId, f(rascunhoDe(p))); },
        onKeywords: () => {}, onFotos: () => {},
        estadoCelula: () => createElement("span", null, "estado"),
      });
    await act(() => { root.render(arvore()); });
    // Ordena asc por Nome primeiro — Abacate, Melancia, Zebra.
    const clicar = (rotulo: string) => {
      const th = Array.from(container.querySelectorAll("thead button")).find((b) => b.textContent?.includes(rotulo)) as HTMLButtonElement;
      act(() => { th.click(); });
    };
    clicar("Nome");
    await act(() => { root.render(arvore()); });
    // Mesma técnica de `textoLinhas` acima: a célula Nome é um <input>, então a identidade da linha vem do
    // `aria-label` do botão de abrir sublinhas ("Abrir sublinhas de <nome>").
    const textoLinhas = () => Array.from(container.querySelectorAll("tbody tr")).map(
      (tr) => tr.querySelector("button[aria-expanded]")?.getAttribute("aria-label") ?? tr.textContent ?? "",
    );
    const antes = textoLinhas();
    expect(antes[0]).toContain("Abacate");
    // Edita o RASCUNHO de "Zebra" (ainda staging — só o Salvar gravaria) para um nome que, se a tabela ordenasse
    // pelo rascunho, viraria "Aardvark" e pularia para o TOPO. A ordenação tem que continuar lendo o SALVO — "Zebra"
    // continua na mesma posição (fim), provando que o accessor nunca olha `r.valores.nome`.
    const pZebra = l.produtos.find((p) => p.raw.nome === "Zebra")!;
    rascunhos.set(pZebra.modeloId, editar(rascunhoDe(pZebra), "nome", "Aardvark"));
    await act(() => { root.render(arvore()); });
    const depois = textoLinhas();
    expect(depois[0]).toContain("Abacate"); // não pulou pro topo por causa do rascunho
    expect(depois[depois.length - 1]).toContain("Zebra"); // segue no fim (posição do valor SALVO "Zebra")
    await act(() => { root.unmount(); container.remove(); });
  });
});

// LOW (review 685544fa): faltava um teste de RENDER que clicasse no cabeçalho "Estado" de verdade — só a função
// pura `acessorEstado` tinha cobertura (describe acima). Aqui o clique de verdade no <th> "Estado" ordena as
// linhas pela mesma ordem do funil (faltam dados < completo < integrável < integrado).
describe("ProdutosTabela — clicar no cabeçalho Estado ordena pelo funil (render de verdade)", () => {
  it("asc: faltam dados, completo, integrável, integrado", async () => {
    const l = lista([
      produtoCru({ id: "m-integrado", nome: "Delta", estado: "integrado" }),
      produtoCru({ id: "m-faltam", nome: "Alfa", estado: "nao_integravel", completo: false }),
      produtoCru({ id: "m-integravel", nome: "Charlie", estado: "integravel" }),
      produtoCru({ id: "m-completo", nome: "Bravo", estado: "nao_integravel", completo: true }),
    ]);
    const rascunhos = new Map<string, Rascunho>();
    const rascunhoDe = (p: ProdutoLista) => rascunhos.get(p.modeloId) ?? novoRascunho(p);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const arvore = () =>
      createElement(ProdutosTabela, {
        lista: l, rascunhoDe, previas: {}, salvando: false,
        onAtualizar: (p: ProdutoLista, f: (r: Rascunho) => Rascunho) => rascunhos.set(p.modeloId, f(rascunhoDe(p))),
        onKeywords: () => {}, onFotos: () => {},
        estadoCelula: () => createElement("span", null, "estado"),
      });
    await act(() => { root.render(arvore()); });
    const th = Array.from(container.querySelectorAll("thead button")).find((b) => b.textContent?.includes("Estado")) as HTMLButtonElement;
    expect(th, "cabeçalho Estado precisa existir e ser clicável").toBeDefined();
    await act(() => { th.click(); });
    const linhas = Array.from(container.querySelectorAll("tbody tr")).map(
      (tr) => tr.querySelector("button[aria-expanded]")?.getAttribute("aria-label") ?? "",
    );
    // Cada linha carrega o NOME no aria-label — a ordem esperada por Estado é Alfa(faltam)/Bravo(completo)/
    // Charlie(integrável)/Delta(integrado), independente da ordem alfabética do nome.
    expect(linhas.map((l2) => l2.replace(/^(Abrir|Fechar) sublinhas de /, "")))
      .toEqual(["Alfa", "Bravo", "Charlie", "Delta"]);
    await act(() => { root.unmount(); container.remove(); });
  });
});

// @vitest-environment happy-dom

// Grade "Lista tipo Excel" do Planejamento de Produto (PR-2): render de verdade da `ProdutosGradeAba` (tabela PLANA, 1 linha por modelo)
// com `supabase` mockado (CAS por `rev` em memória). Prova: coluna de preço some sem permissão; célula travada pela Integração fica
// DESABILITADA + selo; enquanto o estado da Integração não chega as colunas traváveis ficam bloqueadas (nunca livres); status/REF
// só-leitura; "Tamanho em" N/A em Acessórios; editar só mexe no rascunho (nada grava antes do Salvar); UM Salvar = 1 UPDATE por modelo
// tocado, só com o editado, com `.eq("rev")`; P0409 marca SÓ aquela linha (as outras salvam) e re-baseliza o rev; resultado parcial;
// campo travado não vai; vazio de Título/Preço anterior = NULL; categoria cascateia; OTB; ordenação; teclado; guarda (onDirtyChange).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import {
  botaoSalvar,
  celula,
  clicar,
  digitar,
  escolher,
  estado,
  flush,
  linhaDe,
  linhas,
  mod,
  montar,
  porLabel,
  resetar,
  salvar,
  selos,
  textoDe,
  toast,
  updates,
} from "./produto-grade-harness";

beforeEach(() => resetar());

const colunas = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
const integravel = (campos: string[]) => ({
  estado: "integravel",
  campos,
  marcado_em: "2026-11-20T12:00:00Z",
  integrado_em: null,
});
const NOME = (id: string) => `Nome de Modelo ${id}`;
const ids = (c: HTMLElement) => linhas(c).map((r) => r.dataset.modeloId);

describe("estrutura: tabela PLANA, 1 linha por modelo, Nome fixo", () => {
  it("1 linha por modelo, sem pai/filhos/chevron; Nome é a 1ª coluna e fica fixa (sticky)", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    expect(ids(t.container)).toEqual(["M1", "M2", "M3"]);
    expect(
      t.container.querySelector(
        "[data-pai], [data-acao='alternar-cores'], tbody[data-grupo-artigo]",
      ),
    ).toBeNull();
    expect(colunas(t.container)[1]).toBe("Nome"); // [0] = estado da linha
    const celNome = linhaDe(t.container, "M1").querySelector('td[data-col="nome"]')!;
    expect(celNome.className).toContain("sticky");
    expect(t.container.querySelector('[data-testid="produtos-grade-tabela"]')!.className).toContain(
      "scroll-x-visivel",
    );
    await t.desmontar();
  });

  it("a coluna de PREÇO some sem a permissão da seção; com ela (ou tudo) aparece", async () => {
    estado.permissoes = new Set(["criacao_planejamento"]);
    const t1 = await montar();
    const sem = colunas(t1.container);
    for (const rotulo of [
      "Preço de venda",
      "Preço anterior",
      "Preço de atacado",
      "Obs. mão de obra",
    ])
      expect(sem, rotulo).not.toContain(rotulo);
    expect(sem).toContain("Nome");
    await t1.desmontar();

    estado.permissoes = new Set(["criacao_planejamento", "criacao_planejamento:preco_venda"]);
    const t2 = await montar();
    const comVarejo = colunas(t2.container);
    expect(comVarejo).toContain("Preço de venda");
    expect(comVarejo).toContain("Preço anterior");
    expect(comVarejo).not.toContain("Preço de atacado"); // atacado = seção própria
    await t2.desmontar();

    estado.todasPermissoes = true;
    const t3 = await montar();
    expect(colunas(t3.container)).toEqual(
      expect.arrayContaining(["Preço de venda", "Preço de atacado", "Obs. mão de obra"]),
    );
    await t3.desmontar();
  });

  it("sem permissão de EDITAR nada, todas as células são texto (nenhum campo editável)", async () => {
    estado.permissoes = new Set(); // vê a página? o `colunasVisiveis` mostra as sem seção; edição = nenhuma
    const t = await montar();
    expect(
      t.container.querySelectorAll("tbody input, tbody [data-controle='select']"),
    ).toHaveLength(0);
    expect(textoDe(t.container, "M1", "nome")).toContain("Modelo M1");
    await t.desmontar();
  });

  it("REF, Versão, Origem e Status são SÓ-LEITURA (texto cinza, sem campo), mesmo com todas as permissões", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [
      mod("M1", {
        ref: "VMC10000001",
        versao: 2,
        origem: "revenda",
        status_planejamento: "planejado",
      }),
    ];
    const t = await montar();
    for (const col of ["REF", "Versão", "Origem", "Status"])
      expect(porLabel(t.container, `${col} de Modelo M1`), col).toHaveLength(0);
    expect(textoDe(t.container, "M1", "ref")).toBe("VMC10000001");
    expect(textoDe(t.container, "M1", "versao")).toBe("v2");
    expect(textoDe(t.container, "M1", "origem")).toBe("Revenda");
    expect(textoDe(t.container, "M1", "status_planejamento")).toBe("Planejado");
    expect(
      linhaDe(t.container, "M1").querySelector(
        'td[data-col="ref"] [data-controle="somente-leitura"]',
      ),
    ).not.toBeNull();
    await t.desmontar();
  });

  it("preço de venda de COMPRADO é só leitura (derivado); do interno edita", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [
      mod("A", { origem: "interno", preco_venda: 100 }),
      mod("B", { origem: "revenda", preco_venda: 200 }),
    ];
    const t = await montar();
    expect(porLabel(t.container, "Preço de venda de Modelo A")).toHaveLength(1);
    expect(porLabel(t.container, "Preço de venda de Modelo B")).toHaveLength(0);
    expect(textoDe(t.container, "B", "preco_venda")).toBe("200,00");
    await t.desmontar();
  });

  it("card já enviado à Explosão: o campo só do Desenvolvimento (Obs. gerais) vira texto; o do Planejamento segue editável", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [mod("A"), mod("B", { enviado_cad: true })];
    const t = await montar();
    expect(porLabel(t.container, "Observações gerais de Modelo A")).toHaveLength(1);
    expect(porLabel(t.container, "Observações gerais de Modelo B")).toHaveLength(0);
    expect(porLabel(t.container, "Nome de Modelo B")).toHaveLength(1);
    await t.desmontar();
  });

  it("'Tamanho em' é N/A em Acessórios (grade única UN) e é um select nos demais", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [
      mod("A", { categoria_principal_id: "cat1" }),
      mod("B", { categoria_principal_id: "cat3" }),
    ]; // cat3 = Bolsa (grupo Acessórios)
    const t = await montar();
    expect(celula(t.container, "Tamanho em de Modelo A")).toBeTruthy();
    expect(porLabel(t.container, "Tamanho em de Modelo B")).toHaveLength(0);
    expect(textoDe(t.container, "B", "tamanho_tipo")).toBe("N/A (grade UN)");
    await t.desmontar();
  });

  it("sem OTB, Coleção/Subcoleção são texto livre; com OTB, dropdown (coleção do OTB)", async () => {
    estado.todasPermissoes = true;
    const t1 = await montar();
    expect(celula(t1.container, "Coleção de Modelo M1").tagName).toBe("INPUT");
    await t1.desmontar();
    estado.otb = true;
    const t2 = await montar();
    expect(t2.container.querySelector('span[aria-label="Coleção de Modelo M1"]')).not.toBeNull();
    await t2.desmontar();
  });
});

describe("trava da Integração por célula (e espera do estado)", () => {
  it("célula travada neste produto: DESABILITADA + selo 'travado' com o texto da trava; outros produtos seguem livres", async () => {
    estado.todasPermissoes = true;
    estado.estadosIntegracao = { M1: integravel(["nome", "ncm"]) };
    const t = await montar();
    const nomeM1 = celula(t.container, NOME("M1"));
    expect(nomeM1.disabled).toBe(true);
    expect(nomeM1.hasAttribute("data-travada")).toBe(true);
    const selo = linhaDe(t.container, "M1").querySelector(
      'td[data-col="nome"] [data-selo-travado]',
    )!;
    expect(selo.textContent).toContain("travado");
    expect(selo.getAttribute("title")).toMatch(/Integrável .*— travado/);
    expect(celula(t.container, "NCM de Modelo M1").disabled).toBe(true);
    // não marcado → segue editável; outro produto → livre
    expect(celula(t.container, "Descrição de Modelo M1").disabled).toBe(false);
    expect(celula(t.container, NOME("M2")).disabled).toBe(false);
    expect(linhaDe(t.container, "M2").querySelector("[data-selo-travado]")).toBeNull();
    // "Tamanho em" trava SEMPRE em produto integrável (marcado ou não)
    expect(
      t.container
        .querySelector('span[aria-label="Tamanho em de Modelo M1"]')!
        .hasAttribute("data-travada"),
    ).toBe(true);
    expect(
      t.container
        .querySelector('span[aria-label="Tamanho em de Modelo M2"]')!
        .hasAttribute("data-travada"),
    ).toBe(false);
    await t.desmontar();
  });

  it("estado da Integração AINDA carregando: as colunas traváveis ficam bloqueadas (verificando), as demais livres; depois libera", async () => {
    estado.todasPermissoes = true;
    let liberar!: () => void;
    estado.integracaoPendente = new Promise<void>((r) => (liberar = r));
    const t = await montar();
    const nome = celula(t.container, NOME("M1"));
    expect(nome.disabled).toBe(true);
    expect(nome.hasAttribute("data-verificando")).toBe(true);
    expect(celula(t.container, "Peso (kg) de Modelo M1").disabled).toBe(true);
    expect(
      t.container
        .querySelector('span[aria-label="Tamanho em de Modelo M1"]')!
        .hasAttribute("data-verificando"),
    ).toBe(true);
    expect(celula(t.container, "Observações gerais de Modelo M1").disabled).toBe(false); // não travável: livre
    expect(t.container.querySelector('[data-testid="verificando-integracao"]')).not.toBeNull();
    await act(async () => liberar());
    await flush(80);
    expect(celula(t.container, NOME("M1")).disabled).toBe(false);
    expect(t.container.querySelector('[data-testid="verificando-integracao"]')).toBeNull();
    await t.desmontar();
  });

  it("falha ao verificar a Integração: traváveis seguem BLOQUEADAS (nunca livres) + aviso com 'Tentar de novo'", async () => {
    estado.todasPermissoes = true;
    estado.integracaoFalha = true;
    const t = await montar();
    expect(celula(t.container, NOME("M1")).disabled).toBe(true);
    const aviso = t.container.querySelector('[data-testid="integracao-erro"]')!;
    expect(aviso.textContent).toContain("Não foi possível verificar a Integração");
    expect(aviso.textContent).toContain("Tentar de novo");
    // a grade em si (modelos) NÃO foi derrubada por isso
    expect(ids(t.container)).toEqual(["M1", "M2", "M3"]);
    // recupera: a Integração volta e libera
    estado.integracaoFalha = false;
    const btn = Array.from(aviso.querySelectorAll("button")).find(
      (b) => b.textContent === "Tentar de novo",
    )!;
    await clicar(btn);
    await flush(80);
    expect(celula(t.container, NOME("M1")).disabled).toBe(false);
    expect(t.container.querySelector('[data-testid="integracao-erro"]')).toBeNull();
    await t.desmontar();
  });
});

describe("staging: NADA grava antes do Salvar", () => {
  it("editar só mexe no rascunho: selo âmbar na linha e na célula, 'Salvar (1)', onDirtyChange(true) e ZERO UPDATE", async () => {
    estado.todasPermissoes = true;
    const onDirtyChange = vi.fn();
    const t = await montar({ onDirtyChange });
    expect(botaoSalvar(t.container)).toBeUndefined();
    await digitar(celula(t.container, NOME("M1")), "Vestido Novo");
    expect(updates).toHaveLength(0);
    expect(selos(t.container)).toBe(1);
    expect(linhaDe(t.container, "M1").querySelector("[data-selo-nao-salvo]")).not.toBeNull();
    expect(celula(t.container, NOME("M1")).className).toContain("border-amber-500");
    expect(botaoSalvar(t.container)!.textContent).toContain("Salvar (1)");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(t.container.textContent).toContain("alterações não salvas");
    await t.desmontar();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false); // fechou a Lista: volta a limpo
  });

  it("Descartar alterações (com confirmação) volta tudo à base e some o selo — sem gravar", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "Outro");
    const desc = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Descartar alterações"),
    ) as HTMLElement;
    await clicar(desc);
    const confirmar = Array.from(
      document.body.querySelectorAll('[role="alertdialog"] button'),
    ).find((b) => b.textContent === "Descartar");
    await clicar(confirmar!);
    await flush();
    expect(celula(t.container, NOME("M1")).value).toBe("Modelo M1");
    expect(selos(t.container)).toBe(0);
    expect(updates).toHaveLength(0);
    await t.desmontar();
  });

  it("NCM: digita só dígitos e pontos (filtro da coluna)", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, "NCM de Modelo M1"), "6104abc.43,00");
    expect(celula(t.container, "NCM de Modelo M1").value).toBe("6104.43.00");
    await t.desmontar();
  });
});

describe("UM Salvar: 1 UPDATE por modelo tocado, só o editado, CAS por rev", () => {
  it("manda SÓ os campos editados, com `.eq(rev)` de cada modelo; toast de sucesso; selo some", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [mod("M1", { rev: 5 }), mod("M2", { rev: 9 }), mod("M3")];
    const onDirtyChange = vi.fn();
    const t = await montar({ onDirtyChange });
    await digitar(celula(t.container, NOME("M1")), "Vestido Longo");
    await digitar(celula(t.container, "NCM de Modelo M2"), "6104.43");
    await salvar();
    expect(updates).toEqual([
      { id: "M1", rev: 5, payload: { nome: "Vestido Longo" } },
      { id: "M2", rev: 9, payload: { ncm: "6104.43" } },
    ]);
    expect(toast.success).toHaveBeenCalledWith("2 produtos salvos.", undefined);
    expect(selos(t.container)).toBe(0);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(botaoSalvar(t.container)).toBeUndefined();
    // a grade foi relida: o valor salvo é o do servidor
    expect(celula(t.container, "Nome de Vestido Longo").value).toBe("Vestido Longo");
    await t.desmontar();
  });

  it("re-baseliza o rev depois de salvar: o 2º Salvar do mesmo produto usa o rev NOVO (sem conflito falso)", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "A");
    await salvar();
    await digitar(celula(t.container, "Nome de A"), "B");
    await salvar();
    expect(updates.map((u) => [u.rev, u.payload.nome])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    await t.desmontar();
  });

  it('Título e Preço anterior VAZIOS vão como NULL (automático), nunca ""/0', async () => {
    estado.todasPermissoes = true;
    estado.modelos = [mod("M1", { titulo_pagina: "Título manual", preco_anterior: 50 })];
    const t = await montar();
    await digitar(celula(t.container, "Título para a página de Modelo M1"), "");
    await digitar(celula(t.container, "Preço anterior de Modelo M1"), "");
    expect(celula(t.container, "Título para a página de Modelo M1").placeholder).toBe("automático");
    await salvar();
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ titulo_pagina: null, preco_anterior: null });
    expect(Object.values(updates[0].payload)).not.toContain("");
    await t.desmontar();
  });

  it("peso/medidas/preço de venda: número canônico (MoneyInput), preço 0 = NULL", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, "Peso (kg) de Modelo M1"), "0,25");
    await digitar(celula(t.container, "Preço de venda de Modelo M1"), "199,90");
    await salvar();
    expect(updates[0].payload).toEqual({ peso_kg: 0.25, preco_venda: 199.9 });
    await t.desmontar();
  });

  it("Categoria cascateia: trocar a categoria limpa a subcategoria órfã e tudo vai no MESMO UPDATE", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [
      mod("M1", { categoria_principal_id: "cat1", subcategoria1_id: "s1", subcategoria2_id: "s2" }),
    ];
    const t = await montar();
    // opções da subcategoria = só as da categoria da linha
    const opcoesSub = Array.from(
      t.container
        .querySelector('span[aria-label="Subcategoria de Modelo M1"]')!
        .closest("[data-select]")!
        .querySelectorAll("[data-item]"),
    ).map((b) => b.getAttribute("data-item"));
    expect(opcoesSub).toEqual(["__vazio__", "s1"]);
    await escolher(t.container, "Categoria de Modelo M1", "cat2");
    expect(selos(t.container)).toBe(1);
    await salvar();
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({
      categoria_principal_id: "cat2",
      subcategoria1_id: null,
      subcategoria2_id: null,
    });
    await t.desmontar();
  });

  it("OTB: escolher a coleção grava colecao_id + colecao (nome) e herda Mês/Ano vazios dela", async () => {
    estado.todasPermissoes = true;
    estado.otb = true;
    const t = await montar();
    await escolher(t.container, "Coleção de Modelo M1", "col1");
    await salvar();
    expect(updates[0].payload).toEqual({
      colecao_id: "col1",
      colecao: "Verão 27",
      mes_id: "mes1",
      ano_id: "ano1",
    });
    await t.desmontar();
  });

  it("nome apagado é recusado na linha (sem ir ao servidor) e as outras linhas salvam", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "");
    await digitar(celula(t.container, NOME("M2")), "Ok");
    await salvar();
    expect(updates.map((u) => u.id)).toEqual(["M2"]);
    const erro = linhaDe(t.container, "M1").querySelector("[data-erro-linha]")!;
    expect(erro.getAttribute("title")).toBe("O nome do produto não pode ficar vazio.");
    expect(selos(t.container)).toBe(0); // M2 limpou; M1 mostra o ERRO (não o selo)
    await t.desmontar();
  });
});

describe("P0409 e resultado parcial", () => {
  it("conflito em UMA linha: aquela marca o erro, é recarregada e re-baselizada; a outra SALVA; o 2º Salvar passa com o rev novo", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "Meu nome");
    await digitar(celula(t.container, NOME("M2")), "Salvo");
    // outra pessoa salvou o M1 no meio (rev 1 → 2, com outra descrição)
    estado.modelos[0].rev = 2;
    estado.modelos[0].descricao_produto = "da outra pessoa";
    await salvar();
    // M1 tentou com rev 1 (recusado: 0 linhas); M2 salvou
    expect(updates.map((u) => [u.id, u.rev])).toEqual([
      ["M1", 1],
      ["M2", 1],
    ]);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe("1 produto salvo; 1 não salvou.");
    expect(toast.warning.mock.calls[0][1].description).toMatch(/outra pessoa/);
    const erro = linhaDe(t.container, "M1").querySelector("[data-erro-linha]")!;
    expect(erro.getAttribute("title")).toMatch(/Outra pessoa salvou este produto/);
    expect(linhaDe(t.container, "M2").querySelector("[data-erro-linha]")).toBeNull();
    // o rascunho do M1 foi MANTIDO e a linha recarregou (a descrição da outra pessoa chegou)
    expect(celula(t.container, NOME("M1")).value).toBe("Meu nome");
    expect(celula(t.container, "Descrição de Modelo M1").value).toBe("da outra pessoa");
    expect(selos(t.container)).toBe(0); // (erro substitui o selo na linha) — M2 salvo
    // 2º Salvar: usa o rev NOVO (re-baselizado) e passa
    toast.warning.mockReset();
    await salvar();
    expect(updates.slice(2).map((u) => [u.id, u.rev])).toEqual([["M1", 2]]);
    expect(toast.success).toHaveBeenLastCalledWith("1 produto salvo.", undefined);
    expect(linhaDe(t.container, "M1").querySelector("[data-erro-linha]")).toBeNull();
    await t.desmontar();
  });

  it("erro do servidor em UMA linha (ex.: Acessórios com OC) vira texto PT na linha; o resto salva", async () => {
    estado.todasPermissoes = true;
    estado.erroUpdate.set("M1", {
      code: "P0001",
      message: "categoria_acessorio_com_pedido: Bolsa",
    });
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "X");
    await digitar(celula(t.container, NOME("M2")), "Y");
    await salvar();
    expect(updates.map((u) => u.id)).toEqual(["M1", "M2"]);
    expect(
      linhaDe(t.container, "M1").querySelector("[data-erro-linha]")!.getAttribute("title"),
    ).toMatch(/pedido \(OC\)/);
    expect(toast.warning.mock.calls[0][0]).toBe("1 produto salvo; 1 não salvou.");
    await t.desmontar();
  });

  it("todas falham = toast de ERRO (nunca 'salvo')", async () => {
    estado.todasPermissoes = true;
    estado.conflitoIds = new Set(["M1"]);
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "X");
    await salvar();
    expect(toast.error).toHaveBeenCalledWith("O produto não foi salvo.", expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
    await t.desmontar();
  });

  it("produto excluído por outra pessoa no meio: a linha FICA com o rascunho e o aviso diz que sumiu", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "X");
    estado.conflitoIds = new Set(["M1"]);
    estado.relidoPorId.set("M1", null);
    await salvar();
    expect(linhaDe(t.container, "M1")).not.toBeNull();
    expect(
      linhaDe(t.container, "M1").querySelector("[data-erro-linha]")!.getAttribute("title"),
    ).toMatch(/não existe mais/);
    await t.desmontar();
  });
});

describe("campo travado NUNCA vai no Salvar", () => {
  it("produto travado DEPOIS que a Lista abriu: o Salvar relê a trava, omite o campo travado, manda o resto e AVISA", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "Novo nome");
    await digitar(celula(t.container, "Descrição de Modelo M1"), "Nova descrição");
    // outra pessoa marcou o M1 como integrável (Nome marcado) depois que a Lista abriu
    estado.estadosIntegracao = { M1: integravel(["nome"]) };
    await salvar();
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ descricao_produto: "Nova descrição" });
    expect("nome" in updates[0].payload).toBe(false);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe("1 produto salvo.");
    expect(toast.warning.mock.calls[0][1].description).toContain(
      "Travado pela Integração (não enviado): Modelo M1 (Nome)",
    );
    await t.desmontar();
  });

  it("se TUDO o que foi editado está travado, nada vai ao servidor e o aviso explica", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "Novo nome");
    estado.estadosIntegracao = { M1: integravel(["nome"]) };
    await salvar();
    expect(updates).toHaveLength(0);
    expect(toast.warning.mock.calls[0][0]).toBe("Nada foi enviado ao servidor.");
    await t.desmontar();
  });
});

describe("ordenação por coluna e teclado", () => {
  it("clicar no cabeçalho ordena (asc → desc) pelo valor SALVO; sem clique = a ordem que a tela entregou", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [
      mod("A", { nome: "Zeta" }),
      mod("B", { nome: "Alfa" }),
      mod("C", { nome: "Meio" }),
    ];
    const t = await montar();
    expect(ids(t.container)).toEqual(["A", "B", "C"]);
    const th = () =>
      Array.from(t.container.querySelectorAll("thead th"))
        .find((x) => x.textContent?.includes("Nome"))!
        .querySelector("button")!;
    await clicar(th());
    expect(ids(t.container)).toEqual(["B", "C", "A"]);
    await clicar(th());
    expect(ids(t.container)).toEqual(["A", "C", "B"]);
    await t.desmontar();
  });

  it("a ordenação NÃO derruba o rascunho (a linha editada anda junto, com o selo)", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [mod("A", { nome: "Zeta" }), mod("B", { nome: "Alfa" })];
    const t = await montar();
    await digitar(celula(t.container, "Nome de Zeta"), "Zeta editado");
    const th = Array.from(t.container.querySelectorAll("thead th"))
      .find((x) => x.textContent?.includes("Nome"))!
      .querySelector("button")!;
    await clicar(th);
    expect(ids(t.container)).toEqual(["B", "A"]);
    expect(linhaDe(t.container, "A").querySelector("[data-selo-nao-salvo]")).not.toBeNull();
    expect(
      (linhaDe(t.container, "A").querySelector('input[data-controle="input"]') as HTMLInputElement)
        .value,
    ).toBe("Zeta editado");
    await t.desmontar();
  });

  it("a prop `modelos` (filtro/ordem da tela) define as linhas e a ordem", async () => {
    estado.todasPermissoes = true;
    const t = await montar({ modelos: [{ id: "M3" }, { id: "M1" }] });
    expect(ids(t.container)).toEqual(["M3", "M1"]);
    await t.desmontar();
  });

  it("Enter desce para o mesmo campo da linha de baixo (ordem da TELA); Tab vai ao campo ao lado", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    const tecla = async (el: HTMLElement, key: string) => {
      el.focus();
      await act(async () => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
      await flush(40);
    };
    const nomeM1 = celula(t.container, NOME("M1"));
    await tecla(nomeM1, "Enter");
    expect(document.activeElement).toBe(celula(t.container, NOME("M2")));
    await tecla(celula(t.container, NOME("M2")), "Tab");
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe(
      "Descrição de Modelo M2",
    );
    await t.desmontar();
  });
});

describe("servidor muda com a linha SUJA (refetch/Realtime/outra pessoa)", () => {
  it("o campo que NÃO editei mostra o valor novo do servidor SEM falso selo âmbar; o editado fica; só o editado vai no Salvar", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    await digitar(celula(t.container, NOME("M1")), "Meu nome");
    // outra pessoa mudou a DESCRIÇÃO e o NCM do M1 (rev 1 → 2) e a grade foi relida (Realtime)
    estado.modelos[0].rev = 2;
    estado.modelos[0].descricao_produto = "da outra pessoa";
    estado.modelos[0].ncm = "6104.43";
    await act(async () => {
      await t.qc.refetchQueries({ queryKey: ["modelos-planejamento", "grade"] });
    });
    await flush();
    expect(celula(t.container, "Descrição de Modelo M1").value).toBe("da outra pessoa");
    expect(celula(t.container, "NCM de Modelo M1").value).toBe("6104.43");
    expect(celula(t.container, NOME("M1")).value).toBe("Meu nome");
    // só o Nome é "editado": selo âmbar SÓ nele
    expect(celula(t.container, NOME("M1")).className).toContain("border-amber-500");
    expect(celula(t.container, "Descrição de Modelo M1").className).not.toContain(
      "border-amber-500",
    );
    expect(selos(t.container)).toBe(1);
    // o CAS segue no rev de QUANDO comecei a editar (1): a mudança alheia vira P0409 (não é sobrescrita calada)
    await salvar();
    expect(updates).toEqual([{ id: "M1", rev: 1, payload: { nome: "Meu nome" } }]);
    expect(toast.error).toHaveBeenCalled(); // único produto e conflitou
    await t.desmontar();
  });

  it("linha LIMPA acompanha o servidor (valor e rev) — o próximo Salvar usa o rev novo, sem conflito falso", async () => {
    estado.todasPermissoes = true;
    const t = await montar();
    estado.modelos[0].rev = 7;
    estado.modelos[0].nome = "Renomeado por outra pessoa";
    await act(async () => {
      await t.qc.refetchQueries({ queryKey: ["modelos-planejamento", "grade"] });
    });
    await flush();
    await digitar(celula(t.container, "Nome de Renomeado por outra pessoa"), "Eu agora");
    await salvar();
    expect(updates).toEqual([{ id: "M1", rev: 7, payload: { nome: "Eu agora" } }]);
    expect(toast.success).toHaveBeenCalled();
    await t.desmontar();
  });
});

describe("somente leitura da página", () => {
  it("a grade dentro de um escopo somente-leitura não oferece NENHUM campo nem a barra de Salvar", async () => {
    estado.todasPermissoes = true;
    const t = await montar({}, { somenteLeitura: true });
    expect(
      t.container.querySelectorAll("tbody input, tbody [data-controle='select']"),
    ).toHaveLength(0);
    expect(botaoSalvar(t.container)).toBeUndefined();
    expect(textoDe(t.container, "M1", "nome")).toContain("Modelo M1");
    await t.desmontar();
  });
});

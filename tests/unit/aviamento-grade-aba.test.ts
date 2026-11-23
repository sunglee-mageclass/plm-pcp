// @vitest-environment happy-dom
// Grade "Lista tipo Excel" de Cadastro > Aviamentos (AV-2): render de verdade da `AviamentosGradeAba` com `supabase` mockado.
// Prova: cada aviamento = 1 linha-pai (cabeçalho) + 1 linha por cor, NASCEM RECOLHIDOS e o chevron expande; editar só mexe no
// RASCUNHO (nada grava antes do Salvar); o cabeçalho só existe/edita na linha-pai; célula por tipo (texto, textarea, money, select);
// subcategoria cascateia pela categoria; fornecedor = empresa OU empresa·representante; UM Salvar grava o cabeçalho por UPDATE DIRETO
// (sem rev) e as cores por UMA chamada de lote `salvar_variantes_aviamento` por aviamento (conjunto COMPLETO); 23505 vira texto PT;
// isError honesto. O Select do Radix vira botões (a lógica testada é a da tela).
import { describe, it, expect, beforeEach } from "vitest";
import {
  aviamento,
  aviamentoUpdates,
  botaoSalvar,
  clicar,
  digitar,
  estado,
  flush,
  linhas,
  montar,
  ordem,
  porLabel,
  PROPS,
  resetar,
  rpc,
  salvaLotes,
  selos,
  seletor,
  toast,
  variante,
  variantesUpdates,
  expandirTudo,
} from "./aviamento-grade-harness";

beforeEach(() => resetar());

describe("AviamentosGradeAba: estrutura pai/filhos recolhível", () => {
  it("cada aviamento = 1 linha-PAI (cabeçalho) + 1 linha por cor; o cabeçalho só aparece no pai; aviamento sem cor = só a linha-pai", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    expect(trs).toHaveLength(4); // av1: pai + 2 cores; av2 (sem cor): só o pai
    expect(trs.map((r) => (r.dataset.pai !== undefined ? "pai" : "cor"))).toEqual([
      "pai",
      "cor",
      "cor",
      "pai",
    ]);
    expect(porLabel(trs[0], "Nome de Botão")).toHaveLength(1);
    expect(porLabel(trs[1], "Nome de Botão")).toHaveLength(0); // as cores não repetem o cabeçalho
    expect(porLabel(trs[2], "Nome de Botão")).toHaveLength(0);
    expect(porLabel(trs[1], "Nome da variante da cor de Botão")).toHaveLength(1); // a cor edita só os campos da cor
    expect(trs[3].textContent).toContain("sem cores");
    expect(t.container.querySelectorAll("thead th").length).toBe(1 + 18); // estado + o catálogo (18 colunas)
    await t.desmontar();
  });

  it("NASCEM RECOLHIDOS: as cores ficam escondidas até o chevron / clique na linha-pai; recolher esconde de novo", async () => {
    const t = await montar(PROPS(), {}, false);
    const pai = () => linhas(t.container)[0];
    const cores = () => linhas(t.container).filter((r) => r.dataset.varianteId);
    expect(pai().hasAttribute("data-recolhido")).toBe(true);
    expect(cores()).toHaveLength(2);
    expect(cores().every((r) => r.hidden)).toBe(true); // montadas (o Salvar as enxerga), mas escondidas
    const chevron = pai().querySelector('[data-acao="alternar-cores"]') as HTMLElement;
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    await clicar(chevron);
    expect(cores().every((r) => !r.hidden)).toBe(true);
    expect(pai().hasAttribute("data-recolhido")).toBe(false);
    // clicar numa célula "morta" da linha-pai também recolhe (o clique em campo editável NÃO)
    await clicar(pai().querySelector('td[data-col="cor_base"]'));
    expect(cores().every((r) => r.hidden)).toBe(true);
    await clicar(porLabel(pai(), "Nome de Botão")[0]);
    expect(cores().every((r) => r.hidden)).toBe(true);
    await t.desmontar();
  });

  it("aviamento sem cor não tem chevron (não há o que recolher)", async () => {
    const t = await montar(PROPS(), {}, false);
    expect(linhas(t.container)[3].querySelector('[data-acao="alternar-cores"]')).toBeNull();
    await t.desmontar();
  });

  it("contagem 'N aviamentos · M variantes' da lista recebida (singular/plural); sem a prop conta todos", async () => {
    const t = await montar([{ id: "av1" }]);
    expect(t.container.textContent).toContain("1aviamento");
    expect(t.container.textContent).not.toContain("1aviamentos");
    expect(t.container.textContent).toContain("2variantes");
    await t.desmontar();
    const t2 = await montar(undefined);
    expect(t2.container.textContent).toContain("2aviamentos");
    await t2.desmontar();
    const t3 = await montar([{ id: "av2" }]);
    expect(t3.container.textContent).toContain("0variantes");
    await t3.desmontar();
  });

  it("a ordem da lista recebida da tela é a da grade; id fora da lista não aparece", async () => {
    const t = await montar([{ id: "av2" }, { id: "av1" }]);
    expect(
      linhas(t.container)
        .filter((r) => r.dataset.pai !== undefined)
        .map((r) => r.dataset.aviamentoId),
    ).toEqual(["av2", "av1"]);
    await t.desmontar();
  });

  it("scroll horizontal sempre visível (.scroll-x-visivel) e as colunas Estado + Nome ficam FIXAS (sticky)", async () => {
    const t = await montar(PROPS());
    const rolagem = t.container.querySelector(
      '[data-testid="aviamentos-grade-tabela"]',
    ) as HTMLElement;
    expect(rolagem.className).toContain("scroll-x-visivel");
    const th = t.container.querySelectorAll("thead th");
    expect(th[0].className).toContain("sticky");
    expect(th[0].className).toContain("left-0");
    const nome = Array.from(th).find((x) => x.textContent === "Nome")!;
    expect(nome.className).toContain("sticky");
    expect(nome.className).toContain("left-10");
    // linha-pai e linha da cor mantêm as duas colunas fixas
    for (const tr of [linhas(t.container)[0], linhas(t.container)[1]]) {
      expect(tr.querySelector("td")!.className).toContain("sticky");
      expect(tr.querySelector('td[data-col="codigo_nome"]')!.className).toContain("left-10");
    }
    await t.desmontar();
  });
});

describe("AviamentosGradeAba: edição com rascunho e célula por tipo", () => {
  it("editar NÃO grava nada; mostra o selo âmbar (na linha-pai) e o Nome vazio mostra o código como placeholder", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    await digitar(porLabel(trs[0], "Nome de Botão")[0], "Botão Novo");
    expect(aviamentoUpdates).toHaveLength(0);
    expect(rpc.mock.calls.filter((c) => c[0] !== "get_user_tenant_id")).toHaveLength(0);
    expect(linhas(t.container)[0].querySelectorAll("[data-selo-nao-salvo]")).toHaveLength(1);
    expect(porLabel(linhas(t.container)[0], "Nome de Botão")[0].value).toBe("Botão Novo");
    expect(t.container.textContent).toContain("alterações não salvas");
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    // nome vazio: o placeholder é o código (o identificador do aviamento)
    await digitar(porLabel(linhas(t.container)[0], "Nome de Botão")[0], "");
    expect(porLabel(linhas(t.container)[0], "Nome de Botão")[0].placeholder).toBe("COD-av1");
    await t.desmontar();
  });

  it("controle por tipo: texto = input, composição/observações = textarea, preço/largura = money, categoria/subcategoria/material/intervalo/fornecedor = select", async () => {
    const t = await montar(PROPS());
    const pai = linhas(t.container)[0];
    const ctrl = (rot: string) =>
      porLabel(pai, rot)[0]?.getAttribute("data-controle") ?? porLabel(pai, rot)[0]?.tagName;
    expect(ctrl("Código de Botão")).toBe("input");
    expect(ctrl("Nome de Botão")).toBe("input");
    expect(ctrl("NCM de Botão")).toBe("input");
    expect(ctrl("Composição de Botão")).toBe("textarea");
    expect(ctrl("Observações de Botão")).toBe("textarea");
    expect(ctrl("Preço de Botão")).toBe("money");
    expect(ctrl("Largura exata de Botão")).toBe("money");
    for (const rot of [
      "Categoria",
      "Subcategoria",
      "Material",
      "Intervalo de largura",
      "Fornecedor",
    ]) {
      expect(seletor(pai, `${rot} de Botão`), rot).toBeTruthy();
    }
    // as colunas da cor: cor base/apelido = select, nome/código = input, preço = money, foto
    const cor = linhas(t.container)[1];
    expect(seletor(cor, "Cor base da cor de Botão")).toBeTruthy();
    expect(seletor(cor, "Cor apelido da cor de Botão")).toBeTruthy();
    expect(
      porLabel(cor, "Preço da variante da cor de Botão")[0].getAttribute("data-controle"),
    ).toBe("money");
    expect(cor.querySelector('td[data-col="foto"] [data-controle="foto"]')).not.toBeNull();
    await t.desmontar();
  });

  it("UM Salvar: cabeçalho por UPDATE DIRETO (só os campos tocados, MoneyInput vira número, sem rev) ANTES das cores, em UMA chamada de lote com o conjunto COMPLETO", async () => {
    const t = await montar(PROPS());
    let trs = linhas(t.container);
    await digitar(porLabel(trs[0], "Nome de Botão")[0], "Botão Novo");
    await digitar(porLabel(trs[0], "Preço de Botão")[0], "12,50"); // texto mascarado pt-BR -> 12.5, nunca NaN
    await digitar(porLabel(trs[0], "Composição de Botão")[0], "  Poliéster  ");
    trs = linhas(t.container);
    await digitar(porLabel(trs[2], "Nome da variante da cor de Botão")[0], "Verde bandeira 2"); // trs[1] = v1, trs[2] = v2
    await digitar(porLabel(trs[1], "Preço da variante da cor de Botão")[0], "5"); // 2 cores tocadas do MESMO aviamento
    expect(botaoSalvar()?.textContent).toContain("Salvar (3)");

    await clicar(botaoSalvar());
    await flush(60);

    expect(aviamentoUpdates).toHaveLength(1);
    expect(aviamentoUpdates[0].id).toBe("av1");
    expect(Object.keys(aviamentoUpdates[0].eqs)).toEqual(["id"]); // SEM rev: "último vence"
    expect(aviamentoUpdates[0].payload).toEqual({
      codigo_nome: "Botão Novo",
      preco: 12.5,
      composicao: "Poliéster",
    }); // só os tocados, normalizados
    // as 2 cores tocadas vão numa só chamada de lote, com o conjunto completo e SÓ os campos tocados por cima
    expect(salvaLotes()).toHaveLength(1);
    const lote = salvaLotes()[0][1];
    expect(lote._aviamento_id).toBe("av1");
    expect(lote._variantes).toEqual([
      {
        id: "v1",
        cor_id: "cor1",
        cor_apelido_id: null,
        nome_variante: null,
        codigo_variante: null,
        preco: 5,
      },
      {
        id: "v2",
        cor_id: "cor2",
        cor_apelido_id: null,
        nome_variante: "Verde bandeira 2",
        codigo_variante: null,
        preco: 3,
      },
    ]);
    expect(ordem.indexOf("aviamentos.update:av1")).toBeLessThan(ordem.indexOf("rpc:variantes")); // cabeçalho ANTES das cores
    expect(toast.success).toHaveBeenCalledWith("3 salvos.");
    expect(selos(t.container)).toBe(0); // tudo rebaseado
    expect(botaoSalvar()).toBeUndefined();
    await t.desmontar();
  });

  it("cor tocada de um aviamento + cor intocada de outro: só o aviamento tocado vai ao lote", async () => {
    estado.aviamentos.push(aviamento("av3", { codigo_nome: "Fecho" }));
    estado.variantes.push(variante("v3", "av3"));
    const t = await montar(PROPS());
    await digitar(
      porLabel(
        linhas(t.container).find((r) => r.dataset.varianteId === "v3")!,
        "Nome da variante da cor de Fecho",
      )[0],
      "Preto",
    );
    await clicar(botaoSalvar());
    await flush(60);
    expect(salvaLotes()).toHaveLength(1);
    expect(salvaLotes()[0][1]._aviamento_id).toBe("av3");
    expect(aviamentoUpdates).toHaveLength(0);
    await t.desmontar();
  });

  it("editar só o cabeçalho NÃO chama o lote de cores", async () => {
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "NCM de Botão")[0], "9606.21.00 ");
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates[0].payload).toEqual({ ncm: "9606.21.00" });
    expect(salvaLotes()).toHaveLength(0);
    await t.desmontar();
  });

  it("CATEGORIA/SUBCATEGORIA/MATERIAL são selects simples: a subcategoria só lista as da categoria; trocar a categoria ZERA a subcategoria", async () => {
    const t = await montar(PROPS());
    const pai = () => linhas(t.container)[0];
    const itens = (rot: string) =>
      Array.from(seletor(pai(), rot)!.querySelectorAll("[data-item]")).map((b) =>
        b.getAttribute("data-item"),
      );
    expect(itens("Categoria de Botão")).toEqual(["__vazio__", "cat1", "cat2"]);
    expect(itens("Subcategoria de Botão")).toEqual(["__vazio__", "sub1", "sub2"]); // só as da categoria cat1
    expect(itens("Material de Botão")).toEqual(["__vazio__", "mat1", "mat2"]);
    expect(seletor(pai(), "Subcategoria de Botão")!.getAttribute("data-value")).toBe("sub1");

    // trocar para Zíperes: a subcategoria Pressão (de Botões) sai; as opções passam a ser as de Zíperes
    await clicar(seletor(pai(), "Categoria de Botão")!.querySelector('[data-item="cat2"]'));
    expect(seletor(pai(), "Subcategoria de Botão")!.getAttribute("data-value")).toBe("");
    expect(itens("Subcategoria de Botão")).toEqual(["__vazio__", "sub3"]);
    await clicar(seletor(pai(), "Subcategoria de Botão")!.querySelector('[data-item="sub3"]'));
    await clicar(seletor(pai(), "Material de Botão")!.querySelector('[data-item="mat2"]'));
    expect(aviamentoUpdates).toHaveLength(0); // nada grava antes do Salvar

    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates[0].payload).toEqual({
      categoria_aviamento_id: "cat2",
      subcategoria_aviamento_id: "sub3",
      material_aviamento_id: "mat2",
    }); // 3 colunas FK, sem RPC de categorias
    expect(rpc.mock.calls.some((c) => c[0] === "set_artigo_categorias")).toBe(false);
    await t.desmontar();
  });

  it("trocar a categoria que mantém a subcategoria compatível (mesma categoria) não mexe nela; limpar a categoria zera a subcategoria", async () => {
    const t = await montar(PROPS());
    const pai = () => linhas(t.container)[0];
    await clicar(seletor(pai(), "Categoria de Botão")!.querySelector('[data-item="__vazio__"]'));
    expect(seletor(pai(), "Categoria de Botão")!.getAttribute("data-value")).toBe("");
    expect(seletor(pai(), "Subcategoria de Botão")!.getAttribute("data-value")).toBe("");
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates[0].payload).toEqual({
      categoria_aviamento_id: null,
      subcategoria_aviamento_id: null,
    });
    await t.desmontar();
  });

  it("FORNECEDOR = empresa OU empresa·representante (grava o PAR); só fornecedores de aviamento + o já salvo", async () => {
    estado.aviamentos[0].empresa_id = "emp2"; // fornecedor salvo de outra categoria (Tecidos): continua aparecendo
    const t = await montar(PROPS());
    const pai = () => linhas(t.container)[0];
    const itens = () =>
      Array.from(seletor(pai(), "Fornecedor de Botão")!.querySelectorAll("[data-item]")).map((b) =>
        b.getAttribute("data-item"),
      );
    // emp1 e emp3 têm categoria de aviamento; emp2 (Tecidos) só aparece por ser o fornecedor salvo
    expect(itens()).toEqual(["E:emp1", "R:rep1", "E:emp2", "E:emp3", "R:rep3"]);
    expect(seletor(pai(), "Fornecedor de Botão")!.getAttribute("data-value")).toBe("E:emp2");

    await clicar(seletor(pai(), "Fornecedor de Botão")!.querySelector('[data-item="R:rep3"]')); // via representante
    expect(seletor(pai(), "Fornecedor de Botão")!.getAttribute("data-value")).toBe("R:rep3");
    expect(aviamentoUpdates).toHaveLength(0);
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates[0].payload).toEqual({ empresa_id: "emp3", representante_id: "rep3" });
    await t.desmontar();
  });

  it("trocar para a empresa direta (sem representante) manda representante_id null", async () => {
    estado.aviamentos[0].empresa_id = "emp1";
    estado.aviamentos[0].representante_id = "rep1";
    const t = await montar(PROPS());
    expect(seletor(linhas(t.container)[0], "Fornecedor de Botão")!.getAttribute("data-value")).toBe(
      "R:rep1",
    );
    await clicar(
      seletor(linhas(t.container)[0], "Fornecedor de Botão")!.querySelector('[data-item="E:emp1"]'),
    ); // mesma empresa, sem o representante
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates[0].payload).toEqual({ empresa_id: "emp1", representante_id: null });
    await t.desmontar();
  });

  it("COR: o apelido só lista os da cor base; escolher o apelido preenche a cor base; trocar a cor base tira o apelido que não é dela", async () => {
    const t = await montar(PROPS());
    const cor = () => linhas(t.container)[1];
    const itens = () =>
      Array.from(
        seletor(cor(), "Cor apelido da cor de Botão")!.querySelectorAll("[data-item]"),
      ).map((b) => b.getAttribute("data-item"));
    expect(itens()).toEqual(["__vazio__", "ap1"]); // v1 é Azul (cor1): o apelido Marinho é dela
    await clicar(seletor(cor(), "Cor apelido da cor de Botão")!.querySelector('[data-item="ap1"]'));
    expect(seletor(cor(), "Cor apelido da cor de Botão")!.getAttribute("data-value")).toBe("ap1");
    await clicar(seletor(cor(), "Cor base da cor de Botão")!.querySelector('[data-item="cor2"]')); // Verde: Marinho sai
    expect(seletor(cor(), "Cor base da cor de Botão")!.getAttribute("data-value")).toBe("cor2");
    expect(seletor(cor(), "Cor apelido da cor de Botão")!.getAttribute("data-value")).toBe("");
    expect(selos(t.container)).toBeGreaterThan(0);
    await t.desmontar();
  });

  it("Descartar alterações volta tudo à base (com confirmação) e some o selo", async () => {
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Nome de Botão")[0], "Botão Novo");
    await digitar(porLabel(linhas(t.container)[1], "Nome da variante da cor de Botão")[0], "X");
    const desc = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Descartar alterações"),
    ) as HTMLButtonElement;
    await clicar(desc);
    const confirmar = Array.from(
      document.body.querySelectorAll('[role="alertdialog"] button'),
    ).find((b) => b.textContent === "Descartar");
    await clicar(confirmar);
    expect(porLabel(linhas(t.container)[0], "Nome de Botão")[0].value).toBe("Botão");
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    expect(aviamentoUpdates).toHaveLength(0);
    expect(salvaLotes()).toHaveLength(0);
    await t.desmontar();
  });
});

describe("AviamentosGradeAba: erros no Salvar (resultado parcial, texto PT)", () => {
  it("nome repetido no fornecedor (23505) vira aviso na linha; as cores gravam mesmo assim ('1 salvo, 1 com erro')", async () => {
    estado.duplicado.add("av1");
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Nome de Botão")[0], "Botão Novo");
    await digitar(porLabel(linhas(t.container)[2], "Nome da variante da cor de Botão")[0], "X");
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates).toHaveLength(0);
    expect(salvaLotes()).toHaveLength(1); // a cor gravou
    expect(String(toast.warning.mock.calls[0][0])).toContain("1 salvo, 1 com erro");
    const aviso = t.container.querySelector("[data-erro-linha]") as HTMLElement;
    expect(aviso.getAttribute("title")).toBe("Este nome já existe neste fornecedor.");
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)"); // só o aviamento segue sujo
    await t.desmontar();
  });

  it("código repetido na loja (23505 do índice tenant_codigo) tem texto próprio", async () => {
    estado.duplicadoCodigo.add("av1");
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Código de Botão")[0], "COD-av2");
    await clicar(botaoSalvar());
    await flush(60);
    expect(
      (t.container.querySelector("[data-erro-linha]") as HTMLElement).getAttribute("title"),
    ).toBe("Este código já está em uso. Escolha outro.");
    await t.desmontar();
  });

  it("código apagado é recusado (o gatilho que gera o código só roda no INSERT): nada vai ao servidor", async () => {
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Código de Botão")[0], "");
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates).toHaveLength(0);
    expect(
      (t.container.querySelector("[data-erro-linha]") as HTMLElement).getAttribute("title"),
    ).toBe("O código não pode ficar vazio.");
    expect(toast.error).toHaveBeenCalled();
    await t.desmontar();
  });

  it("aviamento excluído por outra pessoa (UPDATE devolve 0 linhas) não finge que salvou", async () => {
    estado.sumiu.add("av1");
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "NCM de Botão")[0], "123");
    await clicar(botaoSalvar());
    await flush(60);
    expect(
      (t.container.querySelector("[data-erro-linha]") as HTMLElement).getAttribute("title"),
    ).toContain("não foi encontrado");
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await t.desmontar();
  });

  it("falha do lote de cores: TODAS as cores tocadas do aviamento ficam com o aviso e sujas; o cabeçalho que gravou sai do rascunho", async () => {
    estado.erroLote = {
      code: "23505",
      message: "duplicate key uq_variantes_aviamento_cor_apelido",
    };
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "NCM de Botão")[0], "999");
    await digitar(porLabel(linhas(t.container)[1], "Nome da variante da cor de Botão")[0], "A");
    await digitar(porLabel(linhas(t.container)[2], "Nome da variante da cor de Botão")[0], "B");
    await clicar(botaoSalvar());
    await flush(60);
    expect(aviamentoUpdates).toHaveLength(1);
    const avisos = Array.from(t.container.querySelectorAll("[data-erro-linha]")).map((e) =>
      e.getAttribute("title"),
    );
    expect(avisos).toEqual([
      "Já existe uma variante com essa cor e apelido neste aviamento.",
      "Já existe uma variante com essa cor e apelido neste aviamento.",
    ]);
    expect(botaoSalvar()?.textContent).toContain("Salvar (2)");
    expect(String(toast.warning.mock.calls[0][0])).toContain("1 salvo, 2 com erro");
    await t.desmontar();
  });

  it("cor com erro dentro de um aviamento RECOLHIDO reabre o aviamento (o erro precisa estar à vista); sujo escondido ganha selo no pai", async () => {
    estado.erroLote = { message: "Não é possível remover uma cor em uso" };
    const t = await montar(PROPS(), {}, false);
    const pai = () => linhas(t.container)[0];
    await clicar(pai().querySelector('[data-acao="alternar-cores"]'));
    await digitar(porLabel(linhas(t.container)[1], "Nome da variante da cor de Botão")[0], "A");
    await clicar(pai().querySelector('[data-acao="alternar-cores"]')); // recolhe de novo, com a cor suja escondida
    expect(pai().querySelector("[data-selo-filho-oculto]")).not.toBeNull();
    await clicar(botaoSalvar());
    await flush(60);
    expect(pai().hasAttribute("data-recolhido")).toBe(false); // o erro reabriu o aviamento
    expect(linhas(t.container)[1].hidden).toBe(false);
    await t.desmontar();
  });

  it("isError honesto: aviso 'Não foi possível carregar' + Tentar de novo, sem tabela vazia enganosa", async () => {
    estado.falhaTabela = "variantes_aviamento";
    const t = await montar(PROPS());
    expect(t.container.querySelector("[role=alert]")?.textContent).toContain(
      "Não foi possível carregar a lista de aviamentos.",
    );
    expect(
      Array.from(t.container.querySelectorAll("button")).some(
        (b) => b.textContent === "Tentar de novo",
      ),
    ).toBe(true);
    expect(t.container.querySelector("tbody")).toBeNull();
    await t.desmontar();
  });

  it("carregando mostra 'Carregando…'", async () => {
    const { mocks } = await import("./aviamento-grade-harness");
    mocks();
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { AviamentosGradeAba } = await import("@/components/aviamento/grade/AviamentosGradeAba");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(AviamentosGradeAba, {}),
        ),
      );
    });
    expect(container.textContent).toContain("Carregando…");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("AviamentosGradeAba: foto não passa pelo rascunho", () => {
  it("as colunas Foto e Cor base/apelido existem só na linha da cor; o expandirTudo do harness é idempotente", async () => {
    const t = await montar(PROPS());
    await expandirTudo(t.container);
    const pai = linhas(t.container)[0];
    expect(pai.querySelector('td[data-col="foto"]')!.children).toHaveLength(0);
    expect(variantesUpdates).toHaveLength(0);
    await t.desmontar();
  });
});

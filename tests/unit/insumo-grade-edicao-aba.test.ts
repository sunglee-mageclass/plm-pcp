// @vitest-environment happy-dom
// Grade "Lista tipo Excel" de Cadastro > Insumos (IN-2): render de verdade da `InsumosGradeAba` com `supabase` mockado.
// Prova: cada insumo = 1 linha-pai (cabeçalho) + 1 linha por COR, NASCEM RECOLHIDOS e o chevron expande; o cabeçalho só existe/edita na
// linha-pai; editar só mexe no RASCUNHO (nada grava antes do Salvar); célula de TAMANHOS marca/desmarca e trava com formato "nenhum";
// tamanho vinculado só habilita quando o insumo não tem tamanho próprio; UM Salvar grava o cabeçalho por UPDATE DIRETO (sem rev) e as
// cores por delete-and-reinsert (cor × tamanhos); cor repetida e vínculo sem tamanho são recusados; 23505/23503 viram texto PT;
// ordenação por coluna; resultado parcial. O Select do Radix vira botões (a lógica testada é a da tela).
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { COLUNAS_INSUMO } from "@/lib/insumo-grade/colunas";
import {
  botaoSalvar,
  caixaTamanho,
  clicar,
  deletesVariantes,
  digitar,
  escolher,
  estado,
  flush,
  insertsVariantes,
  linhas,
  montar,
  ops,
  PROPS,
  porLabel,
  resetar,
  salvar,
  selos,
  sleep,
  seletor,
  toast,
  updates,
  insumo,
} from "./insumo-grade-harness";

beforeEach(() => resetar());

const pais = (c: HTMLElement) => linhas(c).filter((r) => r.dataset.pai !== undefined);
const filhos = (c: HTMLElement) => linhas(c).filter((r) => r.dataset.corIdx !== undefined);

describe("InsumosGradeAba: estrutura pai/filhos recolhível", () => {
  it("cada insumo = 1 linha-PAI (cabeçalho) + 1 linha por COR; o cabeçalho só aparece no pai; insumo sem cor = só a linha-pai", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    expect(trs.map((r) => (r.dataset.pai !== undefined ? "pai" : "cor"))).toEqual([
      "pai",
      "cor",
      "cor",
      "pai",
    ]);
    expect(porLabel(trs[0], "Nome de Insumo E1")).toHaveLength(1);
    expect(porLabel(trs[1], "Nome de Insumo E1")).toHaveLength(0); // as cores não repetem o cabeçalho
    expect(porLabel(trs[1], "Cor da cor de Insumo E1")).toHaveLength(1); // a cor edita só os campos da cor
    expect(porLabel(trs[1], "Tamanhos da cor de Insumo E1")).toHaveLength(1);
    expect(porLabel(trs[1], "Preço da cor da cor de Insumo E1")).toHaveLength(1);
    expect(trs[3].textContent).toContain("sem cores");
    // estado + as 11 colunas do catálogo
    expect(t.container.querySelectorAll("thead th").length).toBe(1 + 11);
    await t.desmontar();
  });

  it("NASCEM RECOLHIDOS: as cores só aparecem com o chevron / clique na linha-pai; recolher esconde de novo", async () => {
    const t = await montar(PROPS(), {}, false);
    const pai = () => pais(t.container)[0];
    expect(pai().hasAttribute("data-recolhido")).toBe(true);
    expect(filhos(t.container)).toHaveLength(0);
    expect(t.container.textContent).toContain("2 cores");
    const chevron = pai().querySelector('[data-acao="alternar-cores"]') as HTMLElement;
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    await clicar(chevron);
    expect(filhos(t.container)).toHaveLength(2);
    expect(pai().hasAttribute("data-recolhido")).toBe(false);
    // clicar numa célula "morta" da linha-pai também recolhe (o clique em campo editável NÃO)
    await clicar(pai().querySelector('td[data-col="cor"]'));
    expect(filhos(t.container)).toHaveLength(0);
    await clicar(porLabel(pai(), "Nome de Insumo E1")[0]);
    expect(filhos(t.container)).toHaveLength(0);
    await t.desmontar();
  });

  it("insumo sem cor não tem chevron (não há o que recolher)", async () => {
    const t = await montar(PROPS(), {}, false);
    expect(pais(t.container)[1].querySelector('[data-acao="alternar-cores"]')).toBeNull();
    await t.desmontar();
  });

  it("contagem 'N insumos · M cores' da lista recebida (singular/plural) e a ordem da lista da tela vale", async () => {
    const t = await montar([{ id: "E2" }, { id: "E1" }]);
    expect(pais(t.container).map((r) => r.dataset.insumoId)).toEqual(["E2", "E1"]);
    expect(t.container.textContent).toContain("2insumos");
    expect(t.container.textContent).toContain("2cores");
    await t.desmontar();
    const t2 = await montar([{ id: "E2" }]);
    expect(t2.container.textContent).toContain("1insumo");
    expect(t2.container.textContent).not.toContain("1insumos");
    expect(t2.container.textContent).toContain("0cores");
    await t2.desmontar();
  });

  it("scroll horizontal sempre visível (.scroll-x-visivel) e as colunas Estado + Nome ficam FIXAS (sticky)", async () => {
    const t = await montar(PROPS());
    const rolagem = t.container.querySelector(
      '[data-testid="insumos-grade-tabela"]',
    ) as HTMLElement;
    expect(rolagem.className).toContain("scroll-x-visivel");
    const th = t.container.querySelectorAll("thead th");
    expect(th[0].className).toContain("left-0");
    const nome = Array.from(th).find((x) => x.textContent === "Nome")!;
    expect(nome.className).toContain("sticky");
    expect(nome.className).toContain("left-10");
    for (const tr of [linhas(t.container)[0], linhas(t.container)[1]]) {
      expect(tr.querySelector("td")!.className).toContain("sticky");
      expect(tr.querySelector('td[data-col="nome"]')!.className).toContain("left-10");
    }
    await t.desmontar();
  });

  it("isMobile não desenha a tabela; leitura que falha mostra aviso e NUNCA a tabela vazia", async () => {
    const m = await montar(PROPS(), { isMobile: true }, false);
    expect(m.container.querySelector('[data-testid="insumos-grade-tabela"]')).toBeNull();
    await m.desmontar();
    estado.falhaTabela = "etiquetas";
    const t = await montar(PROPS(), {}, false);
    expect(t.container.querySelector("[role=alert]")).not.toBeNull();
    expect(t.container.textContent).toContain("Não foi possível carregar a lista de insumos.");
    expect(t.container.querySelector('[data-testid="insumos-grade-tabela"]')).toBeNull();
    await t.desmontar();
  });
});

describe("InsumosGradeAba: edição com rascunho (nada grava antes do Salvar)", () => {
  it("editar NÃO grava nada; mostra o selo âmbar na linha-pai e o botão Salvar (1)", async () => {
    const t = await montar(PROPS());
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Cartão Novo");
    expect(ops).toHaveLength(0);
    expect(pais(t.container)[0].querySelectorAll("[data-selo-nao-salvo]")).toHaveLength(1);
    expect(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0].value).toBe("Cartão Novo");
    expect(t.container.textContent).toContain("alterações não salvas");
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    // voltar ao valor original apaga o selo e esconde a barra
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Insumo E1");
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    await t.desmontar();
  });

  it("célula por tipo: select de unidade/tipo/formato vão ao rascunho do insumo e gravam no Salvar", async () => {
    const t = await montar(PROPS());
    const pai = () => pais(t.container)[0];
    await escolher(pai(), "Unidade de Insumo E1", "rolo");
    await escolher(pai(), "Tipo de Insumo E1", "tp2");
    await escolher(pai(), "Formato do tamanho de Insumo E1", "letra");
    expect(ops).toHaveLength(0);
    expect(seletor(pai(), "Unidade de Insumo E1")!.dataset.value).toBe("rolo");
    await salvar();
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("E1");
    expect(updates[0].payload).toEqual({
      unidade: "rolo",
      tipo_insumo_id: "tp2",
      formato_tamanho: "letra",
    });
    await t.desmontar();
  });

  it("Observações é textarea; limpar o Tipo grava null; nome só com espaço é recusado (nada grava)", async () => {
    const t = await montar(PROPS());
    const pai = () => pais(t.container)[0];
    expect(porLabel(pai(), "Observações de Insumo E1")[0].tagName).toBe("TEXTAREA");
    await digitar(porLabel(pai(), "Observações de Insumo E1")[0], "linha 1\nlinha 2");
    await escolher(pai(), "Tipo de Insumo E1", "__vazio__");
    await salvar();
    expect(updates[0].payload).toEqual({ observacoes: "linha 1\nlinha 2", tipo_insumo_id: null });
    await digitar(porLabel(pai(), "Nome de Insumo E1")[0], "   ");
    await salvar();
    expect(updates).toHaveLength(1); // o 2º Salvar foi recusado antes de gravar
    expect(toast.error).toHaveBeenCalled();
    expect(pai().querySelector("[data-erro-linha]")).not.toBeNull();
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await t.desmontar();
  });

  it("fornecedor: só os de insumo/etiqueta (+ o já salvo); escolher grava empresa_id e representante_id", async () => {
    const t = await montar(PROPS());
    const pai = () => pais(t.container)[0];
    const sel = seletor(pai(), "Fornecedor de Insumo E1")!;
    const itens = Array.from(sel.querySelectorAll("[data-item]")).map((b) =>
      b.getAttribute("data-item"),
    );
    expect(itens).toContain("E:emp1");
    expect(itens).toContain("R:rep1");
    expect(itens).not.toContain("E:emp2"); // fornecedor de tecido não aparece
    await clicar(sel.querySelector('[data-item="R:rep1"]'));
    await salvar();
    expect(updates[0].payload).toEqual({ empresa_id: "emp1", representante_id: "rep1" });
    await t.desmontar();
  });
});

describe("InsumosGradeAba: célula de TAMANHOS e tamanho vinculado", () => {
  it("TAMANHOS: o popover mostra a grade da loja; marcar/desmarcar vai ao rascunho da COR e o selo aparece só nela", async () => {
    const t = await montar(PROPS());
    const cor = (i: number) => filhos(t.container)[i];
    const trigger = (i: number) => porLabel(cor(i), "Tamanhos da cor de Insumo E1")[0];
    expect(trigger(0).textContent).toContain("PPP · 34");
    expect(trigger(0).textContent).toContain("PP · 36");
    expect(trigger(1).textContent).not.toContain("·");
    await clicar(trigger(1)); // a cor Verde não tem tamanho
    expect(caixaTamanho("M · 40")).not.toBeNull();
    expect(caixaTamanho("GG · 44")).not.toBeNull();
    await clicar(caixaTamanho("M · 40"));
    await clicar(caixaTamanho("G · 42"));
    expect(trigger(1).textContent).toContain("M · 40, G · 42"); // na ordem da grade, não do clique
    expect(cor(1).querySelectorAll("[data-selo-nao-salvo]")).toHaveLength(1);
    expect(cor(0).querySelectorAll("[data-selo-nao-salvo]")).toHaveLength(0);
    expect(ops).toHaveLength(0);
    // desmarcar um e voltar ao original apaga o selo
    await clicar(caixaTamanho("M · 40"));
    await clicar(caixaTamanho("G · 42"));
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    await t.desmontar();
  });

  it("formato 'Nenhum' DESABILITA a célula de tamanhos de todas as cores (e o formato ≠ nenhum a reabilita)", async () => {
    const t = await montar(PROPS());
    const trigger = (i: number) =>
      porLabel(filhos(t.container)[i], "Tamanhos da cor de Insumo E1")[0];
    expect(trigger(0).disabled).toBe(false);
    await escolher(pais(t.container)[0], "Formato do tamanho de Insumo E1", "nenhum");
    expect(trigger(0).disabled).toBe(true);
    expect(trigger(1).disabled).toBe(true);
    expect(trigger(0).title).toContain("Nenhum");
    await escolher(pais(t.container)[0], "Formato do tamanho de Insumo E1", "ambos");
    expect(trigger(0).disabled).toBe(false);
    await t.desmontar();
  });

  it("TAMANHO VINCULADO só habilita quando o insumo não tem tamanho próprio (formato nenhum OU nenhuma cor com tamanho)", async () => {
    const t = await montar(PROPS());
    const vinc = () => seletor(pais(t.container)[0], "Tamanho vinculado de Insumo E1")!;
    const itensTravados = () =>
      Array.from(vinc().querySelectorAll("[data-item]")).every(
        (b) => (b as HTMLButtonElement).disabled,
      );
    expect(itensTravados()).toBe(true); // a cor Azul tem tamanhos próprios
    await escolher(pais(t.container)[0], "Formato do tamanho de Insumo E1", "nenhum");
    expect(itensTravados()).toBe(false);
    // opções = "Sem vínculo" + a grade da loja
    const itens = Array.from(vinc().querySelectorAll("[data-item]")).map((b) =>
      b.getAttribute("data-item"),
    );
    expect(itens).toEqual(["__vazio__", "34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"]);
    await t.desmontar();
  });

  it("Salvar do vínculo grava `tamanho_vinculado`; 'Sem vínculo' grava null; o vínculo já salvo fora da grade vira opção extra", async () => {
    estado.etiquetas = [insumo("E1", { formato_tamanho: "nenhum", tamanho_vinculado: "99|XX" })];
    estado.variantes = [];
    const t = await montar([{ id: "E1" }]);
    const vinc = () => seletor(pais(t.container)[0], "Tamanho vinculado de Insumo E1")!;
    expect(vinc().dataset.value).toBe("99|XX");
    expect(
      Array.from(vinc().querySelectorAll("[data-item]")).map((b) => b.getAttribute("data-item")),
    ).toContain("99|XX");
    await escolher(pais(t.container)[0], "Tamanho vinculado de Insumo E1", "40|M");
    await salvar();
    expect(updates[0].payload).toEqual({ tamanho_vinculado: "40|M" });
    await escolher(pais(t.container)[0], "Tamanho vinculado de Insumo E1", "__vazio__");
    await salvar();
    expect(updates[1].payload).toEqual({ tamanho_vinculado: null });
    expect(deletesVariantes).toHaveLength(0); // sem cor mexida, nenhuma variante é regravada
    await t.desmontar();
  });
});

describe("InsumosGradeAba: UM Salvar (cabeçalho + cores)", () => {
  it("cabeçalho = UPDATE direto sem rev; cores só mudam o que a pessoa mexeu: delete-and-reinsert das variantes (cor × tamanhos)", async () => {
    const t = await montar(PROPS());
    // 1) só o cabeçalho: nenhuma variante é regravada
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Cartão Novo");
    await salvar();
    expect(ops).toEqual(["etiquetas.update:E1"]);
    expect(updates[0].payload).toEqual({ nome: "Cartão Novo" });
    expect(Object.keys(updates[0].payload)).not.toContain("rev");
    expect(toast.success).toHaveBeenCalledWith("1 salvo.");
    ops.length = 0;
    // 2) só a cor: marca o tamanho M na cor Verde (o nome do insumo já é o novo)
    await clicar(porLabel(filhos(t.container)[1], "Tamanhos da cor de Cartão Novo")[0]);
    await clicar(caixaTamanho("M · 40"));
    await salvar();
    expect(ops).toEqual(["variantes.delete:E1", "variantes.insert:E1:3"]); // azul×2 + verde×1, sem update do cabeçalho
    expect(insertsVariantes[0].linhas).toEqual([
      { tamanho: "34|PPP", cor_id: "azul", preco: 2, etiqueta_id: "E1" },
      { tamanho: "36|PP", cor_id: "azul", preco: 2, etiqueta_id: "E1" },
      { tamanho: "40|M", cor_id: "verde", preco: 3, etiqueta_id: "E1" },
    ]);
    // a grade foi relida: nada fica sujo
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    await t.desmontar();
  });

  it("cabeçalho E cores no mesmo Salvar: UPDATE do cabeçalho ANTES da regravação das variantes", async () => {
    const t = await montar(PROPS());
    await escolher(pais(t.container)[0], "Unidade de Insumo E1", "metro");
    await escolher(filhos(t.container)[0], "Cor da cor de Insumo E1", "preto");
    await salvar();
    expect(ops).toEqual(["etiquetas.update:E1", "variantes.delete:E1", "variantes.insert:E1:3"]);
    expect(insertsVariantes[0].linhas.map((l) => l.cor_id)).toEqual(["preto", "preto", "verde"]);
    await t.desmontar();
  });

  it("formato 'Nenhum' no Salvar: as cores valem SEM tamanho (1 variante por cor) e o vínculo pode ser gravado junto", async () => {
    const t = await montar(PROPS());
    await escolher(pais(t.container)[0], "Formato do tamanho de Insumo E1", "nenhum");
    await escolher(pais(t.container)[0], "Tamanho vinculado de Insumo E1", "42|G");
    await salvar();
    expect(updates[0].payload).toEqual({ formato_tamanho: "nenhum", tamanho_vinculado: "42|G" });
    expect(insertsVariantes[0].linhas).toEqual([
      { tamanho: null, cor_id: "azul", preco: 2, etiqueta_id: "E1" },
      { tamanho: null, cor_id: "verde", preco: 3, etiqueta_id: "E1" },
    ]);
    await t.desmontar();
  });

  it("COR REPETIDA no insumo: a célula fica em vermelho e o Salvar recusa tudo (nada grava), com o aviso na linha e as cores abertas", async () => {
    const t = await montar(PROPS());
    await escolher(filhos(t.container)[1], "Cor da cor de Insumo E1", "azul");
    const celula = () =>
      Array.from(
        filhos(t.container)[1].querySelectorAll('[aria-label="Cor da cor de Insumo E1"]'),
      )[0];
    expect(celula().getAttribute("aria-invalid")).toBe("true");
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Outro nome");
    await salvar();
    expect(ops).toHaveLength(0); // nem o cabeçalho gravou: a validação vem antes
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("1 com erro"));
    expect(pais(t.container)[0].querySelector("[data-erro-linha]")).not.toBeNull();
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    // concertar a cor tira o problema e o Salvar passa
    await escolher(filhos(t.container)[1], "Cor da cor de Insumo E1", "preto");
    await salvar();
    expect(ops).toEqual(["etiquetas.update:E1", "variantes.delete:E1", "variantes.insert:E1:3"]);
    await t.desmontar();
  });

  it("23505 do nome e 23503 da variante em uso viram texto PT; a falha do INSERT restaura as variantes de antes", async () => {
    estado.nomeRepetido.add("E1");
    const t = await montar(PROPS());
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Etiqueta Zeta");
    await salvar();
    expect(pais(t.container)[0].querySelector("[data-erro-linha]")!.getAttribute("title")).toBe(
      "Já existe um insumo com esse nome.",
    );
    expect(toast.error).toHaveBeenCalled();
    await t.desmontar();

    resetar();
    estado.varianteEmUso.add("E1");
    const t2 = await montar(PROPS());
    await escolher(filhos(t2.container)[0], "Cor da cor de Insumo E1", "preto");
    await salvar();
    expect(
      pais(t2.container)[0].querySelector("[data-erro-linha]")!.getAttribute("title"),
    ).toContain("em uso");
    await t2.desmontar();

    resetar();
    estado.falhaInsertVariantes = { code: "23505", message: "dup" };
    const t3 = await montar(PROPS());
    await escolher(filhos(t3.container)[0], "Cor da cor de Insumo E1", "preto");
    await salvar();
    expect(
      pais(t3.container)[0].querySelector("[data-erro-linha]")!.getAttribute("title"),
    ).toContain("cor e tamanho");
    // delete + insert que falhou + restauração das 3 variantes de antes
    expect(ops).toEqual(["variantes.delete:E1", "variantes.insert:E1:3"]);
    expect(estado.variantes.filter((v) => v.etiqueta_id === "E1")).toHaveLength(3);
    expect(estado.variantes.filter((v) => v.cor_id === "preto")).toHaveLength(0);
    await t3.desmontar();
  });

  it("insumo que sumiu (excluído por outra pessoa): aviso na linha, sem derrubar o resto", async () => {
    estado.sumiu.add("E1");
    const t = await montar(PROPS());
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "X");
    await digitar(porLabel(pais(t.container)[1], "Nome de Etiqueta Zeta")[0], "Y");
    await salvar();
    expect(
      pais(t.container)[0].querySelector("[data-erro-linha]")!.getAttribute("title"),
    ).toContain("não foi encontrado");
    expect(updates.map((u) => u.id)).toEqual(["E2"]);
    await t.desmontar();
  });

  it("RESULTADO PARCIAL: 1 salvo + 1 com erro (aviso), o que falhou fica sujo e o que gravou limpa", async () => {
    estado.nomeRepetido.add("E1");
    const t = await montar(PROPS());
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Repetido");
    await digitar(porLabel(pais(t.container)[1], "Nome de Etiqueta Zeta")[0], "Etiqueta Nova");
    expect(botaoSalvar()?.textContent).toContain("Salvar (2)");
    await salvar();
    expect(toast.warning).toHaveBeenCalledWith("1 salvo, 1 com erro. Veja o aviso na linha.");
    expect(updates.map((u) => u.id)).toEqual(["E2"]);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    expect(pais(t.container)[1].querySelector("[data-selo-nao-salvo]")).toBeNull();
    expect(pais(t.container)[0].querySelector("[data-erro-linha]")).not.toBeNull();
    await t.desmontar();
  });

  it("Descartar alterações (com confirmação) volta tudo ao salvo e avisa a tela-mãe", async () => {
    const mudancas: boolean[] = [];
    const t = await montar(PROPS(), { onDirtyChange: (s: boolean) => mudancas.push(s) });
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Mudou");
    expect(mudancas[mudancas.length - 1]).toBe(true);
    const descartar = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Descartar alterações"),
    ) as HTMLButtonElement;
    await clicar(descartar);
    const confirmar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "Descartar",
    ) as HTMLButtonElement;
    await clicar(confirmar);
    await flush();
    expect(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0].value).toBe("Insumo E1");
    expect(mudancas[mudancas.length - 1]).toBe(false);
    expect(ops).toHaveLength(0);
    await t.desmontar();
  });
});

describe("InsumosGradeAba: ordenação por coluna", () => {
  const nomes = (c: HTMLElement) =>
    pais(c).map((r) => (r.querySelector('td[data-col="nome"] input') as HTMLInputElement).value);
  it("clicar no cabeçalho ordena os insumos (asc → desc) e as cores ficam juntas do seu insumo", async () => {
    const t = await montar(PROPS());
    expect(nomes(t.container)).toEqual(["Insumo E1", "Etiqueta Zeta"]);
    const th = Array.from(t.container.querySelectorAll("thead th")).find((x) =>
      x.textContent?.startsWith("Nome"),
    ) as HTMLElement;
    await clicar(th.querySelector("button") ?? th);
    expect(nomes(t.container)).toEqual(["Etiqueta Zeta", "Insumo E1"]); // asc
    expect(linhas(t.container).map((r) => (r.dataset.pai !== undefined ? "pai" : "cor"))).toEqual([
      "pai",
      "pai",
      "cor",
      "cor",
    ]);
    await clicar(th.querySelector("button") ?? th);
    expect(nomes(t.container)).toEqual(["Insumo E1", "Etiqueta Zeta"]); // desc
    await t.desmontar();
  });

  it("ordenar NÃO mexe no que foi digitado nem na associação cor ↔ rascunho", async () => {
    const t = await montar(PROPS());
    await escolher(filhos(t.container)[1], "Cor da cor de Insumo E1", "preto"); // verde → preto
    const th = Array.from(t.container.querySelectorAll("thead th")).find((x) =>
      x.textContent?.startsWith("Cor"),
    ) as HTMLElement;
    await clicar(th.querySelector("button") ?? th);
    await clicar(th.querySelector("button") ?? th); // desc
    await salvar();
    expect(insertsVariantes[0].linhas.map((l) => l.cor_id)).toEqual(["azul", "azul", "preto"]);
    await t.desmontar();
  });
});

describe("InsumosGradeAba: teclado", () => {
  it("Enter no Nome desce para o Nome do próximo insumo (pulando a linha da cor, que não tem campo de texto); Tab vai à célula ao lado", async () => {
    const t = await montar(PROPS());
    const nome1 = porLabel(pais(t.container)[0], "Nome de Insumo E1")[0];
    const nome2 = porLabel(pais(t.container)[1], "Nome de Etiqueta Zeta")[0];
    expect(nome1.getAttribute("data-grade-cel")).toBe("0:0");
    expect(nome2.getAttribute("data-grade-cel")).toBe("3:0"); // pai + 2 cores = 3 linhas antes
    await act(async () => {
      nome1.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await sleep(40);
    });
    expect(document.activeElement).toBe(nome2);
    // o preço da cor também tem endereço (linha da cor, coluna "preco_variante")
    const precoCor = porLabel(filhos(t.container)[0], "Preço da cor da cor de Insumo E1")[0];
    expect(precoCor.getAttribute("data-grade-cel")).toBe(
      `1:${COLUNAS_INSUMO.findIndex((c) => c.key === "preco_variante")}`,
    );
    await t.desmontar();
  });
});

describe("InsumosGradeAba: guarda de troca de visão", () => {
  it("guarda de troca: ao desmontar com rascunho a tela-mãe é avisada de que ficou limpo (o rascunho some junto)", async () => {
    const mudancas: boolean[] = [];
    const t = await montar(PROPS(), { onDirtyChange: (s: boolean) => mudancas.push(s) });
    await digitar(porLabel(pais(t.container)[0], "Nome de Insumo E1")[0], "Sujo");
    expect(mudancas.at(-1)).toBe(true);
    await t.desmontar();
    expect(mudancas.at(-1)).toBe(false);
    await flush(10);
  });
});

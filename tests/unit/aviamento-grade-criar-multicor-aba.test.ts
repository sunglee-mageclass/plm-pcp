// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (harness da grade de Aviamentos) */
// Grade "Lista" de Aviamentos (AV-3), render real da `AviamentosGradeAba` com `supabase` mockado.
// CRIAR: "+ Novo aviamento" / "+ adicionar variante (cor)" montam linhas NOVAS em RASCUNHO (nada grava antes do Salvar); o UM Salvar manda
// cada grupo VÁLIDO por `importar_aviamento_linha` (SEM `codigo`, alvo null), depois dos editados; incompleto = PENDENTE (vermelho) e
// não trava os outros. MULTI-COR na linha-pai: só ADICIONA, preço herdado do aviamento, cores presentes travadas.
import { describe, it, expect, beforeEach } from "vitest";
import {
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
  selos,
  seletor,
  toast,
} from "./aviamento-grade-harness";

beforeEach(() => resetar());

const novoGrupos = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("[data-linha-nova]")) as HTMLElement[];
const botaoTexto = (txt: string, raiz: ParentNode = document.body) =>
  Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.includes(txt)) as
    | HTMLButtonElement
    | undefined;
const escolher = (raiz: ParentNode, label: string, valor: string) =>
  clicar(seletor(raiz, label)!.querySelector(`[data-item="${valor}"]`));
const importarRpcs = () => rpc.mock.calls.filter((c) => c[0] === "importar_aviamento_linha");
const caixaCor = (nome: string) =>
  document.body.querySelector(`[role="checkbox"][aria-label="Cor ${nome}"]`) as HTMLElement | null;

describe("Criar na grade", () => {
  it("'+ Novo aviamento' cria um grupo em RASCUNHO (selo de novo, Salvar habilitado); NADA vai ao servidor antes do Salvar", async () => {
    const t = await montar(PROPS());
    expect(botaoSalvar()).toBeUndefined();
    await clicar(botaoTexto("Novo aviamento"));
    expect(novoGrupos(t.container)).toHaveLength(1);
    expect(t.container.querySelectorAll("[data-selo-novo]")).toHaveLength(1);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await digitar(porLabel(t.container, "Nome do aviamento novo")[0], "Botão Novo");
    expect(importarRpcs()).toHaveLength(0);
    expect(aviamentoUpdates).toHaveLength(0);
    // o código NÃO se digita: o servidor gera (a célula só explica)
    expect(
      t.container.querySelector('[data-linha-nova] [data-col="codigo"]')!.textContent,
    ).toContain("sem categoria");
    await t.desmontar();
  });

  it("Salvar manda `importar_aviamento_linha` SEM `codigo` (alvo null), com categoria/fornecedor/preço/cor; o grupo sai do rascunho e o aviamento aparece", async () => {
    const t = await montar(undefined); // sem filtro da tela: a lista relida mostra o aviamento recém-criado
    await clicar(botaoTexto("Novo aviamento"));
    await digitar(porLabel(t.container, "Nome do aviamento novo")[0], "Botão Novo");
    await escolher(t.container, "Categoria do aviamento novo", "cat1");
    await escolher(t.container, "Fornecedor do aviamento novo", "E:emp1");
    await digitar(porLabel(t.container, "Preço do aviamento novo")[0], "2,50");
    await escolher(t.container, "Cor base da cor 1 do aviamento novo", "cor1");
    expect(
      t.container.querySelector('[data-linha-nova] [data-col="codigo"]')!.textContent,
    ).toContain("automático");
    expect(importarRpcs()).toHaveLength(0);

    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs()).toHaveLength(1);
    const args = importarRpcs()[0][1];
    expect(args._aviamento_alvo_id).toBeNull();
    expect("codigo" in args._cabecalho).toBe(false);
    expect(args._cabecalho).toMatchObject({
      codigo_nome: "Botão Novo",
      categoria_aviamento_id: "cat1",
      empresa_id: "emp1",
      preco: 2.5,
    });
    expect(args._variantes).toEqual([
      {
        cor_id: "cor1",
        cor_apelido_id: null,
        nome_variante: null,
        codigo_variante: null,
        preco: null,
      },
    ]);
    expect(novoGrupos(t.container)).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("1 salvo.");
    expect(t.container.querySelector('[data-grupo-aviamento="novo-3"]')).not.toBeNull(); // relido: já é uma linha cadastrada
    await t.desmontar();
  });

  it("'+ adicionar variante (cor)' no grupo novo: cores 2+ herdam o cabeçalho ('↳ mesmo aviamento'); vão todas na MESMA chamada", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo aviamento"));
    await digitar(porLabel(t.container, "Nome do aviamento novo")[0], "Botão Duas");
    await escolher(t.container, "Cor base da cor 1 do aviamento novo", "cor1");
    await clicar(botaoTexto("adicionar variante (cor)", t.container));
    const g = novoGrupos(t.container);
    expect(g).toHaveLength(2);
    expect(g[1].textContent).toContain("↳ mesmo aviamento");
    expect(porLabel(g[1], "Nome do aviamento novo")).toHaveLength(0);
    await escolher(g[1], "Cor base da cor 2 do aviamento novo", "cor2");
    await digitar(porLabel(g[1], "Preço da variante da cor 2 do aviamento novo")[0], "3,00");
    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs()).toHaveLength(1);
    expect(importarRpcs()[0][1]._variantes.map((v: any) => [v.cor_id, v.preco])).toEqual([
      ["cor1", null],
      ["cor2", 3],
    ]);
    await t.desmontar();
  });

  it("SEM cor base (ou sem nome) = PENDENTE: fica em vermelho, não vai ao servidor e não trava os outros; sem categoria o toast avisa que fica sem código", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo aviamento"));
    await clicar(botaoTexto("Novo aviamento"));
    const [a, b] = Array.from(t.container.querySelectorAll("[data-grupo-novo]")) as HTMLElement[];
    await digitar(porLabel(a, "Nome do aviamento novo")[0], "Bom"); // sem categoria
    await escolher(a, "Cor base da cor 1 do aviamento novo", "cor1");
    await digitar(porLabel(b, "Nome do aviamento novo")[0], "Sem cor"); // sem cor base
    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs().map((c) => c[1]._cabecalho.codigo_nome)).toEqual(["Bom"]);
    expect(novoGrupos(t.container)).toHaveLength(1); // só a pendente ficou
    const msg = String(toast.warning.mock.calls.at(-1)?.[0]);
    expect(msg).toContain("pendente");
    expect(msg).toContain("sem código");
    expect(
      novoGrupos(t.container)[0].querySelector('[aria-label^="Não vai ser salva"]'),
    ).not.toBeNull();
    expect(
      porLabel(novoGrupos(t.container)[0], "Cor base da cor 1 do aviamento novo"),
    ).toHaveLength(1);
    await t.desmontar();
  });

  it("erro do servidor na criação fica na linha, em PT, e o rascunho NÃO se perde; os editados salvam antes dos novos", async () => {
    estado.erroImportar = { message: "Informe o nome do aviamento.", code: "P0001" } as any;
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "NCM de Botão")[0], "9606");
    await clicar(botaoTexto("Novo aviamento"));
    await digitar(porLabel(t.container, "Nome do aviamento novo")[0], "Botão Novo");
    await escolher(t.container, "Cor base da cor 1 do aviamento novo", "cor1");
    await clicar(botaoSalvar());
    await flush(80);
    expect(ordem[0]).toBe("aviamentos.update:av1"); // editado ANTES do novo
    expect(novoGrupos(t.container)).toHaveLength(1);
    expect(t.container.querySelector("[data-erro-linha]")!.getAttribute("title")).toContain(
      "nome do aviamento",
    );
    expect(toast.warning).toHaveBeenCalled(); // 1 salvo + 1 com erro
    await t.desmontar();
  });

  it("nome + fornecedor que JÁ existem: o Salvar recusa o grupo (a RPC sobrescreveria o cabeçalho do existente) e manda usar o +", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo aviamento"));
    await digitar(porLabel(t.container, "Nome do aviamento novo")[0], "BOTÃO"); // av1 "Botão" / emp1
    await escolher(t.container, "Fornecedor do aviamento novo", "E:emp1");
    await escolher(t.container, "Cor base da cor 1 do aviamento novo", "cor2");
    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs()).toHaveLength(0);
    expect(t.container.querySelector("[data-erro-linha]")!.getAttribute("title")).toContain(
      "Já existe um aviamento",
    );
    await t.desmontar();
  });

  it("Descartar alterações limpa também as linhas novas; descartar o grupo novo / a cor só tira do rascunho", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo aviamento"));
    await clicar(botaoTexto("adicionar variante (cor)", t.container));
    await clicar(t.container.querySelector('[data-variante-nova] [aria-label="Remover esta cor"]'));
    expect(novoGrupos(t.container)).toHaveLength(1);
    await clicar(botaoTexto("Descartar aviamento novo", t.container));
    expect(novoGrupos(t.container)).toHaveLength(0);
    await clicar(botaoTexto("Novo aviamento"));
    await clicar(botaoTexto("Descartar alterações"));
    await flush(20);
    await clicar(
      Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find(
        (b) => b.textContent === "Descartar",
      ),
    );
    await flush(20);
    expect(novoGrupos(t.container)).toHaveLength(0);
    expect(rpc.mock.calls.filter((c) => c[0] === "importar_aviamento_linha")).toHaveLength(0);
    await t.desmontar();
  });
});

describe("'+ cor' e multi-cor num aviamento EXISTENTE", () => {
  it("'+ cor' cria 1 grupo-alvo por aviamento; Salvar manda só o nome no cabeçalho + o alvo (aviamento 'complementado')", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Adicionar cor em Zíper"]')); // av2, sem cores
    expect(t.container.querySelector('[aria-label="Adicionar cor em Zíper"]')).toBeNull(); // some enquanto há cor nova pendente
    await escolher(t.container, "Cor base da cor nova 1 de Zíper", "cor2");
    await clicar(botaoSalvar());
    await flush(80);
    const args = importarRpcs()[0][1];
    expect(args._aviamento_alvo_id).toBe("av2");
    expect(args._cabecalho).toEqual({ codigo_nome: "Zíper" });
    expect(args._variantes.map((v: any) => v.cor_id)).toEqual(["cor2"]);
    expect(novoGrupos(t.container)).toHaveLength(0);
    expect(estado.variantes.filter((v) => v.aviamento_id === "av2")).toHaveLength(1);
    await t.desmontar();
  });

  it("multi-cor da linha-pai: cores que o aviamento já tem vêm marcadas+travadas; as novas herdam o PREÇO do aviamento; Salvar manda o alvo", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Adicionar várias cores em Botão"]'));
    await flush(20);
    expect(caixaCor("Azul")!.getAttribute("data-state")).toBe("checked");
    expect(caixaCor("Azul")!.hasAttribute("disabled")).toBe(true);
    expect(caixaCor("Verde")!.hasAttribute("disabled")).toBe(true);
    await t.desmontar();
  });

  it("multi-cor em aviamento SEM cores (linha 'sem cor' = linha-pai): marcar cria cor nova com o preço herdado, só adiciona", async () => {
    // cores do mock: só Azul/Verde — o aviamento sem cores (Zíper, preço 2) recebe as duas
    const t = await montar(PROPS());
    const gatilho = t.container.querySelector('[aria-label="Adicionar várias cores em Zíper"]');
    expect(gatilho).not.toBeNull();
    await clicar(gatilho);
    await flush(20);
    expect(caixaCor("Azul")!.hasAttribute("disabled")).toBe(false);
    await clicar(caixaCor("Azul"));
    await clicar(caixaCor("Verde"));
    await clicar(botaoTexto("Adicionar 2 cores"));
    await flush(20);
    const g = novoGrupos(t.container);
    expect(g).toHaveLength(2);
    expect(porLabel(g[1], "Preço da variante da cor nova 2 de Zíper")[0].value).toBe("2,00"); // herdado do aviamento
    expect(importarRpcs()).toHaveLength(0); // rascunho
    await clicar(botaoSalvar());
    await flush(80);
    const args = importarRpcs()[0][1];
    expect(args._aviamento_alvo_id).toBe("av2");
    expect(args._variantes.map((v: any) => [v.cor_id, v.preco])).toEqual([
      ["cor1", 2],
      ["cor2", 2],
    ]);
    await t.desmontar();
  });

  it("multi-cor em aviamento NOVO: 2 cores = as linhas do grupo com o preço do cabeçalho; a cor que o grupo já tem não duplica", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo aviamento"));
    await digitar(porLabel(t.container, "Nome do aviamento novo")[0], "Multi");
    await digitar(porLabel(t.container, "Preço do aviamento novo")[0], "7,00");
    await escolher(t.container, "Cor base da cor 1 do aviamento novo", "cor1");
    await clicar(
      t.container.querySelector('[aria-label="Adicionar várias cores do aviamento novo"]'),
    );
    await flush(20);
    expect(caixaCor("Azul")!.hasAttribute("disabled")).toBe(true);
    await clicar(caixaCor("Verde"));
    await clicar(botaoTexto("Adicionar 1 cor"));
    await flush(20);
    const g = novoGrupos(t.container);
    expect(g).toHaveLength(2);
    expect(porLabel(g[1], "Preço da variante da cor 2 do aviamento novo")[0].value).toBe("7,00");
    expect(
      g[1].querySelector('[aria-label="Adicionar várias cores do aviamento novo"]'),
    ).toBeNull(); // só o pai tem o multi
    await t.desmontar();
  });

  it("Salvar com cor nova num aviamento editado: edita primeiro, depois acrescenta a cor; o conjunto de cores do lote não apaga a recém-criada", async () => {
    const t = await montar(PROPS());
    await digitar(
      porLabel(linhas(t.container)[1], "Nome da variante da cor de Botão")[0],
      "Azul royal",
    );
    await clicar(t.container.querySelector('[aria-label="Adicionar cor em Botão"]'));
    await escolher(t.container, "Cor base da cor nova 1 de Botão", "cor1"); // mesma cor+apelido que v1 já tem
    await clicar(botaoSalvar());
    await flush(80);
    expect(ordem.indexOf("rpc:variantes")).toBeLessThan(
      ordem.findIndex((o) => o.startsWith("rpc:importar")),
    );
    // a RPC não acha novidade (a cor já existe): vira erro PT na linha nova, sem fingir que salvou
    expect(t.container.querySelector("[data-erro-linha]")!.getAttribute("title")).toContain(
      "já existe",
    );
    expect(selos(t.container)).toBe(0); // o editado gravou
    await t.desmontar();
  });
});

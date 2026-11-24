// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (harness da grade de Insumos) */
// Grade "Lista" de Insumos (IN-3), render real da `InsumosGradeAba` com `supabase` mockado.
// CRIAR: "+ Novo insumo" / "+ cor" montam linhas NOVAS em RASCUNHO (nada grava antes do Salvar); o UM Salvar manda cada grupo VÁLIDO por
// `importar_insumo_linha` (variantes EXPANDIDAS por cor × tamanho), depois dos editados; incompleto = PENDENTE (vermelho) e não trava os outros.
// COLAR: bloco TSV na célula-âncora vira RASCUNHO (nada grava), resolve pelo NOME; texto sem correspondência NÃO grava e avisa na célula;
// linhas além do fim criam insumos NOVOS. EXCLUIR (lixeira única por linha): o INSUMO pede confirmação e grava NA HORA (DELETE direto;
// 23503 vira texto PT); a COR só sai do rascunho (o Salvar regrava as cores sem ela).
import { describe, it, expect, beforeEach } from "vitest";
import {
  botaoSalvar,
  caixaTamanho,
  clicar,
  deletesVariantes,
  digitar,
  escolher,
  estado,
  etiquetaDeletes,
  flush,
  insertsVariantes,
  linhas,
  montar,
  ops,
  PROPS,
  porLabel,
  resetar,
  rpc,
  salvar,
  seletor,
  toast,
  updates,
} from "./insumo-grade-harness";

beforeEach(() => resetar());

const grupos = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("[data-linha-nova]")) as HTMLElement[];
const botaoTexto = (txt: string, raiz: ParentNode = document.body) =>
  Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.includes(txt)) as
    | HTMLButtonElement
    | undefined;
const importarRpcs = () => rpc.mock.calls.filter((c) => c[0] === "importar_insumo_linha");
const dialogo = () => document.body.querySelector('[role="alertdialog"]') as HTMLElement | null;
const botaoDialogo = (txt: string) =>
  Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find(
    (b) => b.textContent === txt,
  ) as HTMLButtonElement;
const valorSelect = (raiz: ParentNode, label: string) =>
  seletor(raiz, label)?.getAttribute("data-value") ?? undefined;
const pais = (c: HTMLElement) => linhas(c).filter((r) => r.dataset.pai !== undefined);
const filhos = (c: HTMLElement) => linhas(c).filter((r) => r.dataset.corIdx !== undefined);

/** Dispara um Ctrl+V com `texto` no elemento (o evento sobe até a tabela). */
async function colar(el: Element, texto: string) {
  const { act } = await import("react");
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  (ev as any).clipboardData = { getData: (t: string) => (t === "text/plain" ? texto : "") };
  await act(async () => {
    el.dispatchEvent(ev);
  });
  return ev;
}

/** Preenche o insumo novo (1ª linha do grupo): nome + cor + tamanhos (rótulos "PPP · 34") + preço da cor. */
async function preencherNovo(
  t: { container: HTMLElement },
  o: { nome: string; cor?: string; tamanhos?: string[]; precoCor?: string; idx?: number },
) {
  const idx = o.idx ?? 1;
  await digitar(porLabel(t.container, "Nome do insumo novo")[0], o.nome);
  if (o.cor) await escolher(t.container, `Cor da cor ${idx} do insumo novo`, o.cor);
  for (const tam of o.tamanhos ?? []) {
    if (tam === (o.tamanhos ?? [])[0])
      await clicar(porLabel(t.container, `Tamanhos da cor ${idx} do insumo novo`)[0]);
    await clicar(caixaTamanho(tam));
  }
  if (o.precoCor)
    await digitar(
      porLabel(t.container, `Preço da cor da cor ${idx} do insumo novo`)[0],
      o.precoCor,
    );
}

describe("Criar na grade", () => {
  it("'+ Novo insumo' cria um grupo em RASCUNHO (selo de novo, Salvar habilitado); NADA vai ao servidor antes do Salvar", async () => {
    const t = await montar(PROPS());
    expect(botaoSalvar()).toBeUndefined();
    await clicar(botaoTexto("Novo insumo"));
    expect(grupos(t.container)).toHaveLength(1);
    expect(t.container.querySelectorAll("[data-selo-novo]")).toHaveLength(1);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await digitar(porLabel(t.container, "Nome do insumo novo")[0], "Cartão Novo");
    expect(importarRpcs()).toHaveLength(0);
    expect(ops).toHaveLength(0);
    await t.desmontar();
  });

  it("Salvar manda `importar_insumo_linha` (alvo null) com as variantes EXPANDIDAS cor × tamanho; o grupo sai do rascunho e o insumo aparece", async () => {
    const t = await montar(undefined); // sem filtro da tela: a lista relida mostra o insumo recém-criado
    await clicar(botaoTexto("Novo insumo"));
    await escolher(t.container, "Tipo do insumo novo", "tp2");
    await escolher(t.container, "Unidade do insumo novo", "milheiro");
    await preencherNovo(t, {
      nome: "Cartão Novo",
      cor: "azul",
      tamanhos: ["PPP · 34", "PP · 36"],
      precoCor: "0,50",
    });
    await salvar();
    expect(importarRpcs()).toHaveLength(1);
    const args = importarRpcs()[0][1] as any;
    expect(args._etiqueta_alvo_id).toBeNull();
    expect(args._cabecalho).toMatchObject({
      nome: "Cartão Novo",
      tipo_insumo_id: "tp2",
      unidade: "milheiro",
    });
    expect("tamanho_vinculado" in args._cabecalho).toBe(false);
    expect(args._variantes).toEqual([
      { cor_id: "azul", tamanho: "34|PPP", preco: 0.5 },
      { cor_id: "azul", tamanho: "36|PP", preco: 0.5 },
    ]);
    expect(toast.success).toHaveBeenCalledWith("1 salvo.");
    expect(grupos(t.container)).toHaveLength(0);
    expect(botaoSalvar()).toBeUndefined();
    expect(porLabel(t.container, "Nome de Cartão Novo")).toHaveLength(1); // o insumo criado já está na lista
    await t.desmontar();
  });

  it("'+ adicionar cor' no grupo novo: cabeçalho herdado ('↳ mesmo insumo') nas cores 2+; as 2 cores vão na MESMA chamada", async () => {
    const t = await montar(undefined);
    await clicar(botaoTexto("Novo insumo"));
    await clicar(botaoTexto("adicionar cor", t.container));
    const trs = grupos(t.container);
    expect(trs).toHaveLength(2);
    expect(trs[1].textContent).toContain("mesmo insumo");
    expect(porLabel(trs[1], "Nome do insumo novo")).toHaveLength(0);
    await digitar(porLabel(t.container, "Nome do insumo novo")[0], "Botão Duplo");
    await escolher(t.container, "Cor da cor 1 do insumo novo", "azul");
    await escolher(t.container, "Cor da cor 2 do insumo novo", "verde");
    await salvar();
    expect(importarRpcs()).toHaveLength(1);
    expect((importarRpcs()[0][1] as any)._variantes).toEqual([
      { cor_id: "azul", tamanho: null, preco: null },
      { cor_id: "verde", tamanho: null, preco: null },
    ]);
    await t.desmontar();
  });

  it("nome vazio = PENDENTE: fica em vermelho, NÃO vai ao servidor e não trava o grupo válido; cor repetida também é pendente", async () => {
    const t = await montar(undefined);
    await clicar(botaoTexto("Novo insumo"));
    await clicar(botaoTexto("Novo insumo"));
    // grupo 2 válido; grupo 1 (sem nome) pendente
    const nomes = () => porLabel(t.container, "Nome do insumo novo");
    await digitar(nomes()[1], "Válido");
    await salvar();
    expect(importarRpcs()).toHaveLength(1);
    expect((importarRpcs()[0][1] as any)._cabecalho.nome).toBe("Válido");
    expect(grupos(t.container)).toHaveLength(1); // o pendente ficou
    expect(nomes()[0].getAttribute("aria-invalid")).toBe("true");
    expect(t.container.querySelector("[data-erro-linha]")?.getAttribute("title")).toContain(
      "nome obrigatório",
    );
    expect(toast.warning.mock.calls.at(-1)![0]).toContain("1 linha nova pendente");
    await t.desmontar();
  });

  it("nome igual a um insumo que já existe é recusado na linha (a RPC sobrescreveria o cabeçalho): erro PT, sem chamada", async () => {
    const t = await montar(undefined);
    await clicar(botaoTexto("Novo insumo"));
    await digitar(porLabel(t.container, "Nome do insumo novo")[0], "insumo e1"); // "Insumo E1" existe
    await salvar();
    expect(importarRpcs()).toHaveLength(0);
    expect(t.container.textContent).toContain("Já existe um insumo com este nome");
    expect(grupos(t.container)).toHaveLength(1);
    await t.desmontar();
  });

  it("erro do servidor (23505) volta em PT na linha e o grupo fica para tentar de novo", async () => {
    estado.erroImportar = { code: "23505", message: "duplicate key" };
    const t = await montar(undefined);
    await clicar(botaoTexto("Novo insumo"));
    await digitar(porLabel(t.container, "Nome do insumo novo")[0], "Etiqueta Nova");
    await salvar();
    expect(t.container.textContent).toContain("Já existe um insumo com esse nome.");
    expect(grupos(t.container)).toHaveLength(1);
    expect(toast.error).toHaveBeenCalled();
    await t.desmontar();
  });

  it("'+ cor' num insumo EXISTENTE: grupo-alvo com cabeçalho herdado; a RPC leva só o nome + alvo = id e acrescenta a variante", async () => {
    const t = await montar(PROPS());
    await clicar(porLabel(t.container, "Adicionar cor em Etiqueta Zeta")[0]);
    const g = grupos(t.container);
    expect(g).toHaveLength(1);
    expect(g[0].textContent).toContain("mesmo insumo");
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await escolher(t.container, "Cor da cor nova 1 de Etiqueta Zeta", "preto");
    await clicar(porLabel(t.container, "Tamanhos da cor nova 1 de Etiqueta Zeta")[0]);
    await clicar(caixaTamanho("M · 40"));
    expect(importarRpcs()).toHaveLength(0);
    await salvar();
    expect(importarRpcs()).toHaveLength(1);
    expect(importarRpcs()[0][1]).toEqual({
      _cabecalho: { nome: "Etiqueta Zeta" },
      _variantes: [{ cor_id: "preto", tamanho: "40|M", preco: null }],
      _etiqueta_alvo_id: "E2",
    });
    expect(estado.variantes.filter((v) => v.etiqueta_id === "E2")).toHaveLength(1);
    expect(grupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });

  it("tamanho vinculado: a RPC não o leva — o Salvar o grava logo depois por UPDATE direto no insumo criado", async () => {
    const t = await montar(undefined);
    await clicar(botaoTexto("Novo insumo"));
    await digitar(porLabel(t.container, "Nome do insumo novo")[0], "Fita Vinculada");
    await escolher(t.container, "Formato do tamanho do insumo novo", "nenhum");
    await escolher(t.container, "Tamanho vinculado do insumo novo", "40|M");
    await salvar();
    expect("tamanho_vinculado" in (importarRpcs()[0][1] as any)._cabecalho).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ tamanho_vinculado: "40|M" });
    await t.desmontar();
  });

  it("editados vão ANTES dos novos no mesmo Salvar (ordem: update do insumo, depois a RPC)", async () => {
    const t = await montar(PROPS());
    await digitar(porLabel(t.container, "Nome de Insumo E1")[0], "Cartão Alterado");
    await clicar(botaoTexto("Novo insumo"));
    await digitar(porLabel(t.container, "Nome do insumo novo")[0], "Segundo");
    expect(botaoSalvar()?.textContent).toContain("Salvar (2)");
    await salvar();
    expect(ops.indexOf("etiquetas.update:E1")).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf("etiquetas.update:E1")).toBeLessThan(ops.indexOf("rpc:importar:novo"));
    await t.desmontar();
  });

  it("Descartar alterações limpa também as linhas novas", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo insumo"));
    await clicar(botaoTexto("Descartar alterações"));
    await clicar(botaoDialogo("Descartar"));
    expect(grupos(t.container)).toHaveLength(0);
    expect(botaoSalvar()).toBeUndefined();
    await t.desmontar();
  });
});

describe("Colar do Excel", () => {
  it("bloco vira RASCUNHO a partir da âncora (linha-pai): nome/tipo/fornecedor pelo NOME, sem gravar; número inválido avisa na célula", async () => {
    const t = await montar(PROPS());
    const nome1 = porLabel(linhas(t.container)[0], "Nome de Insumo E1")[0];
    // nome, tipo, unidade, fornecedor, preço
    const ev = await colar(nome1, "Cartão Y\tbotão\tmetro\ttecelagem beta\tabc\r\n");
    await flush(30);
    expect(ev.defaultPrevented).toBe(true); // bloco: o colar normal é cancelado
    const pai = linhas(t.container)[0];
    expect((porLabel(pai, "Nome de Insumo E1")[0] as HTMLInputElement).value).toBe("Cartão Y");
    expect(valorSelect(pai, "Tipo de Insumo E1")).toBe("tp2");
    expect(valorSelect(pai, "Unidade de Insumo E1")).toBe("metro");
    expect(valorSelect(pai, "Fornecedor de Insumo E1")).toBe("E:emp2");
    expect(updates).toHaveLength(0); // nada foi ao servidor
    expect(ops).toHaveLength(0);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe(
      "Coladas 4 células em 1 linha · 0 novas · 1 ignorada",
    );
    const avisos = t.container.querySelectorAll("[data-aviso-colar]");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].getAttribute("title")).toContain('"abc" não é um número válido');
    await salvar();
    expect(updates[0].payload).toMatchObject({
      nome: "Cartão Y",
      tipo_insumo_id: "tp2",
      unidade: "metro",
      empresa_id: "emp2",
      representante_id: null,
    });
    await t.desmontar();
  });

  it("COR + TAMANHOS + preço colados nas linhas das cores: a lista de tamanhos explode no Salvar (delete-and-reinsert); cor/tamanho sem correspondência avisa e não grava", async () => {
    const t = await montar(PROPS());
    const cor1 = porLabel(filhos(t.container)[0], "Cor da cor de Insumo E1")[0];
    // 1ª cor (azul): Preto, tamanhos 38,40 (número) e "gg" (letra, fora da grade padrão? GG existe), preço; 2ª (verde): Roxo (não existe)
    await colar(cor1, "Preto\t38, 40\t4,5\nRoxo\tzz\t\n");
    await flush(30);
    expect(updates).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    // o Select do Radix vira botões no harness: o motivo do aviso fica no `title` da célula
    const av = Array.from(t.container.querySelectorAll("[title]")).map((e) =>
      e.getAttribute("title"),
    );
    expect(av.some((x) => x?.includes('Cor "Roxo" não encontrada'))).toBe(true);
    expect(av.some((x) => x?.includes('Tamanho "zz"'))).toBe(true);
    await salvar();
    // só o conjunto de cores mudou: cabeçalho intocado, variantes regravadas com a cor Preto × (38|P, 40|M)
    expect(updates).toHaveLength(0);
    expect(deletesVariantes).toEqual(["E1"]);
    const novas = insertsVariantes.at(-1)!.linhas;
    expect(novas.filter((l) => l.cor_id === "preto").map((l) => l.tamanho)).toEqual([
      "38|P",
      "40|M",
    ]);
    expect(novas.find((l) => l.cor_id === "preto")!.preco).toBe(4.5);
    await t.desmontar();
  });

  it("linhas além do fim criam insumos NOVOS (mesmo nome = cores do mesmo insumo) e vão pela RPC no Salvar", async () => {
    const t = await montar(PROPS());
    const nome2 = porLabel(linhas(t.container)[3], "Nome de Etiqueta Zeta")[0]; // E2: o último insumo (sem cor)
    const tsv = (c: string[]) => c.join("\t");
    await colar(
      nome2,
      [
        tsv(["Etiqueta Zeta"]),
        tsv(["Tag Nova", "Cartão", "milheiro", "", "", "", "", "", "Azul", "34,36", "1"]),
        tsv(["tag nova", "", "", "", "", "", "", "", "Verde", "", "2"]),
      ].join("\n"),
    );
    await flush(30);
    expect(importarRpcs()).toHaveLength(0);
    expect(grupos(t.container)).toHaveLength(2); // 1 insumo novo, 2 cores
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)"); // o grupo novo conta 1 (E2 não mudou de valor)
    await salvar();
    expect(importarRpcs()).toHaveLength(1);
    const a = importarRpcs()[0][1] as any;
    expect(a._cabecalho).toMatchObject({
      nome: "Tag Nova",
      tipo_insumo_id: "tp1",
      unidade: "milheiro",
    });
    expect(a._variantes).toEqual([
      { cor_id: "azul", tamanho: "34|PPP", preco: 1 },
      { cor_id: "azul", tamanho: "36|PP", preco: 1 },
      { cor_id: "verde", tamanho: null, preco: 2 },
    ]);
    await t.desmontar();
  });

  it("cabeçalho colado na linha de uma COR é recusado (linha-não-aceita) e não suja nada", async () => {
    const t = await montar(PROPS());
    // âncora na célula Nome da linha da cor: o cabeçalho é do insumo (linha de cima)
    const celulaNomeDaCor = filhos(t.container)[0].querySelector('td[data-col="nome"]')!;
    await colar(celulaNomeDaCor, "X\tY\n");
    await flush(30);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe(
      "Coladas 0 células em 0 linhas · 0 novas · 2 ignoradas",
    );
    expect(botaoSalvar()).toBeUndefined();
    expect(toast.warning.mock.calls[0][1].description).toContain("2 linha sem essa célula");
    await t.desmontar();
  });

  it("cor colada na linha-pai de insumo SEM cores é recusada com o motivo ('use o + para criar a cor')", async () => {
    const t = await montar(PROPS());
    const celulaCor = linhas(t.container)[3].querySelector('td[data-col="cor"]')!; // E2: sem cores
    await colar(celulaCor, "Azul\t34\n");
    await flush(30);
    expect(toast.warning.mock.calls[0][0]).toContain("2 ignoradas");
    expect(botaoSalvar()).toBeUndefined();
    await t.desmontar();
  });
});

describe("Excluir (lixeira única por linha)", () => {
  it("lixeira do INSUMO (linha-pai): pede confirmação; Cancelar não exclui; Confirmar faz DELETE direto em etiquetas, relê e some da lista", async () => {
    const t = await montar(undefined);
    await clicar(
      porLabel(pais(t.container)[1], "Excluir o insumo Etiqueta Zeta e todas as cores")[0],
    );
    expect(dialogo()).not.toBeNull();
    expect(dialogo()!.textContent).toContain("Etiqueta Zeta");
    await clicar(botaoDialogo("Cancelar"));
    await flush(30);
    expect(etiquetaDeletes).toHaveLength(0);
    await clicar(
      porLabel(pais(t.container)[1], "Excluir o insumo Etiqueta Zeta e todas as cores")[0],
    );
    await clicar(botaoDialogo("Excluir insumo"));
    await flush(80);
    expect(etiquetaDeletes).toEqual([{ id: "E2" }]);
    expect(toast.success).toHaveBeenCalledWith("Insumo excluído.");
    expect(pais(t.container)).toHaveLength(1);
    expect(estado.etiquetas.map((e) => e.id)).toEqual(["E1"]);
    await t.desmontar();
  });

  it("insumo EM USO (23503): texto PT, nada é apagado e a linha continua", async () => {
    estado.emUso = new Set(["E1"]);
    const t = await montar(undefined);
    await clicar(porLabel(pais(t.container)[0], "Excluir o insumo Insumo E1 e todas as cores")[0]);
    await clicar(botaoDialogo("Excluir insumo"));
    await flush(80);
    expect(toast.error).toHaveBeenCalledWith("Insumo em uso (CAD/modelo/OC). Remova de lá antes.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(pais(t.container)).toHaveLength(2);
    expect(estado.etiquetas).toHaveLength(2);
    await t.desmontar();
  });

  it("insumo que já foi excluído por outra pessoa (0 linhas) avisa em PT e relê", async () => {
    estado.jaExcluido = new Set(["E2"]);
    const t = await montar(undefined);
    await clicar(
      porLabel(pais(t.container)[1], "Excluir o insumo Etiqueta Zeta e todas as cores")[0],
    );
    await clicar(botaoDialogo("Excluir insumo"));
    await flush(80);
    expect(toast.error.mock.calls[0][0]).toContain("não foi encontrado");
    await t.desmontar();
  });

  it("lixeira da COR NÃO grava: marca a cor no rascunho (riscada, 'a remover', com Desfazer); o Salvar regrava as cores SEM ela", async () => {
    const t = await montar(PROPS());
    const lixeira = (i: number) =>
      filhos(t.container)[i].querySelector('[data-acao="remover-cor"]') as HTMLElement;
    expect(lixeira(1).getAttribute("aria-label")).toBe("Remover a cor Verde de Insumo E1");
    await clicar(lixeira(1)); // Verde
    expect(ops).toHaveLength(0);
    expect(deletesVariantes).toHaveLength(0);
    expect(dialogo()).toBeNull(); // sem confirmação: é só rascunho
    expect(filhos(t.container)[1].hasAttribute("data-cor-removida")).toBe(true);
    expect(filhos(t.container)[1].textContent).toContain("será removida ao Salvar");
    expect(pais(t.container)[0].querySelector("[data-resumo-cores]")!.textContent).toBe(
      "1 cor · 1 a remover",
    );
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    // Desfazer volta ao limpo
    await clicar(filhos(t.container)[1].querySelector('[data-acao="desfazer-remocao-cor"]'));
    expect(botaoSalvar()).toBeUndefined();
    // remove de novo e salva
    await clicar(lixeira(1));
    await salvar();
    expect(deletesVariantes).toEqual(["E1"]);
    const regravadas = insertsVariantes.at(-1)!.linhas;
    expect(regravadas.every((l) => l.cor_id === "azul")).toBe(true); // só a azul (2 tamanhos)
    expect(regravadas).toHaveLength(2);
    expect(updates).toHaveLength(0); // cabeçalho intocado
    expect(
      estado.variantes.filter((v) => v.etiqueta_id === "E1" && v.cor_id === "verde"),
    ).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("1 salvo.");
    await t.desmontar();
  });

  it("cor em uso (23503 ao regravar): o aviso PT fica na linha e a remoção continua pendente (dá para desfazer)", async () => {
    estado.varianteEmUso = new Set(["E1"]);
    const t = await montar(PROPS());
    await clicar(filhos(t.container)[1].querySelector('[data-acao="remover-cor"]'));
    await salvar();
    expect(t.container.querySelector("[data-erro-linha]")?.getAttribute("title")).toContain(
      "está em uso",
    );
    expect(filhos(t.container)[1].hasAttribute("data-cor-removida")).toBe(true);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await t.desmontar();
  });

  it("lixeira da cor tirada das linhas NOVAS é o X da própria linha (só rascunho); insumo novo único some inteiro", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo insumo"));
    await clicar(botaoTexto("adicionar cor", t.container));
    expect(grupos(t.container)).toHaveLength(2);
    await clicar(grupos(t.container)[1].querySelector('[data-acao="remover-linha-nova"]'));
    expect(grupos(t.container)).toHaveLength(1);
    await clicar(t.container.querySelector('[data-acao="descartar-insumo-novo"]'));
    expect(grupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });
});

// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (harness da grade de Aviamentos) */
// Grade "Lista" de Aviamentos (AV-3), render real da `AviamentosGradeAba` com `supabase` mockado.
// COLAR do Excel: bloco TSV na célula-âncora vira RASCUNHO (nada grava), resolve pelo NOME, texto sem correspondência NÃO grava e avisa na
// célula; linhas além do fim criam aviamentos NOVOS (mesmo nome = cores do mesmo aviamento). EXCLUIR (lixeira única por linha): pede
// confirmação e grava NA HORA — cor = RPC `excluir_variante_aviamento`; aviamento = DELETE direto (23503 em uso vira texto PT) + foto do bucket.
import { describe, it, expect, beforeEach } from "vitest";
import {
  aviamentoDeletes,
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
  remove,
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
const importarRpcs = () => rpc.mock.calls.filter((c) => c[0] === "importar_aviamento_linha");
const excluirCorRpcs = () => rpc.mock.calls.filter((c) => c[0] === "excluir_variante_aviamento");
const dialogo = () => document.body.querySelector('[role="alertdialog"]') as HTMLElement | null;
const botaoDialogo = (txt: string) =>
  Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find(
    (b) => b.textContent === txt,
  ) as HTMLButtonElement;
const valorSelect = (raiz: ParentNode, label: string) =>
  seletor(raiz, label)?.getAttribute("data-value") ?? undefined;

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
/** Linha do TSV a partir da coluna Nome: nome, fornecedor, preço, ncm, categoria, subcategoria, material, composição, intervalo, largura, obs, cor base. */
const tsv = (c: {
  nome?: string;
  fornecedor?: string;
  preco?: string;
  categoria?: string;
  cor?: string;
}) =>
  [
    c.nome ?? "",
    c.fornecedor ?? "",
    c.preco ?? "",
    "",
    c.categoria ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    c.cor ?? "",
  ].join("\t");

describe("Colar do Excel", () => {
  it("bloco vira RASCUNHO a partir da âncora (linha-pai): nome/fornecedor/categoria pelo NOME, sem gravar; número inválido avisa na célula", async () => {
    const t = await montar(PROPS());
    const nome1 = porLabel(linhas(t.container)[0], "Nome de Botão")[0];
    const ev = await colar(nome1, "Botão Y\tTecelagem beta\tabc\r\n");
    await flush(30);
    expect(ev.defaultPrevented).toBe(true); // bloco: o colar normal é cancelado
    expect(porLabel(t.container, "Nome de Botão")[0].value).toBe("Botão Y");
    expect(valorSelect(linhas(t.container)[0], "Fornecedor de Botão")).toBe("E:emp2");
    expect(aviamentoUpdates).toHaveLength(0); // nada foi ao servidor
    expect(rpc.mock.calls.filter((c) => c[0] === "salvar_variantes_aviamento")).toHaveLength(0);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe(
      "Coladas 2 células em 1 linha · 0 novas · 1 ignorada",
    );
    const avisos = t.container.querySelectorAll("[data-aviso-colar]");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].getAttribute("title")).toContain('"abc" não é um número válido');
    await t.desmontar();
  });

  it("fornecedor DIFERENTE zera o representante (o par); categoria nova tira a subcategoria que não é dela", async () => {
    estado.aviamentos[0].empresa_id = "emp3";
    estado.aviamentos[0].representante_id = "rep3";
    const t = await montar(PROPS());
    const nome = porLabel(linhas(t.container)[0], "Nome de Botão")[0];
    // nome, fornecedor, preço, ncm, categoria
    await colar(nome, "Botão\tArmarinho Alfa\t\t\tZíperes");
    await flush(30);
    const pai = linhas(t.container)[0];
    expect(valorSelect(pai, "Fornecedor de Botão")).toBe("E:emp1"); // sem o representante rep3 do fornecedor antigo
    expect(valorSelect(pai, "Categoria de Botão")).toBe("cat2");
    expect(valorSelect(pai, "Subcategoria de Botão") || "").toBe(""); // sub1 era da cat1
    await clicar(botaoSalvar());
    await flush(80);
    expect(aviamentoUpdates[0].payload).toMatchObject({
      empresa_id: "emp1",
      representante_id: null,
      categoria_aviamento_id: "cat2",
      subcategoria_aviamento_id: null,
    });
    await t.desmontar();
  });

  it("bloco que desce pelas CORES: o cabeçalho só vale na linha-pai (nas cores é recusado, com motivo); a linha-pai de baixo recebe", async () => {
    const t = await montar(PROPS());
    // telas: [pai av1] [cor v1] [cor v2] [pai av2 (sem cores)]
    const nome1 = porLabel(linhas(t.container)[0], "Nome de Botão")[0];
    await colar(
      nome1,
      ["Botão X\tArmarinho Alfa", "Botão Y\tArmarinho Alfa", "Botão Z", "Zíper W"].join("\r\n") +
        "\r\n",
    );
    await flush(30);
    expect(porLabel(t.container, "Nome de Botão")[0].value).toBe("Botão X"); // Y e Z caíram em cores: NÃO sobrescrevem o pai
    expect(aviamentoUpdates).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(String(toast.warning.mock.calls[0][1]?.description)).toContain("linha sem essa célula");
    expect(String(toast.warning.mock.calls[0][1]?.description)).not.toContain(
      "sem correspondência",
    );
    await t.desmontar();
  });

  it("editar a célula com aviso tira o aviso", async () => {
    const t = await montar(PROPS());
    await colar(porLabel(linhas(t.container)[0], "Nome de Botão")[0], "A\tArmarinho Alfa\tabc");
    await flush(30);
    const [l0] = linhas(t.container);
    expect(l0.querySelectorAll("[data-aviso-colar]")).toHaveLength(1);
    await digitar(porLabel(l0, "Preço de Botão")[0], "5,00");
    expect(t.container.querySelectorAll("[data-aviso-colar]")).toHaveLength(0);
    await t.desmontar();
  });

  it("cor base e apelido pelo nome numa cor existente (apelido só da cor base colada)", async () => {
    const t = await montar(PROPS());
    const ancora = porLabel(linhas(t.container)[1], "Cor base da cor de Botão")[0];
    await colar(ancora, "Azul\tMarinho\nVerde\tMarinho");
    await flush(30);
    const [, l0, l1] = linhas(t.container);
    expect(valorSelect(l0, "Cor base da cor de Botão")).toBe("cor1");
    expect(valorSelect(l0, "Cor apelido da cor de Botão")).toBe("ap1");
    expect(valorSelect(l1, "Cor base da cor de Botão")).toBe("cor2");
    expect(valorSelect(l1, "Cor apelido da cor de Botão") || "").toBe(""); // Marinho não é de Verde: não aplica
    expect(String(toast.warning.mock.calls[0][0])).toContain("1 ignorada");
    expect(rpc.mock.calls.filter((c) => c[0] === "salvar_variantes_aviamento")).toHaveLength(0);
    await t.desmontar();
  });

  it("linhas além do fim viram aviamentos NOVOS (mesmo nome = cores do mesmo aviamento); UM Salvar manda cada um, SEM `codigo`", async () => {
    const t = await montar(PROPS());
    const ancora = porLabel(linhas(t.container).slice(-1)[0], "Nome de Zíper")[0]; // av2, sem cores
    const bloco = [
      "Zíper renomeado",
      tsv({
        nome: "Novo A",
        fornecedor: "armarinho alfa",
        preco: "28,50",
        categoria: "Botões",
        cor: "Azul",
      }),
      tsv({ nome: "novo a", cor: "Verde" }),
      tsv({ nome: "Novo B", cor: "Verde" }),
    ].join("\n");
    await colar(ancora, bloco);
    await flush(30);
    expect(porLabel(t.container, "Nome de Zíper")[0].value).toBe("Zíper renomeado");
    const nv = novoGrupos(t.container);
    expect(nv).toHaveLength(3); // Novo A (2 cores) + Novo B (1 cor)
    expect(new Set(nv.map((r) => r.getAttribute("data-linha-nova"))).size).toBe(2);
    expect(importarRpcs()).toHaveLength(0); // ainda rascunho
    expect(toast.success.mock.calls[0][0]).toBe(
      "Coladas 10 células em 4 linhas · 3 novas · 0 ignoradas",
    );

    await clicar(botaoSalvar());
    await flush(80);
    const chamadas = importarRpcs();
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0][1]._cabecalho).toMatchObject({
      codigo_nome: "Novo A",
      empresa_id: "emp1",
      preco: 28.5,
      categoria_aviamento_id: "cat1",
    });
    expect("codigo" in chamadas[0][1]._cabecalho).toBe(false);
    expect(chamadas[0][1]._variantes.map((v: any) => v.cor_id)).toEqual(["cor1", "cor2"]);
    expect(chamadas[1][1]._cabecalho.codigo_nome).toBe("Novo B");
    expect(aviamentoUpdates.map((u) => u.payload.codigo_nome)).toContain("Zíper renomeado"); // o editado também foi
    expect(novoGrupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });

  it("código colado em linha NOVA é ignorado (o servidor gera) e avisa; linha nova sem nome fica PENDENTE sem travar as válidas", async () => {
    const t = await montar(PROPS());
    const ancora = porLabel(linhas(t.container).slice(-1)[0], "Código de Zíper")[0];
    await colar(
      ancora,
      [
        "COD-X\tZíper",
        ["XYZ-0001", "Bom", "", "", "", "", "", "", "", "", "", "", "Azul"].join("\t"),
        ["", "", "5,00"].join("\t"),
      ].join("\n"),
    );
    await flush(30);
    const avisoCodigo = Array.from(
      t.container.querySelectorAll("[data-linha-nova] [data-aviso-colar]"),
    ).map((e) => e.getAttribute("title"));
    expect(avisoCodigo.some((x) => x?.includes("gerado automático"))).toBe(true);
    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs().map((c) => c[1]._cabecalho.codigo_nome)).toEqual(["Bom"]);
    expect(novoGrupos(t.container)).toHaveLength(1); // só a pendente ficou
    expect(String(toast.warning.mock.calls.at(-1)?.[0])).toContain("pendente");
    await t.desmontar();
  });

  it("valor simples (sem TAB/quebra) NÃO é interceptado: segue o colar normal do campo", async () => {
    const t = await montar(PROPS());
    const ev = await colar(porLabel(linhas(t.container)[0], "Nome de Botão")[0], "Botão");
    expect(ev.defaultPrevented).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(selos(t.container)).toBe(0);
    const ev2 = await colar(porLabel(linhas(t.container)[0], "Nome de Botão")[0], "Botão\r\n");
    expect(ev2.defaultPrevented).toBe(false);
    await t.desmontar();
  });

  it("foto e transbordo são ignorados e contados; código vazio nunca apaga o do existente", async () => {
    const t = await montar(PROPS());
    // âncora no NCM: ncm, categoria, sub, material, composição, intervalo, largura, obs, cor base(na pai: recusa), apelido, nome var, cód var, preço var, foto, x
    const ancora = porLabel(linhas(t.container)[0], "NCM de Botão")[0];
    await colar(ancora, "6006\tZíperes\t\t\t\t\t\t\t\t\t\t\t\tfoto.jpg\ttransb");
    await flush(30);
    expect(porLabel(t.container, "NCM de Botão")[0].value).toBe("6006");
    const det = String(toast.warning.mock.calls[0][1]?.description);
    expect(det).toContain("coluna que não aceita colar"); // foto
    expect(det).toContain("além da última coluna");
    const cod = porLabel(linhas(t.container)[0], "Código de Botão")[0];
    await colar(cod, "\tBotão novo nome");
    await flush(30);
    expect(porLabel(t.container, "Código de Botão")[0].value).toBe("COD-av1"); // vazio não apagou
    await t.desmontar();
  });
});

describe("Excluir (lixeira única por linha)", () => {
  it("excluir COR cadastrada: o botão só PEDE confirmação; Cancelar não chama a RPC; Confirmar grava NA HORA, limpa a foto do bucket e relê a grade", async () => {
    estado.variantes[0].foto_url = "tenant1/av1/v1-1.jpg";
    const t = await montar(PROPS());
    expect(linhas(t.container).filter((r) => r.dataset.varianteId)).toHaveLength(2);
    await clicar(t.container.querySelector('[aria-label="Excluir a cor Azul de Botão"]'));
    await flush(20);
    expect(dialogo()!.textContent).toContain("Excluir a cor Azul?");
    expect(excluirCorRpcs()).toHaveLength(0); // pediu confirmação, NADA gravou ainda
    await clicar(botaoDialogo("Cancelar"));
    await flush(20);
    expect(excluirCorRpcs()).toHaveLength(0);

    await clicar(t.container.querySelector('[aria-label="Excluir a cor Azul de Botão"]'));
    await flush(20);
    await clicar(botaoDialogo("Excluir cor"));
    await flush(80);
    expect(excluirCorRpcs()).toHaveLength(1);
    expect(excluirCorRpcs()[0][1]).toEqual({ _variante_id: "v1" });
    expect(remove).toHaveBeenCalledWith("aviamentos", ["tenant1/av1/v1-1.jpg"]); // DEPOIS do delete, no bucket certo
    expect(toast.success).toHaveBeenCalledWith("Cor excluída.");
    expect(linhas(t.container).filter((r) => r.dataset.varianteId)).toHaveLength(1);
    await t.desmontar();
  });

  it("cor EM USO: a RPC recusa, a mensagem em PT aparece e a linha continua (foto não sai do bucket)", async () => {
    estado.erroExcluirVariante = {
      code: "P0001",
      message: "Não é possível excluir esta cor: ela está em uso em 2 registro(s).",
    };
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Excluir a cor Azul de Botão"]'));
    await flush(20);
    await clicar(botaoDialogo("Excluir cor"));
    await flush(80);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("em uso"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(linhas(t.container).filter((r) => r.dataset.varianteId)).toHaveLength(2);
    await t.desmontar();
  });

  it("excluir AVIAMENTO inteiro = DELETE DIRETO em `aviamentos` (NÃO RPC) + fotos do aviamento e das cores saem do bucket; some da grade", async () => {
    estado.aviamentos[0].foto_url = "tenant1/av1/capa.jpg";
    estado.variantes[0].foto_url = "tenant1/av1/v1-1.jpg";
    const t = await montar(PROPS());
    await clicar(
      t.container.querySelector('[aria-label="Excluir o aviamento Botão e todas as cores"]'),
    );
    await flush(20);
    expect(dialogo()!.textContent).toContain("Excluir o aviamento Botão e todas as cores?");
    expect(aviamentoDeletes).toHaveLength(0);
    await clicar(botaoDialogo("Excluir aviamento"));
    await flush(80);
    expect(aviamentoDeletes).toEqual([{ id: "av1" }]);
    expect(rpc.mock.calls.filter((c) => String(c[0]).startsWith("excluir_"))).toHaveLength(0);
    expect(remove).toHaveBeenCalledWith("aviamentos", [
      "tenant1/av1/capa.jpg",
      "tenant1/av1/v1-1.jpg",
    ]);
    expect(toast.success).toHaveBeenCalledWith("Aviamento excluído.");
    expect(t.container.querySelector('[data-grupo-aviamento="av1"]')).toBeNull();
    await t.desmontar();
  });

  it("aviamento EM USO (FK 23503): mensagem PT, nada some, foto fica", async () => {
    estado.emUso.add("av1");
    estado.aviamentos[0].foto_url = "tenant1/av1/capa.jpg";
    const t = await montar(PROPS());
    await clicar(
      t.container.querySelector('[aria-label="Excluir o aviamento Botão e todas as cores"]'),
    );
    await flush(20);
    await clicar(botaoDialogo("Excluir aviamento"));
    await flush(80);
    expect(toast.error).toHaveBeenCalledWith(
      "Aviamento em uso (OC, modelo, CAD ou ordem de saída). Remova de lá antes.",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(t.container.querySelector('[data-grupo-aviamento="av1"]')).not.toBeNull();
    await t.desmontar();
  });

  it("aviamento que outra pessoa já excluiu (0 linhas apagadas): avisa em PT, não finge sucesso", async () => {
    estado.jaExcluido.add("av2");
    const t = await montar(PROPS());
    await clicar(
      t.container.querySelector('[aria-label="Excluir o aviamento Zíper e todas as cores"]'),
    );
    await flush(20);
    await clicar(botaoDialogo("Excluir aviamento"));
    await flush(80);
    expect(toast.success).not.toHaveBeenCalled();
    expect(String(toast.error.mock.calls[0][0])).toContain("já tenha sido excluído");
    await t.desmontar();
  });

  it("excluir aviamento leva junto as cores NOVAS em rascunho dele", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Adicionar cor em Botão"]'));
    expect(novoGrupos(t.container)).toHaveLength(1);
    await clicar(
      t.container.querySelector('[aria-label="Excluir o aviamento Botão e todas as cores"]'),
    );
    await flush(20);
    await clicar(botaoDialogo("Excluir aviamento"));
    await flush(80);
    expect(novoGrupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });

  it("linha NOVA: só é descartada do rascunho — sem confirmação e SEM chamar nenhuma RPC/DELETE", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo aviamento"));
    await clicar(botaoTexto("adicionar variante (cor)", t.container));
    await clicar(t.container.querySelector('[data-variante-nova] [aria-label="Remover esta cor"]'));
    expect(novoGrupos(t.container)).toHaveLength(1);
    await clicar(botaoTexto("Descartar aviamento novo", t.container));
    expect(novoGrupos(t.container)).toHaveLength(0);
    expect(dialogo()).toBeNull();
    expect(excluirCorRpcs()).toHaveLength(0);
    expect(aviamentoDeletes).toHaveLength(0);
    await t.desmontar();
  });

  it("lixeira única por linha: pai = aviamento + cores, filho = só a cor; a coluna Ações não é fixa", async () => {
    const t = await montar(PROPS());
    const [pai, cor] = linhas(t.container);
    expect(pai.querySelectorAll('[data-acao="excluir-aviamento"]')).toHaveLength(1);
    expect(pai.querySelectorAll('[data-acao="excluir-cor"]')).toHaveLength(0);
    expect(cor.querySelectorAll('[data-acao="excluir-cor"]')).toHaveLength(1);
    expect(cor.querySelectorAll('[data-acao="excluir-aviamento"]')).toHaveLength(0);
    // a coluna Ações NÃO é fixa (só Estado e Nome ficam sticky)
    expect(pai.querySelector("[data-col-acoes]")!.className).not.toContain("sticky");
    await t.desmontar();
  });

  it("excluir não mexe nos rascunhos dos OUTROS aviamentos (editar um aviamento e excluir outro)", async () => {
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "NCM de Botão")[0], "9606");
    await clicar(
      t.container.querySelector('[aria-label="Excluir o aviamento Zíper e todas as cores"]'),
    );
    await flush(20);
    await clicar(botaoDialogo("Excluir aviamento"));
    await flush(80);
    expect(aviamentoDeletes).toEqual([{ id: "av2" }]);
    expect(porLabel(t.container, "NCM de Botão")[0].value).toBe("9606"); // rascunho do av1 intacto
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    expect(ordem).not.toContain("aviamentos.update:av1");
    await t.desmontar();
  });
});

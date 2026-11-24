// Libs PURAS da grade "Lista" de Insumos (IN-2): `celulas` (controle por coluna, tamanhos multi-check), `salvar` (rascunho, validação,
// payload, expansão cor × tamanhos, UM Salvar parcial) e `ordenar` (por GRUPO: as cores de um insumo ficam juntas).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { COLUNAS_INSUMO, byKey } from "@/lib/insumo-grade/colunas";
import {
  CAMPO_COR,
  CAMPO_INSUMO,
  alternarTamanho,
  blocoIgual,
  blocosIguais,
  controleDaCelula,
  empresasParaLinha,
  opcoesDaColuna,
  opcoesDeTamanho,
  permiteVazio,
  resumoTamanhos,
  tamanhosHabilitados,
  valorVazioDoSelect,
} from "@/lib/insumo-grade/celulas";
import {
  ErroGrade,
  blocosEfetivos,
  expandirBlocos,
  insumoParaDraft,
  mensagemSalvarInsumo,
  mensagemSalvarVariantes,
  montarPayloadInsumo,
  salvarEmOrdem,
  temCorRepetida,
  textoResultadoSalvar,
  validarInsumo,
  type BlocoDraft,
} from "@/lib/insumo-grade/salvar";
import { montarLinhas } from "@/lib/insumo-grade/linhas";
import { colunaOrdenavel, ordenarLinhasPorColuna } from "@/lib/insumo-grade/ordenar";

const GRADE = ["34|PPP", "36|PP", "38|P", "40|M"];
const cabecalho = {
  nome: "Cartão",
  tipo_insumo_id: "tp1",
  unidade: "unidade",
  empresa_id: "emp1",
  representante_id: null,
  preco: 1.5,
  formato_tamanho: "ambos",
  tamanho_vinculado: null,
  observacoes: null,
};
const blocos: BlocoDraft[] = [
  { cor_id: "azul", preco: 2, tamanhos: ["34|PPP", "36|PP"] },
  { cor_id: "verde", preco: 3, tamanhos: [] },
];

describe("celulas: controle por coluna e mapeamento coluna → campo", () => {
  it("cada coluna do catálogo tem controle e campo do rascunho", () => {
    for (const c of COLUNAS_INSUMO) {
      expect(controleDaCelula(c)).not.toBe("somente-leitura");
      const mapa = c.escopo === "insumo" ? CAMPO_INSUMO : CAMPO_COR;
      expect(mapa[c.key], c.key).toBeTruthy();
    }
    expect(controleDaCelula(byKey("tamanhos")!)).toBe("tamanhos");
    expect(controleDaCelula(byKey("tamanho_vinculado")!)).toBe("tamanho-vinculado");
    expect(controleDaCelula({ tipo: "texto", editavel: false })).toBe("somente-leitura");
  });

  it("selects que aceitam vazio: tipo, fornecedor e cor; o vazio do tipo é null e o da cor é ''", () => {
    expect(
      ["tipo_insumo", "fornecedor", "cor", "unidade", "formato_tamanho"].map(permiteVazio),
    ).toEqual([true, true, true, false, false]);
    expect(valorVazioDoSelect("tipo_insumo")).toBeNull();
    expect(valorVazioDoSelect("cor")).toBe("");
  });

  it("opções: unidade e formato são listas fixas; fornecedor lista só os de insumo (+ o já salvo)", () => {
    const o = {
      tipos: [{ id: "t", nome: "Cartão" }],
      cores: [{ id: "c", nome: "Azul" }],
      empresas: [{ id: "e", nome_fantasia: "Alfa" }],
    };
    expect(opcoesDaColuna("unidade", o).map((x) => x.id)).toEqual([
      "unidade",
      "metro",
      "rolo",
      "milheiro",
    ]);
    expect(opcoesDaColuna("formato_tamanho", o).map((x) => x.id)).toEqual([
      "ambos",
      "numero",
      "letra",
      "nenhum",
    ]);
    expect(opcoesDaColuna("fornecedor", o)).toEqual([{ id: "e", nome: "Alfa" }]);
    expect(opcoesDaColuna("cor", o)).toEqual(o.cores);
    expect(opcoesDaColuna("nome", o)).toEqual([]);
    const emp = [
      { id: "a", ehInsumo: true },
      { id: "b", ehInsumo: false },
    ];
    expect(empresasParaLinha(emp, null).map((e) => e.id)).toEqual(["a"]);
    expect(empresasParaLinha(emp, "b").map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("tamanhos: marcar/desmarcar devolve na ORDEM da grade; o marcado que saiu da grade continua na lista", () => {
    expect(alternarTamanho([], "38|P", GRADE)).toEqual(["38|P"]);
    expect(alternarTamanho(["38|P"], "34|PPP", GRADE)).toEqual(["34|PPP", "38|P"]);
    expect(alternarTamanho(["34|PPP", "38|P"], "34|PPP", GRADE)).toEqual(["38|P"]);
    expect(opcoesDeTamanho(GRADE, ["99|XX"])).toEqual([...GRADE, "99|XX"]);
    expect(alternarTamanho(["99|XX"], "36|PP", GRADE)).toEqual(["36|PP", "99|XX"]);
    expect(alternarTamanho(["99|XX"], "99|XX", GRADE)).toEqual([]);
    expect(resumoTamanhos(["40|M", "34|PPP"], (t) => t.split("|")[1])).toBe("M, PPP");
    expect(tamanhosHabilitados("nenhum")).toBe(false);
    expect(["ambos", "numero", "letra", null].map(tamanhosHabilitados)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("igualdade de blocos: tamanhos como CONJUNTO; preço undefined = null", () => {
    const a: BlocoDraft = { cor_id: "azul", preco: null, tamanhos: ["34|PPP", "36|PP"] };
    expect(blocoIgual(a, { cor_id: "azul", preco: null, tamanhos: ["36|PP", "34|PPP"] })).toBe(
      true,
    );
    expect(blocoIgual(a, { ...a, preco: 1 })).toBe(false);
    expect(blocoIgual(a, { ...a, tamanhos: ["34|PPP"] })).toBe(false);
    expect(blocoIgual(a, undefined)).toBe(false);
    expect(blocoIgual(undefined, undefined)).toBe(true);
    expect(
      blocosIguais(
        blocos,
        blocos.map((b) => ({ ...b })),
      ),
    ).toBe(true);
    expect(blocosIguais(blocos, blocos.slice(0, 1))).toBe(false);
  });
});

describe("salvar: rascunho, expansão e validação", () => {
  it("insumoParaDraft: defaults, vazio = null, vínculo ligado quando há tamanho vinculado (sem espaços)", () => {
    const d = insumoParaDraft(
      {
        ...cabecalho,
        nome: null,
        unidade: null,
        formato_tamanho: null,
        observacoes: "  ",
        tamanho_vinculado: " 40|M ",
      },
      blocos,
    );
    expect(d).toMatchObject({
      nome: "",
      unidade: "unidade",
      formato_tamanho: "ambos",
      observacoes: null,
      vincular: true,
      tamanho_vinculado: "40|M",
    });
    expect(d.blocos).toEqual(blocos);
    expect(d.blocos[0].tamanhos).not.toBe(blocos[0].tamanhos); // cópia
    const sem = insumoParaDraft(cabecalho);
    expect(sem).toMatchObject({ vincular: false, tamanho_vinculado: null, blocos: [] });
  });

  it("expandirBlocos: 1 variante por tamanho marcado; cor sem tamanho = 1 variante com tamanho null; cor '' = cor_id null", () => {
    expect(expandirBlocos(blocos)).toEqual([
      { tamanho: "34|PPP", cor_id: "azul", preco: 2 },
      { tamanho: "36|PP", cor_id: "azul", preco: 2 },
      { tamanho: null, cor_id: "verde", preco: 3 },
    ]);
    expect(expandirBlocos([{ cor_id: "", preco: null, tamanhos: ["40|M"] }])).toEqual([
      { tamanho: "40|M", cor_id: null, preco: null },
    ]);
    expect(expandirBlocos([])).toEqual([]);
  });

  it("blocosEfetivos: formato 'nenhum' zera os tamanhos sem mexer no rascunho", () => {
    expect(blocosEfetivos("nenhum", blocos).map((b) => b.tamanhos)).toEqual([[], []]);
    expect(blocosEfetivos("ambos", blocos)).toEqual(blocos);
    expect(blocos[0].tamanhos).toHaveLength(2);
  });

  it("temCorRepetida: inclui a cor 'sem cor' repetida", () => {
    expect(temCorRepetida(blocos)).toBe(false);
    expect(temCorRepetida([...blocos, { cor_id: "azul", preco: null, tamanhos: [] }])).toBe(true);
    expect(
      temCorRepetida([
        { cor_id: "", preco: null, tamanhos: [] },
        { cor_id: "", preco: null, tamanhos: [] },
      ]),
    ).toBe(true);
  });

  it("validarInsumo: nome vazio, cor repetida (alvo variantes) e vínculo ligado sem tamanho", () => {
    const base = insumoParaDraft(cabecalho, blocos);
    expect(() => validarInsumo({ nome: "  " }, base)).toThrow("Informe o nome do insumo.");
    expect(() => validarInsumo({ unidade: "metro" }, base)).not.toThrow();
    try {
      validarInsumo({ blocos: [...blocos, { cor_id: "azul", preco: null, tamanhos: [] }] }, base);
      throw new Error("devia recusar");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroGrade);
      expect((e as ErroGrade).alvo).toBe("variantes");
    }
    const semCor = insumoParaDraft(cabecalho, [{ cor_id: "azul", preco: null, tamanhos: [] }]);
    // ligar o vínculo sem escolher o tamanho
    expect(() => validarInsumo({ vincular: true, tamanho_vinculado: null }, semCor)).toThrow(
      "Escolha o tamanho vinculado ou desligue o vínculo.",
    );
    expect(() =>
      validarInsumo({ vincular: true, tamanho_vinculado: "40|M" }, semCor),
    ).not.toThrow();
    // vínculo ligado sem tamanho NÃO vale quando o insumo tem tamanho próprio: não recusa
    expect(() => validarInsumo({ vincular: true, tamanho_vinculado: null }, base)).not.toThrow();
  });

  it("montarPayloadInsumo: só os campos tocados; fornecedor+representante juntos; texto vazio = null; vínculo só quando muda", () => {
    const base = insumoParaDraft(cabecalho, blocos);
    expect(montarPayloadInsumo({}, base)).toEqual({});
    expect(montarPayloadInsumo({ nome: "  Novo  ", observacoes: "  ", preco: null }, base)).toEqual(
      {
        nome: "Novo",
        observacoes: null,
        preco: null,
      },
    );
    expect(montarPayloadInsumo({ empresa_id: "emp2" }, base)).toEqual({
      empresa_id: "emp2",
      representante_id: null,
    });
    expect(montarPayloadInsumo({ representante_id: "rep1" }, base)).toEqual({
      empresa_id: "emp1",
      representante_id: "rep1",
    });
    expect(montarPayloadInsumo({ tipo_insumo_id: "" }, base)).toEqual({ tipo_insumo_id: null });
    expect(
      "vincular" in montarPayloadInsumo({ vincular: true, tamanho_vinculado: "40|M" }, base),
    ).toBe(false);
    // vínculo com cor de tamanho marcado e formato ambos: o Salvar limpa (Ruling A2) = continua null, nada a gravar
    expect(montarPayloadInsumo({ vincular: true, tamanho_vinculado: "40|M" }, base)).toEqual({});
    const semTam = insumoParaDraft({ ...cabecalho, formato_tamanho: "nenhum" }, blocos);
    expect(montarPayloadInsumo({ vincular: true, tamanho_vinculado: "40|M" }, semTam)).toEqual({
      tamanho_vinculado: "40|M",
    });
    const vinculado = insumoParaDraft({
      ...cabecalho,
      formato_tamanho: "nenhum",
      tamanho_vinculado: "40|M",
    });
    expect(montarPayloadInsumo({ vincular: false, tamanho_vinculado: null }, vinculado)).toEqual({
      tamanho_vinculado: null,
    });
    // trocar o formato para um com tamanho limpa o vínculo salvo
    expect(
      montarPayloadInsumo(
        { formato_tamanho: "ambos" },
        insumoParaDraft({ ...cabecalho, formato_tamanho: "nenhum", tamanho_vinculado: "40|M" }, [
          { cor_id: "", preco: null, tamanhos: ["34|PPP"] },
        ]),
      ),
    ).toEqual({
      formato_tamanho: "ambos",
      tamanho_vinculado: null,
    });
  });

  it("mensagens PT: 23505 do nome, 23505/23503 das variantes", () => {
    expect(mensagemSalvarInsumo({ code: "23505" })).toBe("Já existe um insumo com esse nome.");
    expect(mensagemSalvarVariantes({ code: "23505" })).toContain("cor e tamanho");
    expect(mensagemSalvarVariantes({ code: "23503" })).toContain("em uso");
  });
});

describe("salvar: UM Salvar parcial", () => {
  it("só salva o que está sujo, segue depois de uma falha e conta ok/erro", async () => {
    const chamadas: string[] = [];
    const item = (id: string, sujo: boolean, falha = false) => ({
      id,
      dirty: () => sujo,
      salvar: async () => {
        chamadas.push(id);
        if (falha) throw new ErroGrade("x");
      },
    });
    const r = await salvarEmOrdem([
      item("a", true),
      item("b", false),
      item("c", true, true),
      item("d", true),
    ]);
    expect(chamadas).toEqual(["a", "c", "d"]);
    expect(r).toEqual({ ok: 2, erro: 1 });
  });

  it("texto do toast: sucesso, parcial (aviso), tudo falhou (erro) e nada", () => {
    expect(textoResultadoSalvar({ ok: 1, erro: 0 })).toEqual({ tom: "sucesso", texto: "1 salvo." });
    expect(textoResultadoSalvar({ ok: 3, erro: 0 })).toEqual({
      tom: "sucesso",
      texto: "3 salvos.",
    });
    expect(textoResultadoSalvar({ ok: 2, erro: 1 })).toEqual({
      tom: "aviso",
      texto: "2 salvos, 1 com erro. Veja o aviso na linha.",
    });
    expect(textoResultadoSalvar({ ok: 0, erro: 2 }).tom).toBe("erro");
    expect(textoResultadoSalvar({ ok: 0, erro: 0 })).toEqual({
      tom: "aviso",
      texto: "Nada para salvar.",
    });
  });
});

describe("ordenar: por GRUPO (as cores de um insumo ficam juntas)", () => {
  const insumo = (id: string, nome: string, preco: number | null) => ({
    id,
    nome,
    unidade: "unidade",
    preco,
    empresa_id: null,
    observacoes: null,
    formato_tamanho: "ambos",
    tipo_insumo_id: null,
    tamanho_vinculado: null,
  });
  const linhas = montarLinhas(
    [insumo("A", "Beta", 5), insumo("B", "Alfa", null), insumo("C", "Gama", 1)],
    new Map([
      [
        "A",
        [
          { cor_id: "verde", preco: 9, tamanhos: [] },
          { cor_id: "azul", preco: 1, tamanhos: [] },
        ],
      ],
      ["C", [{ cor_id: "preto", preco: 4, tamanhos: [] }]],
    ]),
  );
  const ids = (ls: ReturnType<typeof montarLinhas>) => ls.map((l) => l.chave);

  it("coluna do insumo: ordena os grupos e mantém a ordem das cores; vazio por último", () => {
    expect(ids(ordenarLinhasPorColuna(linhas, byKey("nome")!, "asc"))).toEqual([
      "B:sem-cor",
      "A:verde",
      "A:azul",
      "C:preto",
    ]);
    expect(ids(ordenarLinhasPorColuna(linhas, byKey("preco")!, "asc"))).toEqual([
      "C:preto",
      "A:verde",
      "A:azul",
      "B:sem-cor", // sem preço fica no fim
    ]);
    expect(ids(ordenarLinhasPorColuna(linhas, byKey("nome")!, "desc"))[0]).toBe("C:preto");
  });

  it("coluna da cor: ordena as cores DENTRO do insumo e os grupos pela 1ª cor ordenada", () => {
    const asc = ids(ordenarLinhasPorColuna(linhas, byKey("preco_variante")!, "asc"));
    expect(asc).toEqual(["A:azul", "A:verde", "C:preto", "B:sem-cor"]);
    const desc = ids(ordenarLinhasPorColuna(linhas, byKey("preco_variante")!, "desc"));
    expect(desc).toEqual(["A:verde", "A:azul", "C:preto", "B:sem-cor"]);
  });

  it("usa o resolvedor de rótulo (nome da cor, não o id) e não muda a lista de entrada", () => {
    const antes = ids(linhas);
    const res = ordenarLinhasPorColuna(linhas, byKey("cor")!, "asc", (k, id) =>
      k === "cor" ? { verde: "Zebra", azul: "Abacate", preto: "Meio" }[id] : undefined,
    );
    expect(ids(res)).toEqual(["A:azul", "A:verde", "C:preto", "B:sem-cor"]);
    expect(ids(linhas)).toEqual(antes);
    expect(colunaOrdenavel({ key: "tamanhos" })).toBe(true);
  });
});

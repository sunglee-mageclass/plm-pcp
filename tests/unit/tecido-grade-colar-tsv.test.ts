// Colar do Excel (TSV) na grade de Tecidos — lib PURA (Task 8): parse do bloco, mapeamento âncora -> células e tecidos novos.
import { describe, it, expect } from "vitest";
import { COLUNAS_TECIDO } from "@/lib/tecido-grade/colunas";
import {
  TETO_LINHAS_NOVAS,
  agruparNovosTecidos,
  camposDaCor,
  ehBlocoColavel,
  mapearColagem,
  montarLookupsColagem,
  parseBlocoTsv,
  resumoColagem,
  type OpcoesColagem,
} from "@/lib/tecido-grade/colar-tsv";
import { validarTecidoNovo } from "@/lib/tecido-grade/linha-nova";

const idx = (key: string) => COLUNAS_TECIDO.findIndex((c) => c.key === key);

const OPCOES: OpcoesColagem = {
  empresas: [
    { id: "emp1", nome_fantasia: "Tecidos Suzy" },
    { id: "emp2", nome_fantasia: "Malharia Á" },
    { id: "emp3", nome_fantasia: "Dupla" },
    { id: "emp4", nome_fantasia: "dupla" },
  ],
  cores: [
    { id: "cor1", nome: "Azul" },
    { id: "cor2", nome: "Verde" },
  ],
  coresApelido: [
    { id: "ap1", nome: "Marinho", cor_base_id: "cor1" },
    { id: "ap2", nome: "Musgo", cor_base_id: "cor2" },
    { id: "ap3", nome: "Petróleo", cor_base_id: "cor1" },
  ],
  meses: [{ id: "m1", mes: "Janeiro" }],
  anos: [{ id: "y1", ano: "2026" }],
};
const LK = montarLookupsColagem(OPCOES);

describe("parseBlocoTsv", () => {
  it("divide por TAB e por quebra de linha", () => {
    expect(parseBlocoTsv("a\tb\tc\nd\te\tf")).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
  });
  it("aceita CRLF e CR", () => {
    expect(parseBlocoTsv("a\tb\r\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseBlocoTsv("a\rb")).toEqual([["a"], ["b"]]);
  });
  it("descarta a última linha vazia (quebra final do Excel)", () => {
    expect(parseBlocoTsv("a\tb\r\n")).toEqual([["a", "b"]]);
    expect(parseBlocoTsv("a\n\n")).toEqual([["a"]]); // a linha vazia do fim também
    expect(parseBlocoTsv("a\n\nb")).toEqual([["a"], [""], ["b"]]); // linha vazia no MEIO é dado
    expect(parseBlocoTsv("")).toEqual([]);
  });
  it("mantém células vazias no meio e no fim da linha", () => {
    expect(parseBlocoTsv("a\t\tc\nx\t")).toEqual([["a", "", "c"], ["x", ""]]);
  });
  it("campo entre aspas pode ter TAB, quebra e aspas (aspas duplas = literal)", () => {
    expect(parseBlocoTsv('"95% Viscose\n5% Elastano"\tNCM1\n"a\tb"\t"diz ""oi"""')).toEqual([
      ["95% Viscose\n5% Elastano", "NCM1"],
      ["a\tb", 'diz "oi"'],
    ]);
  });
  it("aspas no meio de um campo sem aspas no início são texto comum; aspas que não fecham não travam", () => {
    expect(parseBlocoTsv('5" tela\tx')).toEqual([['5" tela', "x"]]);
    expect(parseBlocoTsv('"abc\tdef')).toEqual([["abc\tdef"]]);
  });
});

describe("ehBlocoColavel", () => {
  it("1 valor simples segue o colar normal; várias linhas/colunas viram bloco", () => {
    expect(ehBlocoColavel("Malha")).toBe(false);
    expect(ehBlocoColavel("Malha\r\n")).toBe(false);
    expect(ehBlocoColavel("a\tb")).toBe(true);
    expect(ehBlocoColavel("a\nb")).toBe(true);
  });
  it("célula única entre aspas com quebra dentro (Composição do Excel) é tratada como bloco", () => {
    expect(ehBlocoColavel('"95% Viscose\n5% Elastano"')).toBe(true);
    expect(ehBlocoColavel('"entre aspas simples"')).toBe(false);
  });
});

describe("mapearColagem — posição", () => {
  it("cada célula cai em (linha+i, coluna+j) a partir da âncora", () => {
    const r = mapearColagem({ linhaIdx: 2, colIdx: idx("nome") }, [["Malha A", "Tecidos Suzy"], ["Malha B", "Malharia A"]], COLUNAS_TECIDO, 10, { lookups: LK });
    expect(r.patches.map((p) => [p.linhaIdx, p.colKey, p.valor])).toEqual([
      [2, "nome", "Malha A"],
      [2, "fornecedor", "emp1"],
      [3, "nome", "Malha B"],
      [3, "fornecedor", "emp2"], // sem acento/caixa, como o importador
    ]);
    expect(r.novasLinhas).toEqual([]);
    expect(r.ignoradas).toEqual([]);
  });

  it("colunas além da última viram ignoradas (transbordo); vazias no transbordo não contam", () => {
    const ultima = COLUNAS_TECIDO.length - 1;
    const r = mapearColagem({ linhaIdx: 0, colIdx: ultima - 1 }, [["x", "y", "z", ""]], COLUNAS_TECIDO, 5, { lookups: LK });
    expect(r.ignoradas.filter((g) => g.motivo === "transbordo").map((g) => g.textoBruto)).toEqual(["z"]);
  });

  it("coluna só-leitura, foto e categorias são puladas (não gravam) e a próxima coluna segue na posição certa", () => {
    // preço por metro (última), foto e categorias são puladas; ncm/rendimento/etc. continuam
    const r = mapearColagem({ linhaIdx: 0, colIdx: idx("ncm") }, [["6006", "2,5", "Janeiro", "2026", "Malha", "Azul"]], COLUNAS_TECIDO, 3, {
      lookups: LK,
      contextoLinha: () => ({ corId: "", unidade: "kg" }),
    });
    expect(r.patches.map((p) => p.colKey)).toEqual(["ncm", "rendimento", "mes", "ano", "cor_base"]);
    const nao = r.ignoradas.find((g) => g.colKey === "categorias");
    expect(nao?.motivo).toBe("coluna-nao-colavel");

    const ro = mapearColagem({ linhaIdx: 0, colIdx: idx("foto") }, [["x.jpg", "10"]], COLUNAS_TECIDO, 3, { lookups: LK });
    expect(ro.patches).toEqual([]);
    expect(ro.ignoradas.map((g) => [g.colKey, g.motivo])).toEqual([["foto", "coluna-nao-colavel"], ["preco_por_metro", "coluna-nao-colavel"]]);
  });

  it("linha recusada pela grade (tecido sem cores / cabeçalho herdado) vira ignorada", () => {
    const r = mapearColagem({ linhaIdx: 0, colIdx: idx("nome_variante") }, [["Var"], ["Var2"]], COLUNAS_TECIDO, 2, {
      lookups: LK,
      aceitaCelula: (linha) => (linha === 1 ? "este tecido ainda não tem cores" : null),
    });
    expect(r.patches.map((p) => p.linhaIdx)).toEqual([0]);
    expect(r.ignoradas).toMatchObject([{ linhaIdx: 1, motivo: "linha-nao-aceita" }]);
  });

  it("linha além do fim da grade vira linha NOVA (não patch)", () => {
    const r = mapearColagem({ linhaIdx: 1, colIdx: idx("nome") }, [["Existe"], ["Nova 1", "Tecidos Suzy"], ["Nova 2"]], COLUNAS_TECIDO, 2, { lookups: LK });
    expect(r.patches.map((p) => [p.linhaIdx, p.valor])).toEqual([[1, "Existe"]]);
    expect(r.novasLinhas).toHaveLength(2);
    expect(r.novasLinhas[0].map((c) => [c.colKey, c.valor])).toEqual([["nome", "Nova 1"], ["fornecedor", "emp1"]]);
    expect(r.novasLinhas[1].map((c) => c.valor)).toEqual(["Nova 2"]);
  });

  it("teto de linhas novas: corta no teto e conta as cortadas", () => {
    const bloco = Array.from({ length: TETO_LINHAS_NOVAS + 37 }, (_, i) => [`T${i}`]);
    const r = mapearColagem({ linhaIdx: 0, colIdx: idx("nome") }, bloco, COLUNAS_TECIDO, 0, { lookups: LK });
    expect(r.novasLinhas).toHaveLength(TETO_LINHAS_NOVAS);
    expect(r.novasCortadas).toBe(37);
    const menor = mapearColagem({ linhaIdx: 0, colIdx: idx("nome") }, bloco.slice(0, 5), COLUNAS_TECIDO, 0, { lookups: LK, tetoNovas: 3 });
    expect(menor.novasLinhas).toHaveLength(3);
    expect(menor.novasCortadas).toBe(2);
  });
});

describe("mapearColagem — texto -> valor", () => {
  const colar = (col: string, texto: string, ctx = { corId: "", unidade: "metro" }) =>
    mapearColagem({ linhaIdx: 0, colIdx: idx(col) }, [[texto]], COLUNAS_TECIDO, 1, { lookups: LK, contextoLinha: () => ctx });

  it("número no formato BR (vírgula decimal, milhar com ponto, R$) e arredonda em 2 casas", () => {
    expect(colar("preco", "1.234,50").patches[0].valor).toBe(1234.5);
    expect(colar("preco", "R$ 28,00").patches[0].valor).toBe(28);
    expect(colar("preco_variante", "2.34").patches[0].valor).toBe(2.34);
    expect(colar("largura_estimada", "1,456").patches[0].valor).toBe(1.46);
  });
  it("número inválido não grava (ignorada com motivo)", () => {
    const r = colar("preco", "abc");
    expect(r.patches).toEqual([]);
    expect(r.ignoradas[0]).toMatchObject({ colKey: "preco", motivo: "numero-invalido" });
    expect(colar("preco", "-3").patches).toEqual([]);
  });
  it("célula vazia limpa o que é opcional e NÃO apaga o obrigatório", () => {
    expect(colar("preco", "").patches[0].valor).toBeNull();
    expect(colar("ncm", "").patches[0].valor).toBeNull();
    expect(colar("fornecedor", "").patches[0].valor).toBeNull();
    for (const obrigatoria of ["nome", "unidade", "cor_base"]) {
      const r = colar(obrigatoria, "");
      expect([r.patches, r.ignoradas]).toEqual([[], []]); // pula sem apagar e sem barulho
    }
  });
  it("fornecedor/cor/mês/ano pelo NOME (sem acento, sem caixa)", () => {
    expect(colar("fornecedor", "  tecidos SUZY ").patches[0].valor).toBe("emp1");
    expect(colar("cor_base", "azul").patches[0].valor).toBe("cor1");
    expect(colar("mes", "janeiro").patches[0].valor).toBe("m1");
    expect(colar("ano", "2026").patches[0].valor).toBe("y1");
  });
  it("nome que não existe no cadastro NÃO grava: vira aviso, com sugestão", () => {
    const r = colar("cor_base", "Azzul");
    expect(r.patches).toEqual([]);
    expect(r.ignoradas[0]).toMatchObject({ motivo: "sem-correspondencia", colKey: "cor_base" });
    expect(r.ignoradas[0].detalhe).toContain('"Azul"');
    expect(colar("fornecedor", "Nao existe").ignoradas[0].motivo).toBe("sem-correspondencia");
    expect(colar("mes", "Fevereiro").ignoradas[0].motivo).toBe("sem-correspondencia");
  });
  it("fornecedor homônimo: usa o primeiro, com aviso", () => {
    const p = colar("fornecedor", "dupla").patches[0];
    expect(p.valor).toBe("emp3");
    expect(p.aviso).toContain("Mais de um fornecedor");
  });
  it("unidade: metro/kg e apelidos comuns; outra coisa não grava", () => {
    expect(colar("unidade", "KG").patches[0].valor).toBe("kg");
    expect(colar("unidade", "Metros").patches[0].valor).toBe("metro");
    expect(colar("unidade", "litro").ignoradas[0].motivo).toBe("sem-correspondencia");
  });
  it("rendimento só vale em Kg (lê a unidade da linha ou a que veio no mesmo bloco)", () => {
    expect(colar("rendimento", "3,5", { corId: "", unidade: "metro" }).ignoradas[0].motivo).toBe("regra");
    expect(colar("rendimento", "3,5", { corId: "", unidade: "kg" }).patches[0].valor).toBe(3.5);
    const junto = mapearColagem({ linhaIdx: 0, colIdx: idx("unidade") }, [["kg", "", "", "", "2,8"]], COLUNAS_TECIDO, 1, { lookups: LK });
    expect(junto.patches.map((p) => [p.colKey, p.valor])).toEqual([["unidade", "kg"], ["largura_estimada", null], ["composicao", null], ["ncm", null], ["rendimento", 2.8]]);
  });
  it("apelido: precisa pertencer à cor base (a da linha ou a colada junto)", () => {
    expect(colar("cor_apelido", "Marinho", { corId: "cor1", unidade: "metro" }).patches[0].valor).toBe("ap1");
    const errado = colar("cor_apelido", "Musgo", { corId: "cor1", unidade: "metro" });
    expect(errado.patches).toEqual([]);
    expect(errado.ignoradas[0].detalhe).toContain('não pertence à cor "Azul"');
    // cor base e apelido no mesmo bloco: o apelido usa a cor que acabou de ser colada
    const junto = mapearColagem({ linhaIdx: 0, colIdx: idx("cor_base") }, [["Verde", "musgo"]], COLUNAS_TECIDO, 1, { lookups: LK });
    expect(junto.patches.map((p) => p.valor)).toEqual(["cor2", "ap2"]);
    // sem cor na linha: apelido único em todo o cadastro vale (e informa a cor dele)
    const solto = colar("cor_apelido", "Petróleo");
    expect(solto.patches[0].valor).toBe("ap3");
  });
  it("composição preserva as quebras de linha internas", () => {
    expect(colar("composicao", "95% Viscose\n5% Elastano").patches[0].valor).toBe("95% Viscose\n5% Elastano");
  });
});

describe("camposDaCor", () => {
  const apelidos = OPCOES.coresApelido;
  it("trocar a cor base tira o apelido que não é dela; mantém o que é", () => {
    expect(camposDaCor("cor_base", "cor2", { cor_id: "cor1", cor_apelido_id: "ap1" }, apelidos)).toEqual({ cor_id: "cor2", cor_apelido_id: "" });
    expect(camposDaCor("cor_base", "cor1", { cor_id: "cor2", cor_apelido_id: "ap1" }, apelidos)).toEqual({ cor_id: "cor1", cor_apelido_id: "ap1" });
  });
  it("escolher o apelido preenche a cor base dele; apelido vazio só limpa o apelido", () => {
    expect(camposDaCor("cor_apelido", "ap2", { cor_id: "", cor_apelido_id: "" }, apelidos)).toEqual({ cor_id: "cor2", cor_apelido_id: "ap2" });
    expect(camposDaCor("cor_apelido", "", { cor_id: "cor1", cor_apelido_id: "ap1" }, apelidos)).toEqual({ cor_apelido_id: "" });
  });
  it("demais colunas da cor vão para o campo do rascunho", () => {
    expect(camposDaCor("preco_variante", 12.5, { cor_id: "cor1", cor_apelido_id: "" }, apelidos)).toEqual({ preco: 12.5 });
    expect(camposDaCor("codigo_variante", "X1", { cor_id: "cor1", cor_apelido_id: "" }, apelidos)).toEqual({ codigo_variante: "X1" });
  });
});

describe("agruparNovosTecidos", () => {
  const colarNovas = (bloco: string[][], col = "nome") =>
    mapearColagem({ linhaIdx: 0, colIdx: idx(col) }, bloco, COLUNAS_TECIDO, 0, { lookups: LK }).novasLinhas;

  it("linhas seguidas com o mesmo nome são cores do MESMO tecido; nome diferente = outro tecido", () => {
    const linhas = colarNovas([
      ["Malha Fiore", "Tecidos Suzy", "28,00", "metro", "", "", "", "", "", "", "", "Azul", "Marinho"],
      ["malha fiore", "", "", "", "", "", "", "", "", "", "", "Verde"],
      ["Crepe", "", "10,00"],
    ]);
    const { grupos, varTmpPorLinha } = agruparNovosTecidos(linhas, OPCOES.coresApelido);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].cab).toMatchObject({ nome: "Malha Fiore", empresa_id: "emp1", preco: 28, unidade_medida: "metro" });
    expect(grupos[0].vars.map((v) => [v.cor_id, v.cor_apelido_id])).toEqual([["cor1", "ap1"], ["cor2", ""]]);
    expect(grupos[1].cab.nome).toBe("Crepe");
    expect(varTmpPorLinha).toEqual([grupos[0].vars[0].tmp, grupos[0].vars[1].tmp, grupos[1].vars[0].tmp]);
  });

  it("o cabeçalho vale o da 1ª linha do tecido (as seguintes só trazem a cor)", () => {
    const linhas = colarNovas([["A", "Tecidos Suzy", "5,00"], ["A", "Malharia A", "9,00"]]);
    const { grupos } = agruparNovosTecidos(linhas, OPCOES.coresApelido);
    expect(grupos[0].cab).toMatchObject({ empresa_id: "emp1", preco: 5 });
  });

  it("sem nome = um tecido por linha, PENDENTE (a Task 7 pinta de vermelho); com nome e cor base = válido", () => {
    const semNome = agruparNovosTecidos(colarNovas([["Azul"], ["Verde"]], "cor_base"), OPCOES.coresApelido);
    expect(semNome.grupos).toHaveLength(2);
    expect(semNome.grupos.every((g) => !validarTecidoNovo(g).ok)).toBe(true);
    const completo = agruparNovosTecidos(colarNovas([["Cetim", "", "", "", "", "", "", "", "", "", "", "Azul"]]), OPCOES.coresApelido);
    expect(validarTecidoNovo(completo.grupos[0]).ok).toBe(true);
  });

  it("cor/apelido: o apelido da linha nova só entra se combinar com a cor base", () => {
    const linhas = colarNovas([["T1", "", "", "", "", "", "", "", "", "", "", "Azul", "Musgo"]]);
    // "Musgo" não pertence a Azul: nem chegou a virar valor (ignorada no mapeamento)
    const { grupos } = agruparNovosTecidos(linhas, OPCOES.coresApelido);
    expect(grupos[0].vars[0]).toMatchObject({ cor_id: "cor1", cor_apelido_id: "" });
  });

  it("aviso (fornecedor homônimo) chega com o índice da linha nova", () => {
    const linhas = colarNovas([["T1", "dupla"]]);
    expect(agruparNovosTecidos(linhas, []).avisos).toMatchObject([{ linhaNovaIdx: 0, colKey: "fornecedor" }]);
  });
});

describe("resumoColagem", () => {
  it("monta 'Coladas N células em M linhas · P novas · Q ignoradas' e o detalhe por motivo", () => {
    const r = mapearColagem({ linhaIdx: 0, colIdx: idx("nome") }, [["A", "Nao existe"], ["B"], ["Nova"]], COLUNAS_TECIDO, 2, { lookups: LK });
    const s = resumoColagem(r);
    expect(s.texto).toBe("Coladas 3 células em 3 linhas · 1 nova · 1 ignorada");
    expect(s.tom).toBe("aviso");
    expect(s.detalhe).toContain("sem correspondência no cadastro");
  });
  it("sem ignoradas = sucesso; corte do teto aparece no detalhe", () => {
    const ok = resumoColagem(mapearColagem({ linhaIdx: 0, colIdx: 0 }, [["A"]], COLUNAS_TECIDO, 1, { lookups: LK }));
    expect(ok).toMatchObject({ tom: "sucesso", detalhe: undefined });
    const cortada = resumoColagem(mapearColagem({ linhaIdx: 0, colIdx: 0 }, [["A"], ["B"], ["C"]], COLUNAS_TECIDO, 0, { lookups: LK, tetoNovas: 1 }));
    expect(cortada.tom).toBe("aviso");
    expect(cortada.detalhe).toContain("cortadas");
  });
});

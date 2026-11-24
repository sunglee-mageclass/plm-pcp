// Toggle Cards|Lista do Planejamento de Produto (PR-1): asserções de FONTE sobre `criacao.planejamento.tsx` (a rota inteira é pesada
// demais para montar num teste de unidade — mesmo recurso dos testes `f5-dev-somente-leitura*`). Falham se a fiação for apagada.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const fonte = readFileSync("src/routes/_authenticated/criacao.planejamento.tsx", "utf8");

describe("criacao.planejamento — toggle Cards|Lista", () => {
  it("a visão é preferência POR USUÁRIO (user_ui_prefs), padrão Cards", () => {
    expect(fonte).toContain('useUserPref("filtro", "planejamento", "visao", ["cards"])');
  });

  it("no celular força Cards e avisa quando a preferência salva era Lista", () => {
    expect(fonte).toMatch(/const visao: "cards" \| "lista" = isMobile \? "cards" : visaoSalva;/);
    expect(fonte).toContain("avisoListaMobile");
    expect(fonte).toContain("A lista tipo Excel é usada no computador");
  });

  it("a Lista recebe os produtos JÁ filtrados e ORDENADOS pela tela (`sorted`) e avisa o rascunho à guarda", () => {
    expect(fonte).toMatch(
      /<ProdutosGradeAba modelos=\{sorted\} isMobile=\{isMobile\} onDirtyChange=\{guarda\.aoMudarSujo\} \/>/,
    );
    expect(fonte).toContain("{guarda.dialog}");
  });

  it("trocar para Cards e a busca passam pela guarda de alterações não salvas", () => {
    expect(fonte).toContain('onClick={guarda.proteger(() => setVisaoPref(["cards"]))}');
    expect(fonte).toContain("onChange={guarda.proteger(setSearch)}");
  });

  it("controles só dos cards somem na Lista (Colunas, expandir/recolher grupos, legenda do kanban)", () => {
    expect(fonte).toContain('${visao === "cards" ? "hidden lg:flex" : "hidden"}');
    expect(fonte).toContain('visao === "cards" && groups && allGroupPaths.length > 0');
    expect(fonte).toContain('visao === "cards" && filtered.length > 0 && <EtapaKanbanLegenda');
  });

  it("a query do card NÃO foi tocada (a grade tem a PRÓPRIA consulta)", () => {
    expect(fonte).toContain('queryKey: ["modelos-planejamento"],');
    expect(fonte).not.toContain("subcategoria2_id, status_planejamento, fotos_modelo"); // select do card segue o de antes
  });
});

describe("criacao.planejamento — guarda do rascunho da Lista (PR-2)", () => {
  const FILTROS = [
    "setFStatus",
    "setFLancamento",
    "setFEtapaKanban",
    "setFEstilista",
    "setFSemana",
    "setFMes",
    "setFAno",
    "setFGrupo",
    "setFCat",
    "setFSub1",
    "setFColecao",
    "setFSubcolecao",
    "setFOrigem",
    "setFRep",
  ];

  it("os 14 filtros do FilterButton passam pela guarda (rascunho sujo pede confirmação antes de filtrar)", () => {
    for (const f of FILTROS) {
      expect(fonte, f).toContain(`onChange: guarda.proteger(${f}),`);
      expect(fonte, `${f} sem guarda`).not.toContain(`onChange: ${f},`);
    }
    // o FilterButton do planejamento tem exatamente esses 14 (um filtro novo sem guarda reprova aqui)
    const bloco = fonte.slice(fonte.indexOf('<FilterButton\n            screen="planejamento"'));
    const ate = bloco.slice(0, bloco.indexOf("/>"));
    expect((ate.match(/onChange:/g) ?? []).length).toBe(FILTROS.length);
    expect((ate.match(/onChange: guarda\.proteger\(/g) ?? []).length).toBe(FILTROS.length);
  });

  it("'Editar Fam.' também filtra a tela (coleção/subcoleção): passa pela mesma guarda", () => {
    expect(fonte).toContain("const setEscopoCol = guarda.proteger(");
    expect(fonte).toContain("const setEscopoSub = guarda.proteger(");
  });

  it("busca e volta para Cards continuam guardadas; a guarda é a de 'produtos'", () => {
    expect(fonte).toContain('useGuardaTrocaLista("produtos")');
    expect(fonte).toContain("onChange={guarda.proteger(setSearch)}");
    expect(fonte).toContain('onClick={guarda.proteger(() => setVisaoPref(["cards"]))}');
    expect(fonte).toContain("onDirtyChange={guarda.aoMudarSujo}");
  });
});

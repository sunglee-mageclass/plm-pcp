import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const tela = readFileSync(ROOT + "src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx", "utf8");
const conta = (s: string) => tela.split(s).length - 1;

describe("Direcionamento — plano do modelo (Task 7)", () => {
  it("lê a RPC nova e não a antiga (P-14/P-16)", () => {
    expect(tela).toContain('"direcionamento_plano_modelo"');
    expect(tela).toContain('["dir-plano-modelo", modeloId]');
    expect(tela).not.toContain("direcionamento_resumo_subcolecao");
    expect(tela).not.toContain("dir-resumo-subcol");
    expect(tela).not.toContain("OrcamentoTag");
  });
  it("servidor intocado (#10): mesmo payload de estado completo no Salvar e no Confirmar", () => {
    expect(conta("_rows: buildRows(), _rev_base: { dir: revRef.current }")).toBe(2);
  });
  it("presença: TODA célula digitável (pré-preenchida ou vazia) mantém data-colab-path dir:… (desktop e mobile)", () => {
    expect(conta("<NumberInput")).toBe(2);
    expect(conta("data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}")).toBe(2);
    expect(tela).toContain("placeholder={est.placeholder}");
  });
  it("rascunho do plano conta como MINHA edição (merge 3-vias) e NÃO como alteração não salva (P-32 = B)", () => {
    expect(tela).toContain("touchedRef.current = new Set(p?.escritas ?? []);");
    expect(tela).toContain("resetBaseline(p ? p.obj : obj);");
    expect(tela).toContain("setState(p ? p.obj : obj);");
  });
  it("textos: Grade Real com InfoHover, 'faltam N', callout e 'Preencher com o plano?'", () => {
    expect(tela).toContain("Grade Real = o que voltou da recepção dos serviços, já sem os defeitos do CQ.");
    expect(tela).toContain("`faltam ${-d.delta}`");
    expect(tela).toContain("Preenchido pelo plano onde bateu com a Grade Real");
    expect(tela).toContain("Preencher com o plano?");
    expect(tela).toContain("modelos direcionados");
  });
  it("M10/M11 (T7 fix2): a hidratação espera o plano E as lojas pararem de refetchar antes de semear (senão semeia com dado antigo)", () => {
    expect(tela).toContain("isFetching: planoFetching");
    expect(tela).toContain("isFetching: lojasFetching");
    expect(tela).toContain("if (!dataSettled || planoFetching || lojasFetching) return;");
    expect(tela).toContain("hydrated, dataSettled, planoFetching, lojasFetching, plano, readOnly");
  });
  it("I1 (T7 fix2): a regra do preenchimento recebe a base do SERVIDOR (não conta pendentes/0-sobre-0 como minha edição)", () => {
    expect(tela).toContain("base: baseServidor");
    expect(tela).toContain("baseServidor: GradeDir = baseGradeRef.current");
    // Correção (b): rascunho do plano intacto + linhas novas do servidor ⇒ re-hidrata do fresh (não merge normal).
    expect(tela).toContain("if (preench.aplicado && !changed && (existing as any[]).length > 0)");
  });
  it("M5 (T7 fix2): 'Preencher com o plano?' só confirma se há número DIGITADO (não conta o que o plano já escreveu)", () => {
    expect(tela).toContain("!preench.doPlano.has(pathDirCel(v.variante_numero, lojaId, t))");
  });
  it("M2 (T7 fix2): os totais do plano exibidos (Grade Real Total, callout) usam as lojas EDITÁVEIS", () => {
    expect(conta("totalPlanoVariante(plano, v.variante_numero, lojasEditaveisDe(v.variante_numero))")).toBe(3);
  });
  it("M9 (T7 fix2): o rótulo de conflito usa o rótulo de tamanho da loja, não a chave crua", () => {
    expect(tela).toContain("`${nome} · ${rotuloTam(tam)} (var ${vnum})`");
  });
  it("M7 (T7 fix2): o callout de referência do plano só aparece com alguma variante na tela", () => {
    expect(tela).toContain("{preench.aplicado && plano && variantes.length > 0 && (() => {");
  });
  it("N1 (T7 fix3): base é OBRIGATÓRIA em preencherComPlano — nada cai em silêncio no 'servidor vazio'", () => {
    // A rota sempre passa `baseServidor` explícito (nunca omite o parâmetro `base`).
    expect(tela).toContain("base: baseServidor");
  });
  it("N2 (T7 fix3): a re-hidratação do rascunho intacto avisa 'alguém salvou agora' (ultimoMerge real, não null)", () => {
    expect(tela).toContain("const mgReseed = mergeGradeDir({ base: baseGradeRef.current, meu: stateToGradeDir(state), fresh, tocadas: new Set() });");
    expect(tela).toContain("setUltimoMerge({ atualizados: mgReseed.atualizados.length, conflitos: [] });");
    expect(tela).not.toContain("setUltimoMerge(null);\n      return;\n    }\n    const meu = stateToGradeDir(state);");
  });
});

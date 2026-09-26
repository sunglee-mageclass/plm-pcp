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
});

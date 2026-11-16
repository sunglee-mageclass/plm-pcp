// "Regerar REF" - fiacao no orquestrador (PlanejamentoDetail) e nos 3 pontos de configuracao (asserções de FONTE; o comportamento esta nos testes de
// render/hook). Falha se alguem apagar uma guarda: previa de SKUs com a REF NOVA, Salvar = RPC atomica no lugar de aplicar_skus_modelo, confirmacao dos
// conflitos no clique do Salvar, origem GRAVADA (nunca o rascunho) e o botao fora do Dev antigo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");
const PD = ler("src/components/planejamento/PlanejamentoDetail.tsx");

describe("PlanejamentoDetail - fiacao do Regerar REF", () => {
  it("estado 'REF a gravar' declarado logo depois do 'a gravar' dos SKUs e ANTES do dirty (que ja o enxerga por skusAGravar.regerar)", () => {
    const iAGravar = PD.indexOf("const skusAGravar = useSkusAGravar();");
    const iRegerar = PD.indexOf("const regerarRef = useRegerarRef({");
    const iDirty = PD.indexOf("const dirty = draftDirty ||");
    expect(iAGravar).toBeGreaterThan(0);
    expect(iRegerar).toBeGreaterThan(iAGravar);
    expect(iDirty).toBeGreaterThan(iRegerar);
    expect(PD).toContain("entrada: { ref: draft.ref, categoria: draft.categoria_principal_id, sub1: draft.subcategoria1_id },");
    expect(PD).toContain("!nadaAGravar(skusAGravar.aGravar)");
  });
  it("a previa de SKUs (hook E props da secao) usa a REF NOVA quando ha 'REF a gravar'", () => {
    expect(PD.match(/regerarRef\.pendente\?\.refNova \?\? refParaPrevia\(\{ refVaiNoSalvar: refEditavel/g)?.length).toBe(2);
  });
  it("aoSalvar: com 'REF a gravar' chama a RPC ATOMICA (aplicarRegerarRef) e RETORNA - nunca cai no aplicarAGravar; sem ela, o fluxo de sempre", () => {
    const i = PD.indexOf("const aoSalvar = async () => {");
    const fim = PD.indexOf("// Salvar (+ retry/merge do P0409)", i);
    const corpo = PD.slice(i, fim);
    const iRef = corpo.indexOf("skus.aplicarRegerarRef({ refNova: pendente.refNova, confirmaManual: pendente.confirmaManual })");
    const iRet = corpo.indexOf("return;", iRef);
    const iAplicar = corpo.indexOf("skus.aplicarAGravar()");
    expect(iRef).toBeGreaterThan(0);
    expect(iRet).toBeGreaterThan(iRef);
    expect(iAplicar).toBeGreaterThan(iRet); // o aplicarAGravar so roda sem 'REF a gravar'
    expect(corpo).toContain("regerarRef.marcarGravando(true)");
    expect(corpo).toContain("regerarRef.marcarGravando(false)");
    expect(corpo).toMatch(/if \(rr === "ok"\) \{\s+regerarRef\.limpar\(\);\s+await skus\.gerarSeFaltar\(\);/);
  });
  it("o clique do Salvar pergunta ANTES se ha SKUs em conflito (AlertDialog) e o dialogo e renderizado; as linhas pinadas por outros testes seguem intactas", () => {
    expect(PD).toContain("onClick={salvarComConfirmacaoRegerar}");
    expect(PD).toContain("{dialogRegerarRef}");
    expect(PD).toMatch(/if \(nConflitos > 0\) pedirRegerarRef\(\{ \.\.\.textoRegerarRefConflitos\(nConflitos\), onConfirmar: \(\) => salvarComConfirmacaoPT\(\) \}\);/);
    expect(PD).toMatch(/const refEditavel = isEdit && !devBloqueado && kanbanCard\.refNaEtapa && !travaIntegracao\.has\("ref"\);/);
    expect(PD).toMatch(/podeEditarPlanejamento && !travaIntegracao\.has\("sku"\), \{/);
  });
  it("props da secao: origem GRAVADA (modeloData, nunca o rascunho) e rascunho limpo = REF + categoria + sub1 iguais as salvas", () => {
    expect(PD).toContain('origemInterno={((modeloData as any)?.origem ?? "interno") === "interno"}');
    expect(PD).toContain("regerarRef={regerarRef}");
    expect(PD).toMatch(/rascunhoLimpo=\{draft\.ref === \(\(modeloData as any\)\?\.ref \?\? ""\)\s+&& draft\.categoria_principal_id === \(\(modeloData as any\)\?\.categoria_principal_id \?\? null\)\s+&& draft\.subcategoria1_id === \(\(modeloData as any\)\?\.subcategoria1_id \?\? null\)\}/);
  });
  it("o botao NAO foi para o Dev antigo (ModeloInfoSection) nem para o ModeloDetailPanel", () => {
    for (const p of ["src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx", "src/components/desenvolvimento/ModeloDetailPanel.tsx"]) {
      expect(ler(p), p).not.toMatch(/Regerar REF|useRegerarRef|regerar_ref_card|ref_regerar_previa/);
    }
  });
});

describe("Regerar REF - so o banco calcula a REF (sem espelho TS) e so chama as 2 RPCs", () => {
  it("nenhum arquivo da tela monta/calcula a REF nova; so ref_regerar_previa e regerar_ref_card sao chamadas", () => {
    for (const p of ["src/lib/ref-regerar.ts", "src/components/planejamento/planejamento-detail/codigos/useRegerarRef.ts"]) {
      const t = ler(p);
      expect(t, p).not.toMatch(/_modelo_ref_sigla|_ref_juntar|_ref_num_fmt|substring\(|next_num/);
    }
    expect(ler("src/lib/ref-regerar.ts")).toContain('export const RPC_REF_REGERAR_PREVIA = "ref_regerar_previa" as const;');
    expect(ler("src/lib/ref-regerar.ts")).toContain('export const RPC_REGERAR_REF_CARD = "regerar_ref_card" as const;');
  });
});

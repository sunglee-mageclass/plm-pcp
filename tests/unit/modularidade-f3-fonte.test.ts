// [modularidade F3] Anti-regressão em texto-fonte: o Dashboard só chama a RPC do módulo ligado, a aba Comercial filtra pelo
// rótulo da coleção, o Lançar usa a regra única e as telas de coleção não prometem apagar cards.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");

describe("Dashboard — abas e blocos por módulo (M7, T1 M4)", () => {
  const f = ler("src/routes/_authenticated/dashboard.tsx");
  it("Dashboard e DashTabsList usam a MESMA lista (useAbasVisiveis → abasVisiveis)", () => {
    expect(f).toContain("return abasVisiveis(DASH_TABS, canView, isModuleEnabled);");
    expect((f.match(/const tabs = useAbasVisiveis\(\);/g) ?? []).length).toBe(2);
    expect(f).not.toMatch(/DASH_TABS\.filter\(/);
  });
  it("Custo & Financeiro: dashboard_financeiro/estoque_parado só com Financeiro e dashboard_custos só com Criação", () => {
    const i = f.indexOf("function CustoFinanceiroTab()");
    const corpo = f.slice(i, f.indexOf("/* ============================ CUSTOS", i));
    expect(corpo).toMatch(/queryKey: \["dash-financeiro", ini, fim\],\s*\n\s*enabled: comFin,/);
    expect(corpo).toMatch(/queryKey: \["dash-estoque-parado"\],\s*\n\s*enabled: comFin,/);
    expect(corpo).toMatch(/queryKey: \["dash-custos", ini, fim, "all", "all", "all"\],\s*\n\s*enabled: comCustos,/);
    // cada bloco some sem o módulo dele
    expect(corpo).toContain("{comFin && (");
    expect(corpo).toContain("{comCustos && cardDiverg}");
    expect(corpo).toContain("{comFin && cardAPagar}");
    expect(corpo).toContain("{comCustos && (");
  });
  it("Comercial & Coleção: opções e filtro pelo rótulo (`rotuloColecao`), sem `.eq(\"colecao\", …)` cru", () => {
    const i = f.indexOf("function ComercialColecaoTab()");
    const corpo = f.slice(i, i + 4000);
    expect(f).toContain('import { rotuloColecao } from "@/lib/colecao-rotulo";');
    expect(corpo).toContain('select("colecao, subcolecao, colecoes(nome)")');
    expect(corpo).toContain("rotuloColecaoDoCard(m)");
    expect(corpo).not.toContain('q.eq("colecao"');
    expect(corpo).toContain("rows.filter((m) => m.colecao === fColecao)");
  });
});

describe("Lançar sem Produção (P-252 A)", () => {
  const det = ler("src/components/planejamento/PlanejamentoDetail.tsx");
  const lista = ler("src/routes/_authenticated/criacao.planejamento.tsx");
  it("o Sheet do Planejamento cobra o CQ só com `isModuleEnabled(\"producao\")` e usa a regra única nos 2 pontos", () => {
    expect(det).toContain('const cqExigido = isModuleEnabled("producao");');
    expect((det.match(/bloqueiosLancar\(\{ cqExigido,/g) ?? []).length).toBe(2);
    expect(det).not.toContain('throw new Error("Confirme o Controle de Qualidade antes de lançar.")');
  });
  it("o foguete do card da lista segue a mesma regra e o texto sem Produção", () => {
    expect(lista).toContain('const cqExigido = isModuleEnabled("producao");');
    expect(lista).toContain("prontoParaLancar({ cqExigido,");
    expect(lista).toContain("textoLancarExige(cqExigido)");
  });
});

describe("Excluir coleção com cards (P-255 A)", () => {
  const dlg = ler("src/components/otb/ExcluirColecaoDialog.tsx");
  it("as 2 telas usam o diálogo compartilhado e saiu a promessa de apagar os cards", () => {
    for (const f of ["src/components/otb/ColecaoSheet.tsx", "src/components/otb/ColecaoPVSheet.tsx"]) {
      const t = ler(f);
      expect(t).toContain("<ExcluirColecaoDialog");
      expect(t).not.toMatch(/inclusive os já preenchidos|modelo\(s\) vinculado|que ainda estão em planejamento/);
    }
  });
  it("o diálogo consulta modelos (id, nome, ref; count exato; até 20) e esconde o confirmar quando há cards", () => {
    expect(dlg).toContain('.select("id, nome, ref", { count: "exact" })');
    expect(dlg).toContain(".eq(\"colecao_id\", colecaoId!)");
    expect(dlg).toContain(".limit(LIMITE_LISTA_CARDS)");
    expect(dlg).toContain("{!aviso?.bloqueada && (");
  });
});

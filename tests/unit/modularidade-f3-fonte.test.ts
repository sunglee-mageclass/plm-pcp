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
  it("Comercial & Coleção: opções da RPC (F2.2); filtro dos cards pelo rótulo (`rotuloColecao`), sem `.eq(\"colecao\", …)` cru", () => {
    const i = f.indexOf("function ComercialColecaoTab()");
    const corpo = f.slice(i, i + 5000);
    expect(f).toContain('import { rotuloColecaoDoModelo } from "@/lib/colecao-rotulo";');
    expect(corpo).toContain("queryFn: buscarOpcoesColecao");
    expect(corpo).not.toContain('select("id, colecao, subcolecao, colecoes(nome)")');
    expect(corpo).toContain("rotuloColecaoDoModelo(m)");
    expect(corpo).not.toContain('q.eq("colecao"');
    expect(corpo).toContain("rows.filter((m) => m.colecao === fColecao)");
    // m2: o filtro no cliente nunca corta em 1.000 linhas (buscarTodas, ordem estável); as opções vêm da RPC (F2.2)
    expect(corpo.match(/buscarTodas<any>/g)?.length).toBe(1);
    expect(corpo).toContain('order("id", { ascending: true })');
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
  });  it("m4/m5: o resultado só aparece com a conferência terminada, e produtos acabados/importados entram na contagem", () => {
    expect(dlg).toContain("const aviso = !conferindo && !cards.isError && cards.data ?");
    expect(dlg).toContain('"produtos_acabados", "produtos_importados"');
    expect(dlg).toContain("retry: 1");
  });
});

describe("Lançar — foguete do card sem data (I1) e texto sem Produção (m1)", () => {
  const lista = ler("src/routes/_authenticated/criacao.planejamento.tsx");
  const det = ler("src/components/planejamento/PlanejamentoDetail.tsx");
  it("o foguete 'pronto' sem Data de Lançamento fica desabilitado e o título é o motivo", () => {
    expect(lista).toContain('disabled={lancStatus == null || (lancStatus === "pronto" && !dtLanc)}');
    expect(lista).toContain("(dtLanc ? \"Lançar este modelo\" : TEXTO_LANCAR_DATA)");
  });
  it("sem Produção o '✓ Lançado' não promete 'aparece em Lançamentos'", () => {
    expect(det).toContain('{cqExigido ? "✓ Lançado — aparece em Lançamentos." : "✓ Lançado."}');
  });
});

describe("Parte 12 (R11) — telas que mostram/filtram coleção usam o rótulo", () => {
  it("detalhes/Explosão/Etapas PL trazem colecoes(nome) e passam por comRotuloColecao/rotuloColecaoDoModelo", () => {
    const comRotulo = [
      "src/components/producao/explosao/ExplosaoDetail.tsx",
      "src/components/producao/etapas/useEtapasCards.ts",
      // [backend F2.2] pcp.etapas.tsx saiu daqui: as opcoes de Coleção vêm da RPC (rótulo no servidor); o filtro de cards é do hook acima.
      "src/components/producao/cad/useFichaData.ts",
      "src/routes/_authenticated/criacao.desenvolvimento.tsx",
      "src/routes/_authenticated/criacao.planejamento.tsx",
    ];
    for (const f of comRotulo) {
      const t = ler(f);
      expect(t, f).toContain("colecoes(nome)");
      expect(t, f).toMatch(/comRotuloColecao(Lista)?\(|rotuloColecaoDoModelo\(/);
    }
    expect(ler("src/components/planejamento/PlanejamentoDetail.tsx")).toContain("rotuloColecao({ colecao: draft.colecao, colecaoNome:");
  });
});

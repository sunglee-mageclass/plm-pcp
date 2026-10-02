// LEVES L2 — guardas de fonte (R13 toast PCP, R14 N4, L3, kanban #14). Leitura estática, no padrão dos `*-guardas`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ROOT = process.cwd() + "/";
const ler = (p: string) => readFileSync(ROOT + p, "utf8");

describe("LEVES L2", () => {
  it("R13: PCP lê o status do CQ antes/depois e avisa o rebaixamento", () => {
    const s = ler("src/routes/_authenticated/pcp.servicos.$modeloId.tsx");
    expect(s).toContain("mensagemToastPosSavePcp(antes, depois)");
    expect(s).toContain("toast.warning(msg.texto)");
    // B1: o reset síncrono do colab vem ANTES da leitura assíncrona do status
    expect(s.indexOf("baseBlocosRef.current = null;")).toBeLessThan(s.indexOf("void lerStatusCq(cadId)"));
    // B2: rebaixou => invalida as telas abaixo
    for (const k of ['["cqpos-cq", cadId]', '["producao-cq-list"]', '["dir-list"]', '["lancamentos-cards"]', '["plan-cq"]']) expect(s).toContain(k);
  });
  it("N4/B7: o canal do pai (expedição CQ) invalida também cqpos-cq; CqPosView não abre canal próprio", () => {
    expect(ler("src/components/producao/CqPosView.tsx")).not.toContain("useColabRegistro");
    expect(ler("src/routes/_authenticated/expedicao.cq.$modeloId.tsx")).toContain('qc.invalidateQueries({ queryKey: ["cqpos-cq", cad?.id] })');
  });
  it("B8: CqPosView espelha o N6 nos 2 onError", () => {
    const s = ler("src/components/producao/CqPosView.tsx");
    expect(s.match(/deveReaplicarStatusAposErro\(e\)/g)?.length).toBe(2);
  });
  it("N6: os 4 onError do CQ Pré relêem o CQ", () => {
    const s = ler("src/routes/_authenticated/expedicao.cq.$modeloId.tsx");
    expect(s.match(/reaplicarStatusCqAposErro\(e, qc, \["cq", cad\?\.id\]\)/g)?.length).toBe(4);
  });
  it("M2: todo host que já tem guarda de rota própria passa hostGuardaNavegacao", () => {
    expect(ler("src/components/produto-acabado/ProdutoAcabadoSheet.tsx")).toContain("hostGuardaNavegacao={dirty}");
    expect(ler("src/components/integracao/IntegracaoPage.tsx")).toContain("hostGuardaNavegacao={dirty}");
  });
  it("L3: Sheet do Planejamento bloqueia navegação suja, salvo host com guarda própria; Criar PA passa por requestClose", () => {
    const s = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(s).toContain("blockNav: !hostGuardaNavegacao");
    expect(s).toContain("onClose: () => requestCloseRef.current()");
    expect(ler("src/components/integracao/IntegracaoPage.tsx")).toContain("hostGuardaNavegacao={dirty}");
  });
  it("kanban #14: Dev mostra REF gravada sempre e passa statusGate via statusParaGate", () => {
    const s = ler("src/components/desenvolvimento/ModeloDetailPanel.tsx");
    expect(s).toContain("statusParaGate(kanbanFicha.kanbanCfg.kanban_automatico, kanbanFicha.derivacao, curStatus)");
    expect(s).toContain("enviada: modeloEnviadoAoKanban(modelo)");
    expect(s).not.toContain("enviada: !!draft?.enviado_cad");
    expect(s).toMatch(/\(modelo as any\)\?\.ref \?\? ""\)\.trim\(\) !== ""/);
    expect(s).toContain("curStatus, { statusGate }");
  });
});

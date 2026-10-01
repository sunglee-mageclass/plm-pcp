// LEVES L2 — guardas de fonte (R13 toast PCP, R14 N4, L3, kanban #14). Leitura estática, no padrão dos `*-guardas`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ROOT = process.cwd() + "/";
const ler = (p: string) => readFileSync(ROOT + p, "utf8");

describe("LEVES L2", () => {
  it("R13: PCP lê o status do CQ antes/depois e avisa o rebaixamento", () => {
    const s = ler("src/routes/_authenticated/pcp.servicos.$modeloId.tsx");
    expect(s).toContain("O CQ voltou a pendente: a grade real zerou");
    expect(s).toContain('antes === "confirmado" && depois === "pendente"');
    expect(s).toContain("Salvo com sucesso");
  });
  it("N4: CqPosView escuta controle_qualidade por cad_id e invalida cqpos-cq", () => {
    const s = ler("src/components/producao/CqPosView.tsx");
    expect(s).toMatch(/useColabRegistro\(\{[\s\S]*tabela: "controle_qualidade"[\s\S]*filtroColuna: "cad_id"[\s\S]*invalidateQueries\(\{ queryKey: \["cqpos-cq", cadId\] \}\)/);
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
    expect(s).toMatch(/\(modelo as any\)\?\.ref \?\? ""\)\.trim\(\) !== ""/);
    expect(s).toContain("curStatus, { statusGate }");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");

describe("Integração — abrir card em Sheet (R14, P-199 A)", () => {
  const celula = ler("src/components/integracao/CelulaCampo.tsx");
  const log = ler("src/components/integracao/LogAba.tsx");
  const pagina = ler("src/components/integracao/IntegracaoPage.tsx");
  it("nenhum dos dois pontos navega mais para /criacao/planejamento", () => {
    expect(celula).not.toContain("/criacao/planejamento");
    expect(log).not.toContain("/criacao/planejamento");
  });
  it("os dois pontos exigem canView(criacao_planejamento); Log sem permissão mostra texto puro", () => {
    expect(celula).toContain('canView("criacao_planejamento")');
    expect(log).toContain('canView("criacao_planejamento")');
    expect(log).toContain("<span>{l.modeloNome");
  });
  it("a página tem UMA instância do PlanejamentoDetail, contexto integracao, e invalida lista+log no onSaved", () => {
    expect(pagina.match(/<PlanejamentoDetail/g)?.length).toBe(1);
    expect(pagina).toContain('contexto="integracao"');
    expect(pagina).toContain("chaveLista(lojaEstavel)");
    expect(pagina).toContain("chaveLog(lojaEstavel)");
  });
});

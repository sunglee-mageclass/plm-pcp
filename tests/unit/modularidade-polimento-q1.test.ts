// [modularidade, R13] Polimento pós-Q1: Leadtime da Config da Loja esconde o que a loja não usa (sem apagar o salvo) e o
// motivo de "Marcar Recebido" (OC Produto Acabado/Importado) lista TODOS os módulos que faltam.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { etapaLeadtimeVisivel, moduloDaEtapaLeadtime } from "@/lib/leadtime";
import { faltasDeModulo } from "@/lib/permissions-catalog";
import { motivoModulos } from "@/lib/modulos-texto";

const ler = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const ETAPAS = ["planejamento", "kanban:em_modelagem", "cad_corte", "servicos", "servico_cat:abc", "cq", "direcionamento", "lancamento"];
const visiveis = (m: { entrada_saida?: boolean; producao?: boolean }) => ETAPAS.filter((k) => etapaLeadtimeVisivel(k, m));

describe("Leadtime da Config da Loja: etapas por módulo", () => {
  it("mapa etapa → módulo", () => {
    expect(moduloDaEtapaLeadtime("cad_corte")).toBe("entrada_saida");
    for (const k of ["servicos", "servico_cat:abc", "cq", "direcionamento"]) expect(moduloDaEtapaLeadtime(k)).toBe("producao");
    for (const k of ["planejamento", "kanban:aprovado", "lancamento"]) expect(moduloDaEtapaLeadtime(k)).toBeNull();
  });

  it("tudo ligado: todas aparecem", () => {
    expect(visiveis({ entrada_saida: true, producao: true })).toEqual(ETAPAS);
  });

  it("sem Entrada e Saída: some só a Explosão", () => {
    expect(visiveis({ entrada_saida: false, producao: true })).toEqual(ETAPAS.filter((k) => k !== "cad_corte"));
  });

  it("sem Produção: somem Serviços (e por categoria), CQ e Direcionamento; Explosão, Planejamento, kanban e Lançamento ficam", () => {
    expect(visiveis({ entrada_saida: true, producao: false })).toEqual(["planejamento", "kanban:em_modelagem", "cad_corte", "lancamento"]);
  });

  it("sem os dois: só Planejamento, kanban e Lançamento", () => {
    expect(visiveis({ entrada_saida: false, producao: false })).toEqual(["planejamento", "kanban:em_modelagem", "lancamento"]);
  });

  it("chave ausente no mapa = não esconde (só `false` explícito esconde)", () => {
    expect(visiveis({})).toEqual(ETAPAS);
  });
});

describe("Config da Loja (fonte): esconder não apaga o salvo", () => {
  const src = ler("src/routes/_authenticated/admin/configuracoes.tsx");
  const card = src.slice(src.indexOf("function LeadtimeConfigCard("), src.indexOf("function LeadtimeGrupo("));

  it("o card recebe `modules` da tela (já depois do `pronto`)", () => {
    expect(src).toMatch(/<LeadtimeConfigCard[\s\S]*?modules=\{modules\}/);
  });

  it("o commit regrava pela lista COMPLETA (`todas`), não pela filtrada — etapas escondidas seguem gravadas", () => {
    expect(card).toContain("etapas: todas.filter((d) => next.has(d.key))");
    expect(card).not.toContain("etapas: disponiveis.filter");
  });

  it("a exibição filtra por módulo e o bloco de SLA de Serviços some sem Produção", () => {
    expect(card).toContain("etapaLeadtimeVisivel(key, modules)");
    expect(card).toContain("itens={producaoVisiveis}");
    expect(card).toContain("modules.producao !== false && (");
  });
});

describe("Marcar Recebido (OC Produto Acabado / Importado): motivo lista TODOS os módulos que faltam", () => {
  for (const arq of ["entrada-saida.oc-p-acabado.tsx", "entrada-saida.oc-p-importado.tsx"]) {
    it(`${arq}: exige Criação E Produção (o servidor também) e mostra o motivo no botão e no InfoHover`, () => {
      const src = ler(`src/routes/_authenticated/${arq}`);
      expect(src).toContain('useRequerModulo("criacao", "producao")');
      expect(src).toContain("title={!requerRecebimento.ok ? requerRecebimento.motivo");
      expect(src).toContain("<InfoHover ariaLabel=\"Por que não recebe\">{requerRecebimento.motivo}</InfoHover>");
    });
  }

  it("o texto: faltando os dois → 'Criação e Produção'; faltando um → só ele", () => {
    const faltam = (mods: Record<string, boolean>) => ["criacao", "producao"].filter((k) => !mods[k]);
    expect(motivoModulos(faltam({ criacao: false, producao: false }) as never)).toBe(
      "Precisa dos módulos Criação e Produção — fale com o administrador do sistema.",
    );
    expect(motivoModulos(faltam({ criacao: true, producao: false }) as never)).toBe(
      "Precisa do módulo Produção — fale com o administrador do sistema.",
    );
  });

  it("faltasDeModulo (mapa de dependências) lista Criação e Produção para PA/PI sem elas, sem inventar as que a loja tem", () => {
    const m = { criacao: false, entrada_saida: true, producao: false, otb: true };
    expect(faltasDeModulo(m, "produto_acabado")).toEqual(["criacao", "producao"]);
    expect(faltasDeModulo(m, "produto_importado")).toEqual(["criacao", "producao"]);
  });
});

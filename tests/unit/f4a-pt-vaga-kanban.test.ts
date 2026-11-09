// @vitest-environment happy-dom
// F4a T6 — Plan. Tecido: a vaga COM card mostra o STATUS COMPLETO do kanban (selo + "Mover para…"), no lugar do selo de
// FASE (RPC `plan_tecido_fases`) e do Select binário pendente/reprovado. A vaga SEM card NÃO tem kanban: continua com o
// pendente/reprovado PRÓPRIO da F2 (Select + `statusEfetivoDaVaga` + `aplicarStatusVaga`). RENDER real do `ModelCard`.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ModelCard, type KanbanDoCard } from "@/components/plan-tecido/ModelCard";
import { lerKanbanAutoConfig } from "@/lib/kanban-auto";
import { modeloKanbanDoEmbed } from "@/lib/kanban-card-selo";
import { statusEfetivoDaVaga } from "@/lib/plan-tecido/calc";
import { invalidarAposMoverEtapa } from "@/components/planejamento/planejamento-detail/ficha/useMoverEtapa";
import { matchesTable } from "@/lib/realtime-invalidation-map";
import type { PtSlot } from "@/lib/plan-tecido/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Rede/infra de sessão: mock mínimo (nenhum teste aqui faz I/O de verdade).
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy(() => chain, {
    get: (_t, p) => (p === "then" ? (res: (v: unknown) => void) => res({ data: [], error: null }) : chain),
    apply: () => chain,
  });
  return { supabase: { from: () => chain, rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useIntegracaoEstado", () => ({ useIntegracaoEstado: () => null, useIntegracaoEstados: () => ({}) }));
vi.mock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));

const ler = (p: string) => readFileSync(p, "utf8");
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function montar(el: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}
function renderCard(props: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return montar(createElement(QueryClientProvider, { client: qc }, createElement(ModelCard, { onChange: () => {}, ...props } as any)));
}

const vaga = (over: Partial<PtSlot> = {}): PtSlot => ({ id: "s1", slot_index: 0, modelo_id: null, nome: "Blusa", materiais: [], ...over });
const CFG = lerKanbanAutoConfig(null); // chave desligada, board padrão
function kanbanDe(modeloId: string, m: Parameters<typeof modeloKanbanDoEmbed>[0], over: Partial<KanbanDoCard> = {}): KanbanDoCard {
  return { cfg: CFG, condMap: {}, modelos: { [modeloId]: modeloKanbanDoEmbed(m) }, prontas: true, carregando: false, ...over };
}
const contaReprovado = (c: HTMLElement) => (c.textContent?.match(/Reprovado/g) ?? []).length;

describe("T6 — vaga SEM card: a F2 (pendente/reprovado próprio) segue INTACTA", () => {
  it("renderiza o Select 'Status' da vaga e NENHUM selo/seletor de kanban", () => {
    const { container, unmount } = renderCard({ slot: vaga({ status: "reprovado" }), statusEfetivo: "reprovado", onStatus: vi.fn() });
    expect(container.textContent).toContain("Status");
    expect(container.querySelector('[role="combobox"][title="Status da vaga"]')).not.toBeNull();
    expect(q(container, "pt-kanban-card")).toBeNull();
    expect(q(container, "pt-kanban-selo")).toBeNull();
    expect(q(container, "pt-mover-gatilho")).toBeNull();
    unmount();
  });
  it("mesmo que o Sheet passe `kanban`, a vaga sem modelo_id não ganha selo (o gate é o modelo_id)", () => {
    const { container, unmount } = renderCard({
      slot: vaga(), statusEfetivo: "pendente", onStatus: vi.fn(),
      kanban: kanbanDe("m1", { origem: "interno", status_desenvolvimento: "em_modelagem", ordem_criacao_enviada: true }),
    });
    expect(q(container, "pt-kanban-card")).toBeNull();
    expect(container.querySelector('[role="combobox"][title="Status da vaga"]')).not.toBeNull();
    unmount();
  });
  it("statusEfetivoDaVaga sem card continua lendo `slot.status` (F2)", () => {
    expect(statusEfetivoDaVaga(vaga({ status: "reprovado" }), false)).toBe("reprovado");
    expect(statusEfetivoDaVaga(vaga({ status: "pendente" }), true)).toBe("pendente"); // sem card o `reprovadoDoCard` nem conta
    expect(statusEfetivoDaVaga(vaga({}), false)).toBe("pendente");
  });
});

describe("T6 — vaga COM card: status COMPLETO do kanban", () => {
  it("mostra o selo com a coluna do kanban e NÃO o Select pendente/reprovado (o Sheet não passa onStatus com card)", () => {
    const { container, unmount } = renderCard({
      slot: vaga({ modelo_id: "m1" }), statusEfetivo: "pendente",
      kanban: kanbanDe("m1", { origem: "interno", status_desenvolvimento: "corte_piloto_2", ordem_criacao_enviada: true }),
    });
    expect(q(container, "pt-kanban-card")).not.toBeNull();
    expect(q(container, "pt-kanban-selo")?.textContent).toContain("Corte de Piloto II");
    expect(container.querySelector('[role="combobox"][title="Reflete/edita o status do produto no Planejamento"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\bStatus\b/);
    unmount();
  });
  it("antes da Ordem de Criação = 'Planejamento'; lançado = 'Lançado' (mesma fonte `etapaDoModelo` do Planejamento)", () => {
    const a = renderCard({ slot: vaga({ modelo_id: "m1" }), kanban: kanbanDe("m1", { origem: "interno", ordem_criacao_enviada: false }) });
    expect(q(a.container, "pt-kanban-selo")?.textContent).toContain("Planejamento");
    a.unmount();
    const b = renderCard({ slot: vaga({ modelo_id: "m1" }), kanban: kanbanDe("m1", { origem: "interno", ordem_criacao_enviada: true, lancado: true, status_desenvolvimento: "aprovado" }) });
    expect(q(b.container, "pt-kanban-selo")?.textContent).toContain("Lançado");
    b.unmount();
  });
  it("config/condições carregadas e card no kanban = gatilho 'Mover para…' habilitado; ainda carregando = só o selo", () => {
    const pronto = renderCard({ slot: vaga({ modelo_id: "m1" }), kanban: kanbanDe("m1", { origem: "interno", status_desenvolvimento: "em_modelagem", ordem_criacao_enviada: true }) });
    expect(q(pronto.container, "pt-mover-gatilho")).not.toBeNull();
    pronto.unmount();
    const carregando = renderCard({
      slot: vaga({ modelo_id: "m1" }),
      kanban: kanbanDe("m1", { origem: "interno", status_desenvolvimento: "em_modelagem", ordem_criacao_enviada: true }, { prontas: false, carregando: "carregando" }),
    });
    expect(q(carregando.container, "pt-kanban-selo")).not.toBeNull();
    expect(q(carregando.container, "pt-mover-gatilho")).toBeNull();
    carregando.unmount();
  });
  it("card na coluna Reprovado: o selo do kanban diz 'Reprovado' e o selo vermelho NÃO repete (1 ocorrência)", () => {
    const { container, unmount } = renderCard({
      slot: vaga({ modelo_id: "m1" }), reprovado: true,
      kanban: kanbanDe("m1", { origem: "interno", status_desenvolvimento: "reprovado", ordem_criacao_enviada: true }),
    });
    expect(q(container, "pt-kanban-selo")?.textContent).toContain("Reprovado");
    expect(contaReprovado(container)).toBe(1);
    unmount();
  });
  it("reprovado pelo PLANEJAMENTO (coluna do kanban ≠ Reprovado): o selo vermelho continua (o efeito na demanda segue visível)", () => {
    const { container, unmount } = renderCard({
      slot: vaga({ modelo_id: "m1" }), reprovado: true,
      kanban: kanbanDe("m1", { origem: "interno", status_desenvolvimento: "em_modelagem", ordem_criacao_enviada: true }),
    });
    expect(q(container, "pt-kanban-selo")?.textContent).toContain("Em Modelagem");
    expect(contaReprovado(container)).toBe(1); // só o vermelho (o selo do kanban diz "Em Modelagem")
    expect(container.textContent).toContain("Reprovado");
    unmount();
  });
});

describe("T6 — fiação do Sheet (asserção de fonte)", () => {
  const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");
  it("a fase da RPC e o binário saíram: sem faseInfo/fasesMap/plan-tecido-fases/plan_tecido_fases no Sheet e no card", () => {
    const semComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const s of [sheet, card]) {
      expect(semComentarios(s).match(/faseInfo|fasesMap|plan-tecido-fases|plan_tecido_fases/)).toBeNull();
    }
    expect(card.match(/\bfase\?:/)).toBeNull();
  });
  it("select de modelosDb traz ordem_criacao_enviada; config e condições em lote com key PRÓPRIA (não as do useFichaKanban)", () => {
    expect(sheet).toMatch(/status_planejamento, ordem_criacao_enviada, subcolecao/);
    expect(sheet).toContain('"plan-tecido-kanban-config"');
    expect(sheet).toContain('"plan-tecido-kanban-cond"');
    expect(sheet).not.toMatch(/"tenant-plan-ficha-config"|"plan-kanban-cond"/);
    expect(sheet).toMatch(/avaliar_condicoes_kanban/);
    expect(sheet).toMatch(/placeholderData: keepPreviousData/);
  });
  it("com card: `kanban` vai ao card e `onStatus` NÃO; sem card: `onStatus` → aplicarStatusVaga (F2 intacta)", () => {
    expect(sheet).toMatch(/kanban=\{slot\.modelo_id \? kanbanDoCard : undefined\}/);
    expect(sheet).toMatch(/onStatus=\{slot\.modelo_id \? undefined : \(novo\) => void aplicarStatusVaga\(slot, li, sli, novo\)\}/);
    expect(sheet).toMatch(/statusEfetivo=\{statusEfetivoDaVaga\(slot, slot\.modelo_id \? reprovadoStatusSet\.has\(slot\.modelo_id\) : false\)\}/);
    // aplicarStatusVaga: ramo da vaga SEM card (grava no draft `s.status`) continua igual
    expect(sheet).toMatch(/if \(!slot\.modelo_id\) \{[\s\S]{0,260}s\.status = novo;[\s\S]{0,40}patch\(next\);/);
  });
  it("usa o MESMO `MoverEtapaMenu` + `useSeloMoverLote` do PA/PI (reuso, sem reimplementar requisito); modo interno (origem do modelo)", () => {
    expect(card).toMatch(/import \{ MoverEtapaMenu \} from "@\/components\/shared\/MoverEtapaMenu"/);
    expect(card).toMatch(/useSeloMoverLote\(/);
    expect(card).toMatch(/testIdPrefix="pt"/);
    expect(sheet).toMatch(/modeloKanbanDoEmbed\(m\)/); // origem do modelo entra no ModeloKanban → interno usa o board interno
  });
});

describe("T6 — invalidação e Realtime das keys PRÓPRIAS do Plan. Tecido", () => {
  it("mover a etapa (useMoverEtapa) invalida as keys de modelos/config/condições do PT (prefixo `plan-tecido`)", () => {
    const qc = new QueryClient();
    const keys: unknown[][] = [
      ["plan-tecido-modelos", "col-1"], ["plan-tecido-kanban-config", "t1"], ["plan-tecido-kanban-cond", "col-1", ["m1"]],
    ];
    for (const k of keys) qc.setQueryData(k, 1);
    invalidarAposMoverEtapa(qc, "m1");
    for (const k of keys) expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
  });
  it("Realtime L1: config do kanban do PT segue tenant_config e as condições em lote seguem `modelos`", () => {
    expect(matchesTable("tenant_config", ["plan-tecido-kanban-config", "t1"])).toBe(true);
    expect(matchesTable("modelos", ["plan-tecido-kanban-cond", "col-1", ["m1"]])).toBe(true);
  });
});

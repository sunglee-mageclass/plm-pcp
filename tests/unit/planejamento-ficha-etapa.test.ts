import { describe, it, expect } from "vitest";
import type { Derivacao, KanbanAutoConfig, ModeloKanban } from "@/lib/kanban-auto";
import { etapaDoModelo } from "@/lib/kanban-auto-ui";
import {
  condProntasFicha, mensagemBloqueioHoje, opcoesMoverHoje, podeEntrarHoje, refVisivelFicha, statusEfetivoFicha,
} from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";

// F3.1 — etapa do card no Sheet unificado. `podeEntrarHoje` é o espelho do `podeEntrar` do board
// (criacao.desenvolvimento.tsx:322-332) — o caminho de HOJE (chave desligada).
const cfg = (over: Partial<KanbanAutoConfig> = {}): KanbanAutoConfig => ({
  kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {},
  revenda_kanban_colunas: [], revenda_kanban_requisitos: {}, ...over,
});

describe("statusEfetivoFicha (≡ coluna onde o board mostra o card)", () => {
  it("antes da Ordem de Criação não há etapa", () => {
    expect(statusEfetivoFicha("em_pilotagem", false, cfg())).toBeNull();
  });
  it("status nulo, órfão ou vazio cai na 1ª coluna; válido fica; só normaliza ESPAÇO (≡ board — comparação EXATA de caixa, criacao.desenvolvimento.tsx:480,539-541)", () => {
    expect(statusEfetivoFicha(null, true, cfg())).toBe("em_modelagem");
    expect(statusEfetivoFicha("coluna_removida", true, cfg())).toBe("em_modelagem");
    expect(statusEfetivoFicha("stand_by", true, cfg())).toBe("stand_by");
    // Caixa errada (mesmo após trim) é uma key ÓRFÃ pro board — cai na 1ª coluna, não normaliza.
    expect(statusEfetivoFicha(" Stand_By ", true, cfg())).toBe("em_modelagem");
  });
  it("board customizado (labels) → 1ª coluna dele", () => {
    expect(statusEfetivoFicha(null, true, cfg({ status_kanban: ["Cadastro", "Aprovado"] }))).toBe("cadastro");
  });
});

describe("refVisivelFicha (campo REF da seção 'Desenvolvimento')", () => {
  it("sem etapa (antes da Ordem de Criação) = escondido", () => {
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: null, statusEfetivo: null, derivacao: null })).toBe(false);
  });
  it("sem config = a partir de Aprovado (histórico)", () => {
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: null, statusEfetivo: "em_modelagem", derivacao: null })).toBe(false);
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: null, statusEfetivo: "aprovado", derivacao: null })).toBe(true);
  });
  it("etapa configurada: na etapa ou depois", () => {
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: "em_pilotagem", statusEfetivo: "prova_roupa_1", derivacao: null })).toBe(true);
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: "em_pilotagem", statusEfetivo: "corte_piloto_3", derivacao: null })).toBe(false);
  });
  it("decisão 10: com a chave LIGADA usa a posição DERIVADA (card fixado em coluna manual)", () => {
    const d: Derivacao = { derivavel: true, entrada: "em_modelagem", alvo: "aprovado", resultado: "stand_by", fixado: true, primeiraFalha: null, faltando: [] };
    expect(refVisivelFicha({ cfg: cfg({ kanban_automatico: true }), refExibirStatus: null, statusEfetivo: "stand_by", derivacao: d })).toBe(true);
    expect(refVisivelFicha({ cfg: cfg({ kanban_automatico: false }), refExibirStatus: null, statusEfetivo: "stand_by", derivacao: d })).toBe(false);
  });
  // M3 (fix round 1): quem chama (useFichaKanban) passa o status CRU, não a coluna EFETIVA do
  // board — aqui provamos que a função em si é sensível a essa diferença: uma key ÓRFÃ/fora do
  // board (que a coluna EFETIVA já teria "corrigido" pra 1ª coluna) NÃO libera a REF sozinha.
  it("status órfão/fora do board (não normalizado pra 1ª coluna) não libera a REF sem chegar em 'aprovado'", () => {
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: null, statusEfetivo: "coluna_removida", derivacao: null })).toBe(false);
  });
});

describe("condProntasFicha (I1, fix round 1 — 'Mover para…' só abre com as DUAS queries prontas)", () => {
  it("precisa do card estar no kanban E das duas queries (condições + config) terem chegado", () => {
    expect(condProntasFicha({ noKanban: true, condOk: true, cfgOk: true })).toBe(true);
  });
  it("condições prontas mas config ainda não — NÃO está pronto (o bug do I1)", () => {
    expect(condProntasFicha({ noKanban: true, condOk: true, cfgOk: false })).toBe(false);
  });
  it("config pronta mas condições ainda não — NÃO está pronto", () => {
    expect(condProntasFicha({ noKanban: true, condOk: false, cfgOk: true })).toBe(false);
  });
  it("card fora do kanban — NÃO está pronto mesmo com as duas queries ok", () => {
    expect(condProntasFicha({ noKanban: false, condOk: true, cfgOk: true })).toBe(false);
  });
});

describe("podeEntrarHoje (≡ board, chave desligada)", () => {
  const reqs = { em_pilotagem: ["data_piloto1"], prova_roupa_1: ["data_desenho_tecnico"] };
  it("interno: CASCATA — entrar numa etapa exige as anteriores", () => {
    const c = cfg({ kanban_requisitos: reqs });
    expect(podeEntrarHoje({ origem: "interno", para: "corte_piloto_1", cfg: c, cond: {} }).ok).toBe(true);
    const r = podeEntrarHoje({ origem: "interno", para: "prova_roupa_1", cfg: c, cond: {} });
    expect(r.ok).toBe(false);
    expect(r.faltando.map((f) => f.label)).toEqual(["Data de Piloto I preenchida", "Data do Desenho Técnico preenchida"]);
    // Stand By (depois na ordem) herda os requisitos anteriores — é assim no board hoje
    expect(podeEntrarHoje({ origem: "interno", para: "stand_by", cfg: c, cond: {} }).ok).toBe(false);
    expect(podeEntrarHoje({ origem: "interno", para: "prova_roupa_1", cfg: c, cond: { data_piloto1: true, data_desenho_tecnico: true } }).ok).toBe(true);
  });
  it("interno: exceção da etapa libera o herdado", () => {
    const c = cfg({ kanban_requisitos: reqs, kanban_requisitos_excecoes: { stand_by: ["data_piloto1", "data_desenho_tecnico"] } });
    expect(podeEntrarHoje({ origem: "interno", para: "stand_by", cfg: c, cond: {} }).ok).toBe(true);
  });
  it("chave fora do catálogo nunca trava (paridade com requisitosOk)", () => {
    expect(podeEntrarHoje({ origem: "interno", para: "em_pilotagem", cfg: cfg({ kanban_requisitos: { em_pilotagem: ["zzz"] } }), cond: {} }).ok).toBe(true);
  });
  it("comprado (revenda/importado): fluxo próprio, sem cascata", () => {
    const c = cfg({ revenda_kanban_colunas: ["em_modelagem", "aprovado"], revenda_kanban_requisitos: { aprovado: ["preco_venda_preenchido"] } });
    for (const origem of ["revenda", "importado"]) {
      const fora = podeEntrarHoje({ origem, para: "em_pilotagem", cfg: c, cond: {} });
      expect(fora.ok).toBe(false);
      expect(fora.faltando[0].label).toBe("fora do fluxo de comprado");
      expect(podeEntrarHoje({ origem, para: "aprovado", cfg: c, cond: {} }).faltando.map((f) => f.label)).toEqual(["Preço para venda preenchido"]);
      expect(podeEntrarHoje({ origem, para: "aprovado", cfg: c, cond: { preco_venda_preenchido: true } }).ok).toBe(true);
    }
  });
});

describe("opcoesMoverHoje + mensagemBloqueioHoje", () => {
  it("lista o board menos a coluna atual; anota o que falta e marca bloqueada", () => {
    const ops = opcoesMoverHoje({ origem: "interno", statusEfetivo: "em_modelagem", cfg: cfg({ kanban_requisitos: { em_pilotagem: ["data_piloto1"] } }), cond: {} });
    expect(ops.map((o) => o.key)).not.toContain("em_modelagem");
    expect(ops).toHaveLength(13);
    // M6 (fix round 1): ganhou o campo `modo` (ícone do menu) — `em_pilotagem` tem requisito
    // próprio nesta config (automática), `corte_piloto_1` não (manual).
    expect(ops.find((o) => o.key === "em_pilotagem")).toEqual({ key: "em_pilotagem", label: "Em Pilotagem", nota: "falta Data de Piloto I preenchida", bloqueada: true, modo: "automatica" });
    expect(ops.find((o) => o.key === "corte_piloto_1")).toEqual({ key: "corte_piloto_1", label: "Corte de Piloto I", nota: "", bloqueada: false, modo: "manual" });
  });
  it("texto do bloqueio = o do board", () => {
    expect(mensagemBloqueioHoje([{ label: "A" }, { label: "B" }])).toBe("Não pode entrar aqui. Faltam: A, B");
  });
});

describe("M5(a), fix round 1 — anti-drift: etapaDoModelo(...).key ≡ statusEfetivoFicha(...)", () => {
  // As duas devem concordar na COLUNA onde o card aparece (F2 no card do Planejamento/board;
  // F3.1 no header do Sheet) — mesma régua (trim, sem lowercase; nulo/órfão cai na 1ª coluna).
  // Casos: chave ligada/desligada, antes da Ordem (não aplica — cada função trata à sua forma),
  // lançado (idem) e fixado (coluna manual atual).
  const m = (over: Partial<ModeloKanban> = {}): ModeloKanban => ({
    origem: "interno", status_desenvolvimento: "em_pilotagem", ordem_criacao_enviada: true, lancado: false, ...over,
  });
  const casos: { nome: string; modelo: ModeloKanban; cfg: KanbanAutoConfig }[] = [
    { nome: "chave desligada, status válido", modelo: m(), cfg: { kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {} } },
    { nome: "chave ligada, status válido (fixado em coluna manual)", modelo: m({ status_desenvolvimento: "stand_by" }), cfg: { kanban_automatico: true, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {} } },
    { nome: "status nulo cai na 1ª coluna", modelo: m({ status_desenvolvimento: null }), cfg: { kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {} } },
    { nome: "status órfão (fora do board) cai na 1ª coluna", modelo: m({ status_desenvolvimento: "coluna_removida" }), cfg: { kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {} } },
    { nome: "board customizado", modelo: m({ status_desenvolvimento: "aprovado" }), cfg: { kanban_automatico: false, status_kanban: ["Cadastro", "Aprovado"], kanban_requisitos: {}, kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {} } },
  ];
  it.each(casos)("$nome", ({ modelo, cfg }) => {
    const selo = etapaDoModelo(modelo, cfg);
    const efetivo = statusEfetivoFicha(modelo.status_desenvolvimento, modelo.ordem_criacao_enviada === true, cfg);
    expect(selo.key).toBe(efetivo);
  });
  it("antes da Ordem de Criação: selo.key é null e statusEfetivoFicha (enviada=false) também é null", () => {
    const modelo = m({ ordem_criacao_enviada: false });
    const cfg: KanbanAutoConfig = { kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {} };
    expect(etapaDoModelo(modelo, cfg).key).toBeNull();
    expect(statusEfetivoFicha(modelo.status_desenvolvimento, false, cfg)).toBeNull();
  });
  it("lançado: selo.key é null (fase 'lancado') — statusEfetivoFicha não modela fase, só coluna (mesma entrada, mesma resposta que o não-lançado)", () => {
    const modelo = m({ lancado: true });
    const cfg: KanbanAutoConfig = { kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {} };
    expect(etapaDoModelo(modelo, cfg).key).toBeNull();
    // A F3.1 só chama `statusEfetivoFicha` fora da fase "lancado" (o header não mostra "Mover
    // para…" nesse caso) — aqui provamos que ela sozinha devolveria a coluna crua, reforçando
    // por que quem chama tem que checar `selo.fase === "kanban"` antes (já é o que `podeMover` faz).
    expect(statusEfetivoFicha(modelo.status_desenvolvimento, true, cfg)).toBe("em_pilotagem");
  });
});

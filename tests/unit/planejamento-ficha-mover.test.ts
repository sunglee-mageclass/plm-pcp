import { describe, it, expect } from "vitest";
import { derivarModelo, type KanbanAutoConfig, type ModeloKanban } from "@/lib/kanban-auto";
import {
  ehEcoDoMove, opcoesMoverAuto, planoMoverEtapa, proximaEtapa, proximoEcoMove,
} from "@/components/planejamento/planejamento-detail/ficha/etapa-mover";

// F3.1 — "Mover para…" do selo com a chave LIGADA: a tabela única de arraste da F1 (destinoDrop) + os textos da
// F2 (notaMoverPara). O servidor (kanban_mover) é quem decide; isto é só a dica no menu.
const cfg = (over: Partial<KanbanAutoConfig> = {}): KanbanAutoConfig => ({
  kanban_automatico: true, status_kanban: null,
  kanban_requisitos: { em_pilotagem: ["data_piloto1"], aprovado: ["data_aprovacao"] },
  kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {}, ...over,
});
const m = (status: string, origem = "interno"): ModeloKanban => ({ origem, status_desenvolvimento: status, ordem_criacao_enviada: true, lancado: false });
const por = (ops: ReturnType<typeof opcoesMoverAuto>, k: string) => ops.find((o) => o.key === k);

describe("opcoesMoverAuto", () => {
  it("card automático na entrada: manual fixa; automática além da derivada bloqueia com N dados", () => {
    const ops = opcoesMoverAuto({ modelo: m("em_modelagem"), statusEfetivo: "em_modelagem", cfg: cfg(), cond: {} });
    expect(por(ops, "em_modelagem")).toBeUndefined();
    expect(por(ops, "stand_by")).toMatchObject({ nota: "fixa aqui", bloqueada: false });
    expect(por(ops, "reprovado")).toMatchObject({ nota: "fixa aqui", bloqueada: false });
    expect(por(ops, "em_pilotagem")).toMatchObject({ nota: "falta 1 dado", bloqueada: true });
    expect(por(ops, "aprovado")).toMatchObject({ nota: "faltam 2 dados", bloqueada: true });
  });
  it("card fixado em coluna manual: a entrada solta o card", () => {
    const ops = opcoesMoverAuto({ modelo: m("stand_by"), statusEfetivo: "stand_by", cfg: cfg(), cond: {} });
    expect(por(ops, "stand_by")).toBeUndefined();
    expect(por(ops, "em_modelagem")).toMatchObject({ nota: "solta o card", bloqueada: false });
  });
  it("comprado: coluna fora do fluxo dele fica bloqueada", () => {
    const ops = opcoesMoverAuto({ modelo: m("em_modelagem", "revenda"), statusEfetivo: "em_modelagem", cfg: cfg({ revenda_kanban_colunas: ["em_modelagem", "aprovado"] }), cond: {} });
    expect(por(ops, "stand_by")).toMatchObject({ nota: "fora do fluxo", bloqueada: true });
  });
  // M6, fix round 1 — cada destino leva o MODO da coluna (reusado pelo ícone no menu, `ModoColunaBadge`).
  it("M6: cada opção leva o modo da coluna-destino (entrada/automática/manual/manual_sempre)", () => {
    const ops = opcoesMoverAuto({ modelo: m("em_modelagem"), statusEfetivo: "em_modelagem", cfg: cfg(), cond: {} });
    expect(por(ops, "em_pilotagem")).toMatchObject({ modo: "automatica" });
    expect(por(ops, "stand_by")).toMatchObject({ modo: "manual" });
    expect(por(ops, "reprovado")).toMatchObject({ modo: "manual_sempre" });
  });
});

describe("planoMoverEtapa (M5b, fix round 1 — decisão PURA extraída do useMoverEtapa)", () => {
  it("chave ligada: sempre chama a RPC (nenhum UPDATE local)", () => {
    const p = planoMoverEtapa({ modeloId: "m1", para: "aprovado", origem: "interno", cfg: cfg(), cond: {} });
    expect(p).toEqual({ tipo: "rpc", modeloId: "m1", para: "aprovado" });
  });
  it("chave desligada + bloqueado (podeEntrarHoje reprova): não grava nada", () => {
    const c = cfg({ kanban_automatico: false });
    const p = planoMoverEtapa({ modeloId: "m1", para: "em_pilotagem", origem: "interno", cfg: c, cond: {} });
    expect(p.tipo).toBe("bloqueado");
    if (p.tipo === "bloqueado") expect(p.faltando.map((f) => f.label)).toEqual(["Data de Piloto I preenchida"]);
  });
  it("chave desligada + liberado: UPDATE manda SÓ { status_desenvolvimento } (nunca motivo_cancelamento)", () => {
    const c = cfg({ kanban_automatico: false });
    const p = planoMoverEtapa({ modeloId: "m1", para: "em_pilotagem", origem: "interno", cfg: c, cond: { data_piloto1: true } });
    expect(p).toEqual({ tipo: "update", modeloId: "m1", payload: { status_desenvolvimento: "em_pilotagem" } });
    if (p.tipo === "update") expect(Object.keys(p.payload)).toEqual(["status_desenvolvimento"]);
  });
});

describe("proximoEcoMove + ehEcoDoMove (M4, fix round 2 — arma/desarma o eco do próprio move, CASANDO O REV)", () => {
  it("erro: desarma (null)", () => {
    expect(proximoEcoMove({ tipo: "erro" }, 5)).toBeNull();
  });
  it("bloqueado (chave desligada reprova): desarma — nada foi gravado", () => {
    expect(proximoEcoMove({ tipo: "bloqueado" }, 5)).toBeNull();
  });
  it("chave ligada (RPC kanban_mover): rev mudou → arma com o rev NOVO", () => {
    expect(proximoEcoMove({ tipo: "auto", rev: 6 }, 5)).toEqual({ rev: 6 });
  });
  it("chave ligada: rev IGUAL ao de antes ('nada' na tabela única de arraste) → desarma, não há evento novo", () => {
    expect(proximoEcoMove({ tipo: "auto", rev: 5 }, 5)).toBeNull();
  });
  it("chave desligada liberado ('hoje'): rev mudou → arma com o rev NOVO", () => {
    expect(proximoEcoMove({ tipo: "hoje", rev: 9 }, 8)).toEqual({ rev: 9 });
  });
  it("chave desligada 'hoje' sem rev no retorno (defensivo): não arma", () => {
    expect(proximoEcoMove({ tipo: "hoje", rev: null }, 8)).toBeNull();
  });
  it("ehEcoDoMove: só bate quando o freshRev é EXATAMENTE o rev armado", () => {
    expect(ehEcoDoMove({ rev: 6 }, 6)).toBe(true);
    expect(ehEcoDoMove({ rev: 6 }, 7)).toBe(false);
    expect(ehEcoDoMove(null, 6)).toBe(false);
    expect(ehEcoDoMove({ rev: 6 }, null)).toBe(false);
  });
});

describe("proximaEtapa (\"Próxima: X — falta: Y\")", () => {
  it("1ª coluna automática que falha + os dados que faltam", () => {
    expect(proximaEtapa(derivarModelo(m("em_modelagem"), cfg(), {}), cfg())).toEqual({ coluna: "Em Pilotagem", falta: "Data de Piloto I preenchida" });
    expect(proximaEtapa(derivarModelo(m("em_pilotagem"), cfg(), { data_piloto1: true }), cfg())).toEqual({ coluna: "Aprovado", falta: "Data de Aprovação preenchida" });
  });
  it("nada quando fixado, sem derivação ou tudo cumprido", () => {
    expect(proximaEtapa(derivarModelo(m("stand_by"), cfg(), {}), cfg())).toBeNull();
    expect(proximaEtapa(null, cfg())).toBeNull();
    expect(proximaEtapa(derivarModelo(m("aprovado"), cfg(), { data_piloto1: true, data_aprovacao: true }), cfg())).toBeNull();
  });
});

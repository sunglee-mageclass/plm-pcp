import { describe, it, expect } from "vitest";
import { entradaParaDerivacao, derivarModelo, destinoDrop, lerKanbanAutoConfig, boardDaLoja, type ModeloKanban } from "@/lib/kanban-auto";
import {
  RPC_KANBAN, descricaoModoColuna, dropBloqueado, etapaDoModelo, etapaFiltroId, etapaKanbanFiltroOpts,
  labelDaColuna, labelsCondicoes, modoColuna, motorKanbanDisponivel, notaMoverPara, proximaFalta,
  rotuloModoColuna, subtituloColuna, textoFaixaDrop, tituloSelo, toastDoMover, MOTIVO_REPROVADO_MANUAL,
  ETAPA_FILTRO_PLANEJAMENTO, ETAPA_FILTRO_LANCADO,
} from "@/lib/kanban-auto-ui";

const RAW = {
  kanban_automatico: true,
  status_kanban: ["Em Modelagem", "Em Pilotagem", "Prova de Roupa I", "Stand By", "Reprovado", "Aprovado"],
  kanban_requisitos: {
    em_modelagem: ["modelista_definido"],
    em_pilotagem: ["piloteiro_definido"],
    prova_roupa_1: ["data_piloto1"],
    aprovado: ["data_aprovacao"],
    reprovado: ["grade_preenchida"], // ignorado: Reprovado é sempre manual
  },
  kanban_requisitos_excecoes: {},
  revenda_kanban_colunas: ["em_modelagem", "stand_by", "aprovado"],
  revenda_kanban_requisitos: { aprovado: ["preco_venda_preenchido"] },
};
const CFG = lerKanbanAutoConfig(RAW);
const CFG_OFF = lerKanbanAutoConfig({ ...RAW, kanban_automatico: false });
const BOARD = boardDaLoja(CFG);
const KEYS = BOARD.map((c) => c.key);
const COND = { modelista_definido: true, piloteiro_definido: true };
const INTERNO: ModeloKanban = { origem: null, status_desenvolvimento: "em_pilotagem", ordem_criacao_enviada: true, lancado: false };
const FIXADO: ModeloKanban = { ...INTERNO, status_desenvolvimento: "stand_by" };
const entrada = (m: ModeloKanban) => entradaParaDerivacao(m, CFG, COND);

describe("kanban-auto-ui — contrato das RPCs da F1", () => {
  it("5 RPCs com nome = prefixo da assinatura", () => {
    expect(Object.keys(RPC_KANBAN)).toEqual(["mover", "previaRecalculo", "definirAutomatico", "previaRestauracao", "restaurar"]);
    for (const r of Object.values(RPC_KANBAN)) expect(r.assinatura.startsWith(`${r.nome}(`)).toBe(true);
  });
});

describe("kanban-auto-ui — motorKanbanDisponivel", () => {
  it("true só quando a linha de tenant_config TEM a coluna kanban_automatico (F1 aplicada)", () => {
    expect(motorKanbanDisponivel({ kanban_automatico: false })).toBe(true);
    expect(motorKanbanDisponivel({ status_kanban: [] })).toBe(false);
    expect(motorKanbanDisponivel(null)).toBe(false);
    expect(motorKanbanDisponivel([])).toBe(false);
  });
});

describe("kanban-auto-ui — modo da coluna", () => {
  it("entrada / automática / manual / manual (sempre) / fora do fluxo", () => {
    expect(modoColuna("em_modelagem", KEYS, CFG.kanban_requisitos)).toBe("entrada");
    expect(modoColuna("em_pilotagem", KEYS, CFG.kanban_requisitos)).toBe("automatica");
    expect(modoColuna(" Stand_By ", KEYS, CFG.kanban_requisitos)).toBe("manual");
    expect(modoColuna("reprovado", KEYS, CFG.kanban_requisitos)).toBe("manual_sempre");
    expect(modoColuna("zzz", KEYS, CFG.kanban_requisitos)).toBeNull();
  });
  it("rótulos e descrições", () => {
    expect(["entrada", "automatica", "manual", "manual_sempre"].map((m) => rotuloModoColuna(m as any)))
      .toEqual(["Entrada", "Automática", "Manual", "Manual (sempre)"]);
    expect(descricaoModoColuna("manual_sempre")).toBe("Reprovado é sempre manual: o card entra e sai arrastado.");
    expect(MOTIVO_REPROVADO_MANUAL).toBe("Reprovado é sempre manual: requisitos nesta coluna não valem.");
  });
  it("subtítulo do cabeçalho (labels do catálogo)", () => {
    expect(subtituloColuna("automatica", ["piloteiro_definido"])).toBe("Entra com: Piloteiro definido (≥ 1)");
    expect(subtituloColuna("entrada", ["modelista_definido"])).toBe("Todo card novo cai aqui. Exigido daqui em diante: Modelista definido");
    expect(subtituloColuna("entrada", [])).toBe("Todo card novo cai aqui.");
    expect(subtituloColuna("manual", [])).toBe("Manual — o card entra e sai arrastado");
    expect(subtituloColuna("manual_sempre", ["grade_preenchida"])).toBe("Manual (sempre) — o card entra e sai arrastado");
    expect(subtituloColuna(null, [])).toBe("");
  });
});

describe("kanban-auto-ui — labels", () => {
  it("condições pelo catálogo (key desconhecida volta crua)", () => {
    expect(labelsCondicoes(["data_piloto1", "xyz"])).toEqual(["Data de Piloto I preenchida", "xyz"]);
  });
  it("coluna: board → DEFAULT_STATUSES → a própria key; vazio → —", () => {
    expect(labelDaColuna("prova_roupa_1", BOARD)).toBe("Prova de Roupa I");
    expect(labelDaColuna("corte_piloto_2", BOARD)).toBe("Corte de Piloto II");
    expect(labelDaColuna("zzz", BOARD)).toBe("zzz");
    expect(labelDaColuna(null, BOARD)).toBe("—");
  });
});

describe("kanban-auto-ui — dica do arraste, 'Mover para…' e toast", () => {
  const bloq = destinoDrop(entrada(INTERNO), "prova_roupa_1");
  const bloq2 = destinoDrop(entrada(INTERNO), "aprovado");
  const ja = destinoDrop(entrada(INTERNO), "em_modelagem");
  const fixa = destinoDrop(entrada(INTERNO), "stand_by");
  const solta = destinoDrop(entrada(FIXADO), "em_pilotagem");
  const fora = destinoDrop(entrada(INTERNO), "zzz");
  // R1: revenda (fluxo em_modelagem · stand_by · aprovado) arrastada p/ uma coluna REAL do board fora do fluxo dela.
  const REVENDA_FIX: ModeloKanban = { ...FIXADO, origem: "revenda" };
  const foraRev = destinoDrop(entradaParaDerivacao(REVENDA_FIX, CFG, COND), "prova_roupa_1");
  const nada = destinoDrop(entrada(INTERNO), "em_pilotagem");

  it("pré-condição: a tabela única da F1 decide cada caso", () => {
    expect([bloq.acao, bloq.faltando]).toEqual(["bloquear_faltando", ["data_piloto1"]]);
    expect([bloq2.acao, bloq2.faltando]).toEqual(["bloquear_faltando", ["data_piloto1", "data_aprovacao"]]);
    expect([ja.acao, fixa.acao, solta.acao, solta.status, fora.acao, foraRev.acao, nada.acao])
      .toEqual(["bloquear_ja_cumprida", "fixar", "soltar", "em_pilotagem", "fora_do_fluxo", "fora_do_fluxo", "nada"]);
  });
  it("dropBloqueado", () => {
    expect([bloq, ja, fora, foraRev].every(dropBloqueado)).toBe(true);
    expect([fixa, solta, nada].some(dropBloqueado)).toBe(false);
  });
  it("faixa da coluna durante o arraste", () => {
    expect(textoFaixaDrop(bloq, "prova_roupa_1", BOARD)).toBe("Não pode entrar aqui. Falta 1 dado para completar: Data de Piloto I preenchida");
    expect(textoFaixaDrop(ja, "em_modelagem", BOARD)).toBe('O card já cumpre "Em Modelagem". Para segurá-lo numa etapa, use uma coluna manual.');
    expect(textoFaixaDrop(fixa, "stand_by", BOARD)).toBe("Solte aqui para fixar o card nesta coluna");
    expect(textoFaixaDrop(solta, "em_pilotagem", BOARD)).toBe('Solte aqui para soltar o card — ele vai para "Em Pilotagem"');
    expect(textoFaixaDrop(fora, "zzz", BOARD)).toBe('A etapa "zzz" não faz parte do fluxo deste modelo.');
    // R1: coluna do board → o RÓTULO, nunca a key técnica ("prova_roupa_1").
    expect(textoFaixaDrop(foraRev, "prova_roupa_1", BOARD)).toBe('A etapa "Prova de Roupa I" não faz parte do fluxo deste modelo.');
    expect(textoFaixaDrop(nada, "em_pilotagem", BOARD)).toBeNull();
  });
  it("nota do 'Mover para…' (mobile)", () => {
    expect(notaMoverPara(bloq)).toEqual({ texto: "falta 1 dado", bloqueada: true });
    expect(notaMoverPara(bloq2)).toEqual({ texto: "faltam 2 dados", bloqueada: true });
    expect(notaMoverPara(ja)).toEqual({ texto: "já cumpre", bloqueada: true });
    expect(notaMoverPara(fixa)).toEqual({ texto: "fixa aqui", bloqueada: false });
    expect(notaMoverPara(solta)).toEqual({ texto: "solta o card", bloqueada: false });
    expect(notaMoverPara(fora)).toEqual({ texto: "fora do fluxo", bloqueada: true });
    expect(notaMoverPara(foraRev)).toEqual({ texto: "fora do fluxo", bloqueada: true });
    expect(notaMoverPara(nada)).toEqual({ texto: "", bloqueada: false });
  });
  it("toast pela RESPOSTA do servidor", () => {
    expect(toastDoMover({ acao: "fixar", status: "stand_by", faltando: [] }, "stand_by", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "info", texto: 'Fixado em "Stand By". O card não anda sozinho até alguém tirá-lo daqui.' });
    expect(toastDoMover({ acao: "soltar", status: "em_pilotagem", faltando: [] }, "em_modelagem", BOARD, "stand_by", true))
      .toEqual({ tipo: "success", texto: 'Card solto. Voltou para "Em Pilotagem" — a etapa que os campos preenchidos indicam.' });
    expect(toastDoMover({ acao: "bloquear_faltando", status: "stand_by", faltando: ["data_piloto1"] }, "prova_roupa_1", BOARD, "stand_by", true))
      .toEqual({ tipo: "error", texto: 'Não pode entrar aqui. Falta 1 dado para completar: Data de Piloto I preenchida. O card continua fixado em "Stand By".' });
    expect(toastDoMover({ acao: "bloquear_faltando", status: "em_pilotagem", faltando: ["data_piloto1"] }, "prova_roupa_1", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "error", texto: "Não pode entrar aqui. Falta 1 dado para completar: Data de Piloto I preenchida" });
    expect(toastDoMover({ acao: "bloquear_ja_cumprida", status: "em_pilotagem", faltando: [] }, "em_modelagem", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "info", texto: 'O card já cumpre "Em Modelagem". Para segurá-lo numa etapa, use uma coluna manual.' });
    expect(toastDoMover({ acao: "fora_do_fluxo", status: "em_pilotagem", faltando: [] }, "zzz", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "error", texto: 'A etapa "zzz" não faz parte do fluxo deste modelo.' });
    expect(toastDoMover({ acao: "fora_do_fluxo", status: "stand_by", faltando: [] }, "prova_roupa_1", BOARD, "stand_by", true))
      .toEqual({ tipo: "error", texto: 'A etapa "Prova de Roupa I" não faz parte do fluxo deste modelo.' });
    expect(toastDoMover({ acao: "nada", status: "em_pilotagem", faltando: [] }, "em_pilotagem", BOARD, "em_pilotagem", false)).toBeNull();
  });
});

describe("kanban-auto-ui — próxima falta do card automático", () => {
  it("1ª condição que falta (+N quando há mais); null se fixado, não derivável ou tudo cumprido", () => {
    expect(proximaFalta(derivarModelo(INTERNO, CFG, COND))).toBe("falta Data de Piloto I preenchida");
    expect(proximaFalta(derivarModelo(INTERNO, CFG, { modelista_definido: true }))).toBe("falta Piloteiro definido (≥ 1)");
    expect(proximaFalta(derivarModelo({ ...INTERNO, status_desenvolvimento: "em_modelagem" }, CFG, {}))).toBe("falta Modelista definido");
    expect(proximaFalta(derivarModelo(FIXADO, CFG, COND))).toBeNull();
    expect(proximaFalta(derivarModelo({ ...INTERNO, ordem_criacao_enviada: false }, CFG, COND))).toBeNull();
    const tudo = { modelista_definido: true, piloteiro_definido: true, data_piloto1: true, data_aprovacao: true };
    expect(proximaFalta(derivarModelo(INTERNO, CFG, tudo))).toBeNull();
  });
  it("mais de uma condição faltando na 1ª coluna que falha → '+N'", () => {
    const cfg2 = lerKanbanAutoConfig({ ...RAW, kanban_requisitos: { ...RAW.kanban_requisitos, prova_roupa_1: ["data_piloto1", "grade_preenchida"] } });
    expect(proximaFalta(derivarModelo(INTERNO, cfg2, COND))).toBe("falta Data de Piloto I preenchida +1");
  });
});

describe("kanban-auto-ui — selo da etapa", () => {
  it("lançado e antes da Ordem de Criação", () => {
    expect(etapaDoModelo({ ...INTERNO, lancado: true }, CFG)).toEqual({ fase: "lancado", key: null, label: "Lançado", color: null, modo: "off" });
    expect(etapaDoModelo({ ...INTERNO, ordem_criacao_enviada: false }, CFG)).toEqual({ fase: "planejamento", key: null, label: "Planejamento", color: null, modo: "off" });
  });
  it("chave desligada: só a etapa", () => {
    expect(etapaDoModelo(INTERNO, CFG_OFF)).toEqual({ fase: "kanban", key: "em_pilotagem", label: "Em Pilotagem", color: "var(--kanban-violet)", modo: "off" });
  });
  it("chave ligada: automática × fixado (sem depender das condições)", () => {
    expect(etapaDoModelo(INTERNO, CFG).modo).toBe("automatica");
    expect(etapaDoModelo(FIXADO, CFG)).toEqual({ fase: "kanban", key: "stand_by", label: "Stand By", color: "var(--muted-foreground)", modo: "fixado" });
    expect(etapaDoModelo({ ...INTERNO, status_desenvolvimento: "em_modelagem" }, CFG).modo).toBe("automatica"); // entrada nunca é fixado
    expect(etapaDoModelo({ ...INTERNO, status_desenvolvimento: null }, CFG)).toMatchObject({ key: "em_modelagem", label: "Em Modelagem", modo: "automatica" });
  });
  it("revenda usa o fluxo dela: Stand By (manual, não-entrada) = fixado", () => {
    expect(etapaDoModelo({ ...FIXADO, origem: "revenda" }, CFG).modo).toBe("fixado");
    expect(etapaDoModelo({ ...INTERNO, origem: "revenda", status_desenvolvimento: "em_modelagem" }, CFG).modo).toBe("automatica");
  });
  it("título (tooltip) de cada estado", () => {
    expect(tituloSelo(etapaDoModelo({ ...INTERNO, ordem_criacao_enviada: false }, CFG))).toBe("Antes da Ordem de Criação — o modelo ainda não está no Desenvolvimento.");
    expect(tituloSelo(etapaDoModelo({ ...INTERNO, lancado: true }, CFG))).toBe("Modelo lançado.");
    expect(tituloSelo(etapaDoModelo(INTERNO, CFG_OFF))).toBe("Etapa do Desenvolvimento: Em Pilotagem");
    expect(tituloSelo(etapaDoModelo(INTERNO, CFG))).toBe("Etapa do Desenvolvimento: Em Pilotagem — anda sozinho conforme os campos salvos.");
    expect(tituloSelo(etapaDoModelo(FIXADO, CFG))).toBe("Etapa do Desenvolvimento: Stand By — fixado numa coluna manual: não anda sozinho.");
  });
});

// Filtro "Etapa do kanban" do Planejamento de Produto (owner request set/2026) — as opções e o id
// usado pra casar o card vêm da MESMA fonte do selo (`etapaDoModelo`), pra filtro e badge nunca
// divergirem.
describe("kanban-auto-ui — etapaKanbanFiltroOpts (opções do filtro)", () => {
  it("Planejamento → colunas do board NA ORDEM da loja (mesmos rótulos do selo) → Lançado", () => {
    expect(etapaKanbanFiltroOpts(CFG)).toEqual([
      { id: ETAPA_FILTRO_PLANEJAMENTO, nome: "Planejamento" },
      ...BOARD.map((c) => ({ id: c.key, nome: c.label })),
      { id: ETAPA_FILTRO_LANCADO, nome: "Lançado" },
    ]);
  });
  it("não depende das condições/derivação — mesma lista com a chave ligada ou desligada (só o board muda)", () => {
    expect(etapaKanbanFiltroOpts(CFG).map((o) => o.id)).toEqual(etapaKanbanFiltroOpts(CFG_OFF).map((o) => o.id));
  });
  it("board customizado (labels próprios da loja) — opções batem com os rótulos configurados", () => {
    const cfgCustom = lerKanbanAutoConfig({ ...RAW, status_kanban: ["Cadastro", "Aprovado"] });
    expect(etapaKanbanFiltroOpts(cfgCustom)).toEqual([
      { id: ETAPA_FILTRO_PLANEJAMENTO, nome: "Planejamento" },
      { id: "cadastro", nome: "Cadastro" },
      { id: "aprovado", nome: "Aprovado" },
      { id: ETAPA_FILTRO_LANCADO, nome: "Lançado" },
    ]);
  });
});

describe("kanban-auto-ui — etapaFiltroId (id do filtro a partir do selo)", () => {
  it("cada coluna do board vira sua própria key", () => {
    for (const c of BOARD) {
      expect(etapaFiltroId(etapaDoModelo({ ...INTERNO, status_desenvolvimento: c.key }, CFG_OFF))).toBe(c.key);
    }
  });
  it("Planejamento (antes da Ordem de Criação)", () => {
    expect(etapaFiltroId(etapaDoModelo({ ...INTERNO, ordem_criacao_enviada: false }, CFG))).toBe(ETAPA_FILTRO_PLANEJAMENTO);
  });
  it("Lançado", () => {
    expect(etapaFiltroId(etapaDoModelo({ ...INTERNO, lancado: true }, CFG))).toBe(ETAPA_FILTRO_LANCADO);
  });
  it("revenda: usa a MESMA coluna que o selo mostra pra ela (fluxo próprio)", () => {
    const revendaEmModelagem: ModeloKanban = { ...INTERNO, origem: "revenda", status_desenvolvimento: "em_modelagem" };
    expect(etapaFiltroId(etapaDoModelo(revendaEmModelagem, CFG))).toBe("em_modelagem");
    const revendaFixada: ModeloKanban = { ...FIXADO, origem: "revenda" }; // stand_by: fluxo revenda tem stand_by, manual → fixado
    expect(etapaFiltroId(etapaDoModelo(revendaFixada, CFG))).toBe("stand_by");
  });
  it("coluna órfã/desconhecida cai na 1ª coluna do board (mesma régua do selo — nunca 'sem etapa' à parte)", () => {
    const orfa: ModeloKanban = { ...INTERNO, status_desenvolvimento: "coluna_que_nao_existe_mais" };
    const selo = etapaDoModelo(orfa, CFG_OFF);
    expect(selo.key).toBe(BOARD[0].key);
    expect(etapaFiltroId(selo)).toBe(BOARD[0].key);
  });
  it("status nulo (nunca arrastado) cai na 1ª coluna, igual à órfã", () => {
    const nulo: ModeloKanban = { ...INTERNO, status_desenvolvimento: null };
    expect(etapaFiltroId(etapaDoModelo(nulo, CFG_OFF))).toBe(BOARD[0].key);
  });
});

describe("kanban-auto-ui — filtro 'Etapa do kanban' narrows a lista E concorda com o selo do card", () => {
  // Simula o predicado exato de `criacao.planejamento.tsx` (`fEtapaKanban.includes(etapaFiltroId(etapaDoModelo(m, kanbanCfg)))`)
  // sobre uma lista de "cards" com as etapas cobertas pelo requisito: Planejamento, Lançado, uma etapa
  // comum do board, uma etapa fixada (chave ligada) e um card de origem comprada (revenda).
  const cardPlanejamento: ModeloKanban = { origem: null, status_desenvolvimento: null, ordem_criacao_enviada: false, lancado: false };
  const cardLancado: ModeloKanban = { origem: null, status_desenvolvimento: "aprovado", ordem_criacao_enviada: true, lancado: true };
  const cardEmPilotagem: ModeloKanban = INTERNO; // em_pilotagem, automática com CFG
  const cardFixado: ModeloKanban = FIXADO; // stand_by, fixado com CFG
  const cardRevenda: ModeloKanban = { origem: "revenda", status_desenvolvimento: "em_modelagem", ordem_criacao_enviada: true, lancado: false };
  const lista = [cardPlanejamento, cardLancado, cardEmPilotagem, cardFixado, cardRevenda];

  const filtrar = (sel: string[], cfg = CFG) =>
    sel.length === 0 ? lista : lista.filter((m) => sel.includes(etapaFiltroId(etapaDoModelo(m, cfg))));

  it("seleção vazia = sem filtro (comportamento de hoje) — devolve a lista inteira", () => {
    expect(filtrar([])).toEqual(lista);
  });

  it("marcar só 'Planejamento' isola o card antes da Ordem de Criação", () => {
    expect(filtrar([ETAPA_FILTRO_PLANEJAMENTO])).toEqual([cardPlanejamento]);
  });

  it("marcar só 'Lançado' isola o card lançado", () => {
    expect(filtrar([ETAPA_FILTRO_LANCADO])).toEqual([cardLancado]);
  });

  it("marcar uma coluna do board isola quem está nela (inclusive fixado)", () => {
    expect(filtrar(["em_pilotagem"])).toEqual([cardEmPilotagem]);
    expect(filtrar(["stand_by"])).toEqual([cardFixado]);
  });

  it("revenda: marcar a coluna que o SELO mostra pra ela também isola o card comprado", () => {
    // cardRevenda está em "em_modelagem" (fluxo interno E revenda concordam nessa key aqui).
    expect(filtrar(["em_modelagem"])).toEqual([cardRevenda]);
  });

  it("marcar várias etapas soma (OR dentro do próprio filtro)", () => {
    expect(filtrar([ETAPA_FILTRO_PLANEJAMENTO, ETAPA_FILTRO_LANCADO])).toEqual([cardPlanejamento, cardLancado]);
  });

  it("badge e filtro SEMPRE concordam: pra cada card, o selo mostrado bate com a ÚNICA opção que o inclui", () => {
    for (const m of lista) {
      const selo = etapaDoModelo(m, CFG);
      const id = etapaFiltroId(selo);
      // a opção com esse id existe no catálogo do filtro...
      const opts = etapaKanbanFiltroOpts(CFG);
      expect(opts.some((o) => o.id === id)).toBe(true);
      // ...e filtrar por ela devolve exatamente os cards cujo selo é esse mesmo id (agreement).
      const filtrados = filtrar([id]);
      for (const f of filtrados) expect(etapaFiltroId(etapaDoModelo(f, CFG))).toBe(id);
      expect(filtrados).toContain(m);
    }
  });
});

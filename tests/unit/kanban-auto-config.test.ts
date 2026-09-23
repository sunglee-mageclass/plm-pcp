import { describe, it, expect } from "vitest";
import {
  KANBAN_COLS, agruparMovimentos, avisosRestauracaoVisiveis, conflitoKanban, descreverMudancasKanban, diffKanban,
  formatarDataHora, jsonCanonico, juntarLista, mensagemConflitoKanban, nCards, pickKanban, resumirFixados,
  separarPayloadKanban,
} from "@/lib/kanban-auto-config";
import type { PreviaCard, PreviaFixado } from "@/lib/kanban-auto-ui";

const KEYS = ["em_modelagem", "em_pilotagem", "prova_roupa_1", "stand_by", "reprovado", "aprovado"];
const card = (id: string, de: string | null, para: string | null, recua = false): PreviaCard => ({
  modelo_id: id, nome: `M${id}`, ref: null, origem: "interno", de, para, fixado: false, recua, primeira_falha: null, faltando: [],
});
const fix = (id: string, coluna: string): PreviaFixado => ({ modelo_id: id, nome: null, ref: null, origem: null, coluna, posicao_derivada: "em_modelagem" });

describe("kanban-auto-config — JSON canônico e diff (RP3)", () => {
  it("ordem das chaves de objeto não importa; ordem de array importa; undefined ≡ null", () => {
    expect(jsonCanonico({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(jsonCanonico({ a: [{ c: 2, d: 1 }], b: 1 }));
    expect(jsonCanonico([1, 2])).not.toBe(jsonCanonico([2, 1]));
    expect(jsonCanonico(undefined)).toBe(jsonCanonico(null));
  });
  it("pickKanban pega SÓ as 5 colunas (null quando faltam)", () => {
    expect(KANBAN_COLS).toEqual(["status_kanban", "kanban_requisitos", "kanban_requisitos_excecoes", "revenda_kanban_colunas", "revenda_kanban_requisitos"]);
    expect(pickKanban({ status_kanban: ["A"], timezone: "x" })).toEqual({
      status_kanban: ["A"], kanban_requisitos: null, kanban_requisitos_excecoes: null, revenda_kanban_colunas: null, revenda_kanban_requisitos: null,
    });
    expect(pickKanban(null).status_kanban).toBeNull();
  });
  it("diffKanban devolve só as colunas que mudaram (valor ATUAL)", () => {
    const base = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { a: ["x"], b: ["y"] }, revenda_kanban_colunas: [] });
    const mesmo = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { b: ["y"], a: ["x"] }, revenda_kanban_colunas: [] });
    expect(diffKanban(base, mesmo)).toEqual({});
    const mudou = pickKanban({ status_kanban: ["B", "A"], kanban_requisitos: { a: ["x"], b: ["y"] }, revenda_kanban_colunas: ["a"] });
    expect(diffKanban(base, mudou)).toEqual({ status_kanban: ["B", "A"], revenda_kanban_colunas: ["a"] });
  });
  it("conflitoKanban compara o CRU lido na abertura com o banco AGORA", () => {
    const aberto = pickKanban({ kanban_requisitos: { a: ["x"] }, status_kanban: ["A"] });
    expect(conflitoKanban(aberto, { kanban_requisitos: { a: ["x"] }, status_kanban: ["A"], timezone: "outro" })).toEqual([]);
    expect(conflitoKanban(aberto, { kanban_requisitos: { a: ["x", "y"] }, status_kanban: ["A"] })).toEqual(["kanban_requisitos"]);
  });
  it("separarPayloadKanban tira as 5 colunas do upsert genérico", () => {
    const { geral, kanban } = separarPayloadKanban({
      tenant_id: "t", timezone: "America/Sao_Paulo", status_kanban: ["A"], kanban_requisitos: {}, revenda_kanban_colunas: [],
    });
    expect(geral).toEqual({ tenant_id: "t", timezone: "America/Sao_Paulo" });
    expect(kanban).toEqual({ status_kanban: ["A"], kanban_requisitos: {}, revenda_kanban_colunas: [] });
  });
});

describe("kanban-auto-config — textos", () => {
  it("juntarLista e descrição das mudanças", () => {
    expect(juntarLista([])).toBe("");
    expect(juntarLista(["a"])).toBe("a");
    expect(juntarLista(["a", "b", "c"])).toBe("a, b e c");
    expect(descreverMudancasKanban(["kanban_requisitos"])).toBe("os requisitos");
    expect(descreverMudancasKanban(["status_kanban", "kanban_requisitos"])).toBe("as colunas do kanban (nomes ou ordem) e os requisitos");
    expect(descreverMudancasKanban(["kanban_requisitos_excecoes", "revenda_kanban_colunas", "revenda_kanban_requisitos"]))
      .toBe("as exceções da cascata, as colunas da revenda e os requisitos da revenda");
  });
  it("mensagem de conflito", () => {
    expect(mensagemConflitoKanban(["kanban_requisitos"])).toBe(
      "Outra pessoa mudou os requisitos depois que você abriu esta tela. Recarregue a página e refaça a sua alteração antes de salvar.",
    );
  });
  it("nCards", () => {
    expect([nCards(0), nCards(1), nCards(3)]).toEqual(["0 cards", "1 card", "3 cards"]);
  });
});

describe("kanban-auto-config — prévias", () => {
  it("agruparMovimentos por (de, para) na ordem do board", () => {
    const g = agruparMovimentos(
      [card("1", "em_modelagem", "em_pilotagem"), card("2", "aprovado", "em_pilotagem", true), card("3", "em_modelagem", "em_pilotagem"), card("4", "zzz", "em_modelagem")],
      KEYS,
    );
    expect(g.map((x) => [x.de, x.para, x.recua, x.cards.map((c) => c.modelo_id)])).toEqual([
      ["em_modelagem", "em_pilotagem", false, ["1", "3"]],
      ["aprovado", "em_pilotagem", true, ["2"]],
      ["zzz", "em_modelagem", false, ["4"]],
    ]);
  });
  it("resumirFixados conta por coluna, na ordem do board", () => {
    expect(resumirFixados([fix("1", "stand_by"), fix("2", "reprovado"), fix("3", "stand_by")], KEYS))
      .toEqual([{ coluna: "stand_by", n: 2 }, { coluna: "reprovado", n: 1 }]);
  });
  it("avisos da restauração: some o 'Desligue…' (o diálogo desliga ANTES de restaurar)", () => {
    expect(avisosRestauracaoVisiveis([
      "A REF revelada e o #Erro não voltam.",
      "Desligue o Kanban automático antes de restaurar (senão o próximo salvamento refaz as colunas).",
    ])).toEqual(["A REF revelada e o #Erro não voltam."]);
  });
  it("formatarDataHora no fuso da loja", () => {
    expect(formatarDataHora("2026-09-22T17:30:00Z", "America/Sao_Paulo")).toBe("22/09/2026 14:30");
    expect(formatarDataHora("2026-09-23T03:05:00Z", "America/Sao_Paulo")).toBe("23/09/2026 00:05");
    expect(formatarDataHora(null, "America/Sao_Paulo")).toBe("—");
    expect(formatarDataHora("lixo", "America/Sao_Paulo")).toBe("—");
  });
});

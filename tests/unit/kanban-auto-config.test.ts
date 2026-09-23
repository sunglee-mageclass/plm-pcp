import { describe, it, expect } from "vitest";
import {
  KANBAN_COLS, agruparMovimentos, avisosRestauracaoVisiveis, chaveKanbanMudou, conflitoKanban, descreverMudancasKanban,
  diffKanban, formatarDataHora, jsonCanonico, juntarLista, MENSAGEM_CHAVE_KANBAN_MUDOU, mensagemConflitoKanban, nCards,
  pickKanban, resolverEcoKanban, resumirFixados, separarPayloadKanban,
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
  describe("resolverEcoKanban (fix round 2 — protege o kanban local durante o salvamento)", () => {
    it("(i) eco DURANTE o salvamento (protegido=true) preserva o local; kanbanBase intocado", () => {
      const local = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { a: ["x"] } });
      const servidorNovo = pickKanban({ status_kanban: ["A"] });
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const r = resolverEcoKanban(true, local, servidorNovo, baseAtual);
      expect(r.cfgKanban).toEqual(local);
      expect(r.cfgKanban).not.toEqual(servidorNovo);
      expect(r.kanbanBase).toBe(baseAtual); // MESMA referência: intocado, não uma cópia igual
    });
    it("(ii) protegido + eco de OUTRA ABA (servidor mudou por fora): retry acusa o conflito real", () => {
      // A tela abriu com status_kanban:["A"]. kanbanBase reflete isso (nem local nem servidorNovo
      // do eco mexem nele, pois está protegido). Outra aba muda o servidor para ["A","C"] nesse
      // meio-tempo — o eco chega com esse valor, mas resolverEcoKanban NÃO deixa isso contaminar
      // kanbanBase.servidor.
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const local = pickKanban({ status_kanban: ["A", "B"] }); // usuário editou localmente
      const servidorNovoOutraAba = pickKanban({ status_kanban: ["A", "C"] }); // outra aba mudou o banco
      const r = resolverEcoKanban(true, local, servidorNovoOutraAba, baseAtual);
      expect(r.kanbanBase).toBe(baseAtual); // não adotou o valor da outra aba
      // Retry: conflitoKanban compara kanbanBase.servidor (ainda ["A"]) contra o banco REAL agora
      // (["A","C"], o que a outra aba gravou) — acusa o conflito de verdade.
      const conflito = conflitoKanban(r.kanbanBase.servidor, { status_kanban: ["A", "C"] });
      expect(conflito).toEqual(["status_kanban"]);
    });
    it("(iii) protegido + eco do PRÓPRIO upsert (servidor não mudou o kanban): sem conflito falso no retry", () => {
      // upsert(geral) não toca nas 5 colunas de kanban — o servidor real continua ["A"] (mesmo
      // valor de antes da tentativa). O eco desse upsert chega com o kanban intacto.
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const local = pickKanban({ status_kanban: ["A", "B"] });
      const servidorNovoDoProprioEco = pickKanban({ status_kanban: ["A"] }); // kanban do banco intocado
      const r = resolverEcoKanban(true, local, servidorNovoDoProprioEco, baseAtual);
      expect(r.kanbanBase).toBe(baseAtual);
      // Retry: kanbanBase.servidor (["A"]) contra o banco real AGORA (["A"], ninguém mudou) — sem conflito.
      const conflito = conflitoKanban(r.kanbanBase.servidor, { status_kanban: ["A"] });
      expect(conflito).toEqual([]);
    });
    it("(iv) sucesso (protegido=false) ⇒ volta ao normal: cfgKanban e kanbanBase adotam o servidor", () => {
      const local = pickKanban({ status_kanban: ["A", "B"] }); // o que ficou na tela durante a falha
      const servidorNovo = pickKanban({ status_kanban: ["A", "B"] }); // agora já gravado no banco
      const baseAtual = { cfg: pickKanban({ status_kanban: ["A"] }), servidor: pickKanban({ status_kanban: ["A"] }) };
      const r = resolverEcoKanban(false, local, servidorNovo, baseAtual);
      expect(r.cfgKanban).toEqual(servidorNovo);
      expect(r.kanbanBase).toEqual({ cfg: servidorNovo, servidor: servidorNovo });
    });
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
  // Minor 1 (fix round 1, garantia D19): `prepararSalvar` guarda a chave que viu; o `mutationFn` relê
  // e compara com esta função pura antes de confirmar o save. `atual` chega como `unknown` porque vem
  // direto do `Record<string, unknown>` de `lerConfigServidor` — nunca assumir que já é boolean.
  it("chaveKanbanMudou compara a chave esperada com o valor RELIDO do servidor", () => {
    expect(chaveKanbanMudou(true, true)).toBe(false);
    expect(chaveKanbanMudou(false, false)).toBe(false);
    expect(chaveKanbanMudou(false, null)).toBe(false); // ausência de coluna (sem F1) ≡ desligada dos dois lados
    expect(chaveKanbanMudou(true, false)).toBe(true);
    expect(chaveKanbanMudou(false, true)).toBe(true);
    expect(chaveKanbanMudou(true, null)).toBe(true); // era true, sumiu/virou null no reread — mudou
    expect(chaveKanbanMudou(true, "true")).toBe(true); // só `=== true` conta como ligado, string não
  });
  it("mensagem fixa da chave mudada", () => {
    expect(MENSAGEM_CHAVE_KANBAN_MUDOU).toBe("A chave Kanban automático mudou em outra aba; recarregue antes de salvar.");
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

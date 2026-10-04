// [modularidade F3] Regras de tela puras: abas do Dashboard por módulo (M7), Lançar sem Produção (P-252 A) e aviso de
// excluir coleção com cards (P-255 A).
import { describe, it, expect } from "vitest";
import { abasVisiveis, abaTemModulo, blocosCustoFinanceiro, DASH_ABA_MODULOS } from "@/lib/dashboard-abas";
import {
  bloqueiosLancar, prontoParaLancar, textoLancarExige,
  TEXTO_LANCAR_CQ, TEXTO_LANCAR_MO, TEXTO_LANCAR_MO_REABRE, TEXTO_LANCAR_DATA,
} from "@/lib/lancar";
import { mensagemErro, textoColecaoComCards } from "@/lib/erro-mensagem";
import { avisoExclusaoColecao, rotuloCardDaColecao, LIMITE_LISTA_CARDS, type CardDaColecao } from "@/lib/colecao-excluir";

const TODAS = [
  { value: "desenvolvimento" }, { value: "producao_qualidade" }, { value: "comercial_colecao" },
  { value: "custo_financeiro" }, { value: "leadtime" },
];
const podeTudo = () => true;
const mods = (ligados: string[]) => (k: string) => ligados.includes(k);
const valores = (ligados: string[], canView: (p: string) => boolean = podeTudo) =>
  abasVisiveis(TODAS, canView, mods(ligados)).map((t) => t.value);

describe("abasVisiveis (M7): matriz módulo × aba", () => {
  it("tudo ligado: as 5 abas, na ordem", () => {
    expect(valores(["criacao", "producao", "financeiro", "dashboard"])).toEqual(
      ["desenvolvimento", "producao_qualidade", "comercial_colecao", "custo_financeiro", "leadtime"],
    );
  });
  it("sem Criação: some Desenvolvimento, Comercial e Leadtime; Custo & Financeiro fica com Financeiro", () => {
    expect(valores(["producao", "financeiro", "dashboard"])).toEqual(["producao_qualidade", "custo_financeiro"]);
  });
  it("sem Financeiro: Custo & Financeiro continua com Criação (custo dos cards não depende do Financeiro)", () => {
    expect(valores(["criacao", "producao", "dashboard"])).toContain("custo_financeiro");
  });
  it("sem Criação e sem Financeiro: a aba Custo & Financeiro some", () => {
    expect(valores(["producao", "dashboard"])).toEqual(["producao_qualidade"]);
  });
  it("sem Produção: some só Produção & Qualidade", () => {
    expect(valores(["criacao", "financeiro", "dashboard"])).toEqual(
      ["desenvolvimento", "comercial_colecao", "custo_financeiro", "leadtime"],
    );
  });
  it("só Dashboard (sem Criação, Produção, Financeiro): nenhuma aba", () => {
    expect(valores(["dashboard"])).toEqual([]);
  });
  it("a permissão continua valendo: módulo ligado sem `dashboard_<aba>` não mostra a aba", () => {
    const so = (p: string) => p === "dashboard_leadtime" || p === "dashboard_custo_financeiro";
    expect(valores(["criacao", "producao", "financeiro"], so)).toEqual(["custo_financeiro", "leadtime"]);
  });
  it("aba fora do mapa não exige módulo; as 5 abas do Dashboard estão no mapa", () => {
    expect(abaTemModulo("qualquer", mods([]))).toBe(true);
    expect(Object.keys(DASH_ABA_MODULOS).sort()).toEqual(TODAS.map((t) => t.value).sort());
  });
  it("blocosCustoFinanceiro: Financeiro = parcelas; Criação = custos", () => {
    expect(blocosCustoFinanceiro(mods(["financeiro"]))).toEqual({ financeiro: true, custos: false });
    expect(blocosCustoFinanceiro(mods(["criacao"]))).toEqual({ financeiro: false, custos: true });
    expect(blocosCustoFinanceiro(mods(["criacao", "financeiro"]))).toEqual({ financeiro: true, custos: true });
  });
});

describe("bloqueiosLancar (P-252 A)", () => {
  const ok = { cqExigido: true, cqLiberado: true, moAprovada: true, temData: true };
  it("tudo em dia: nada bloqueia", () => {
    expect(bloqueiosLancar(ok)).toEqual([]);
  });
  it("com Produção: CQ não liberado bloqueia", () => {
    expect(bloqueiosLancar({ ...ok, cqLiberado: false })).toEqual([TEXTO_LANCAR_CQ]);
  });
  it("sem Produção: o CQ NÃO é cobrado (só M.O. e data)", () => {
    expect(bloqueiosLancar({ ...ok, cqExigido: false, cqLiberado: false })).toEqual([]);
    expect(bloqueiosLancar({ cqExigido: false, cqLiberado: false, moAprovada: false, temData: false })).toEqual([TEXTO_LANCAR_MO, TEXTO_LANCAR_DATA]);
  });
  it("M.O. pendente e data faltando, na ordem CQ, M.O., data", () => {
    expect(bloqueiosLancar({ cqExigido: true, cqLiberado: false, moAprovada: false, temData: false })).toEqual([TEXTO_LANCAR_CQ, TEXTO_LANCAR_MO, TEXTO_LANCAR_DATA]);
  });
  it("M.O. que vai reabrir ao salvar troca o texto para 'salve antes' (sem duplicar)", () => {
    expect(bloqueiosLancar({ ...ok, moAprovada: false, moReabreAoSalvar: true })).toEqual([TEXTO_LANCAR_MO_REABRE]);
  });
  it("prontoParaLancar: M.O. aprovada e, só com Produção, o CQ", () => {
    expect(prontoParaLancar({ cqExigido: true, cqLiberado: true, moAprovada: true })).toBe(true);
    expect(prontoParaLancar({ cqExigido: true, cqLiberado: false, moAprovada: true })).toBe(false);
    expect(prontoParaLancar({ cqExigido: false, cqLiberado: false, moAprovada: true })).toBe(true);
    expect(prontoParaLancar({ cqExigido: false, cqLiberado: true, moAprovada: false })).toBe(false);
  });
  it("texto do foguete: sem Produção é o do plano; com Produção segue pedindo o CQ", () => {
    expect(textoLancarExige(false)).toBe("Lançar exige a mão de obra aprovada e a data");
    expect(textoLancarExige(true)).toBe("Disponível só com CQ liberado e mão de obra aprovada");
  });
});

describe("avisoExclusaoColecao (P-255 A)", () => {
  const cards = (n: number): CardDaColecao[] =>
    Array.from({ length: n }, (_, i) => ({ id: `id${i}`, nome: `Modelo ${i + 1}`, ref: i % 2 === 0 ? `REF${i + 1}` : null }));

  it("sem cards: não bloqueia e avisa que o plano de tecido também é apagado", () => {
    const a = avisoExclusaoColecao(0, []);
    expect(a.bloqueada).toBe(false);
    expect(a.itens).toEqual([]);
    expect(a.maisTexto).toBeNull();
    expect(a.mensagem).toContain("O plano de tecido desta coleção também será apagado");
  });
  it("1 card: bloqueia, singular, lista o card", () => {
    const a = avisoExclusaoColecao(1, cards(1));
    expect(a.bloqueada).toBe(true);
    expect(a.mensagem).toContain("tem 1 card no Planejamento — mova ou exclua os cards antes");
    expect(a.itens).toEqual(["REF1 · Modelo 1"]);
    expect(a.maisTexto).toBeNull();
  });
  it("até 20 cards: lista todos, sem '… e mais'", () => {
    const a = avisoExclusaoColecao(20, cards(20));
    expect(a.itens).toHaveLength(20);
    expect(a.maisTexto).toBeNull();
    expect(LIMITE_LISTA_CARDS).toBe(20);
  });
  it("mais de 20: mostra 20 e '… e mais K' pelo total", () => {
    const a = avisoExclusaoColecao(27, cards(20));
    expect(a.mensagem).toContain("tem 27 cards");
    expect(a.itens).toHaveLength(20);
    expect(a.maisTexto).toBe("… e mais 7");
  });
  it("rótulo do card: REF · nome, só um dos dois, ou 'Card sem nome'", () => {
    expect(rotuloCardDaColecao({ ref: "10000001", nome: "Vestido" })).toBe("10000001 · Vestido");
    expect(rotuloCardDaColecao({ ref: null, nome: "Vestido" })).toBe("Vestido");
    expect(rotuloCardDaColecao({ ref: "10000001", nome: " " })).toBe("10000001");
    expect(rotuloCardDaColecao({ ref: null, nome: null })).toBe("Card sem nome");
  });
});

describe("avisoExclusaoColecao — texto único e produtos (m3/m5)", () => {
  it("o texto de 'coleção com cards' é o MESMO do erro do servidor (fonte única)", () => {
    expect(avisoExclusaoColecao(3, [], 20).mensagem).toBe(textoColecaoComCards(3));
    expect(avisoExclusaoColecao(1, [], 20).mensagem).toBe(textoColecaoComCards(1));
    expect(mensagemErro({ code: "P0001", message: "colecao_com_cards: 3" }, "fb")).toBe(textoColecaoComCards(3));
  });
  it("sem cards mas com produto acabado/importado: bloqueia de antemão, sem lista", () => {
    const a = avisoExclusaoColecao(0, [], 20, 2);
    expect(a.bloqueada).toBe(true);
    expect(a.itens).toEqual([]);
    expect(a.mensagem).toContain("em uso por produto(s) acabado(s) ou importado(s)");
    expect(a.mensagem).toContain("(2 produtos)");
  });
  it("com cards E produtos: a frase dos produtos vem à parte", () => {
    const a = avisoExclusaoColecao(1, [{ id: "1", nome: "A", ref: null }], 20, 1);
    expect(a.bloqueada).toBe(true);
    expect(a.produtosTexto).toContain("(1 produto)");
  });
  it("sem cards e sem produtos: segue liberando", () => {
    expect(avisoExclusaoColecao(0, [], 20, 0).bloqueada).toBe(false);
  });
});

describe("mensagemErro — recusas do lancar_modelo (I1)", () => {
  it("as 3 recusas 42501 em PT mostram o motivo real, não 'sem permissão'", () => {
    for (const msg of ["Confirme o Controle de Qualidade antes de lançar.", "Aprove a mão de obra antes de lançar.", "Informe a Data de Lançamento."]) {
      expect(mensagemErro({ code: "42501", message: msg }, "fb")).toBe(msg);
    }
    expect(mensagemErro({ code: "42501", message: "permission denied for table x" }, "fb")).toBe("Você não tem permissão para esta ação.");
  });
});

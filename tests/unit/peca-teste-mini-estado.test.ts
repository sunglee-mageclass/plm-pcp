// R11 T5 — ESTADO da mini na tentativa (lib pura): leitura do servidor, payload do Salvar, dirty, merge 3 vias, herança, travas, ação do
// Salvar, ↺, prévia de falta e resumo pós-Salvar. O cálculo (linhasUmaPeca/alocarTecido) segue coberto por peca-teste-mini.test.ts.
import { describe, it, expect } from "vitest";
import {
  aplicarCampoDele, chaveConfere, editarAtual, estadoPTDoServidor, mergePecaTeste, payloadPecaTeste, pathPT, ptDirty, reprovar, statusTrilha,
  tentativaAtualPT, tentativaVirtual, type EstadoPT, type TentativaPT, type TrilhaPT,
} from "../../src/lib/peca-teste";
import {
  acaoNoSalvar, ajustarLinha, confereDasLinhas, estoqueMiniDoServidor, faltasPreview, herdarMini, miniDoServidor, miniIgual, miniNova, miniParaPayload,
  miniTravada, miniVazia, resumoPosSalvar, trocarTamanhoOuCor, voltarAoCalculado, type MiniLinha, type MiniPT,
} from "../../src/lib/peca-teste-mini";

const L1 = "00000000-0000-4000-8000-0000000000a1";
const CAT = "00000000-0000-4000-8000-00000000ca01";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const VAR = "00000000-0000-4000-8000-0000000000b1";
const ITEM = "00000000-0000-4000-8000-0000000000c1";
const AV = "00000000-0000-4000-8000-0000000000d1";

const mini = (o: Partial<MiniPT> = {}): MiniPT => ({ ...miniNova(), ...o });
const ajuste = (chave: string, o: Record<string, unknown> = {}) => ({ chave, familia: "aviamento" as const, consumo: null, loss_percent: null, a_enviar: null, variante_aviamento_id: null, oc_tecido_item_id: null, ...o });
const tent = (numero: number, o: Partial<TentativaPT> = {}): TentativaPT => ({ ...tentativaVirtual(numero), id: `00000000-0000-4000-8000-00000000b${numero}00`.slice(0, 36), rev: 3, ...o });
const trilha = (o: Partial<TrilhaPT> = {}): TrilhaPT => ({ mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: F1, empresa_nome: "Oficina Um", mo_aprovado: true, tentativas: [], ...o });
const estado = (...t: TrilhaPT[]): EstadoPT => ({ trilhas: t, outros: [] });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const pronta = (o: Partial<MiniPT> = {}) => mini({ tamanho: "40|M", variante_tecido_id: VAR, ...o });

describe("leitura do servidor", () => {
  it("miniDoServidor: cabeçalho, ajustes e FOTO; null/forma estranha = null", () => {
    expect(miniDoServidor(null)).toBeNull();
    expect(miniDoServidor([])).toBeNull();
    const m = miniDoServidor({
      tamanho: "40|M", variante_tecido_id: VAR, mesma_oc: false, baixa_em: "2026-10-05T12:00:00Z", baixa_por_nome: "Ana", tem_historico: true,
      linhas: [
        { chave: "a:x:1", familia: "aviamento", consumo: 2, loss_percent: null, a_enviar: 3.5, variante_aviamento_id: AV, oc_tecido_item_id: null,
          foto: { rotulo: "Botão", variante: "Preto", unidade: "un", consumo: 2, loss_percent: 0, necessaria: 2, a_enviar: 3.5, baixado: 3, faltou: 0.5, fontes: [] } },
        { chave: "", familia: "tecido" },
      ],
    });
    expect(m).toMatchObject({ tamanho: "40|M", variante_tecido_id: VAR, mesma_oc: false, baixa_em: "2026-10-05T12:00:00Z", baixa_por_nome: "Ana", tem_historico: true });
    expect(m?.linhas).toHaveLength(1);
    expect(m?.linhas[0]).toMatchObject({ chave: "a:x:1", a_enviar: 3.5, variante_aviamento_id: AV, foto: { faltou: 0.5, unidade: "un" } });
  });
  it("estadoPTDoServidor lê a mini de cada tentativa (ausente = null)", () => {
    const e = estadoPTDoServidor({
      trilhas: [{ mo_linha_id: L1, categoria_id: CAT, tentativas: [
        { id: "t1", numero: 1, data_saida: "2026-10-01", mini: { tamanho: "40|M", variante_tecido_id: null, mesma_oc: true, linhas: [] } },
        { id: "t2", numero: 2 },
      ] }],
    });
    expect(e?.trilhas[0].tentativas[0].mini?.tamanho).toBe("40|M");
    expect(e?.trilhas[0].tentativas[1].mini).toBeNull();
  });
  it("miniVazia/miniIgual: null ≡ mini sem dado; ajuste só com valor conta; foto e baixa não entram na igualdade", () => {
    expect(miniVazia(null)).toBe(true);
    expect(miniVazia(miniNova())).toBe(true);
    expect(miniVazia(mini({ tamanho: "M" }))).toBe(false);
    expect(miniVazia(mini({ baixa_em: "2026-10-05T00:00:00Z" }))).toBe(false);
    expect(miniIgual(null, miniNova())).toBe(true);
    expect(miniIgual(mini({ linhas: [ajuste("a:1:1")] }), miniNova())).toBe(true); // linha sem ajuste = nada
    expect(miniIgual(mini({ linhas: [ajuste("a:1:1", { a_enviar: 2 })] }), miniNova())).toBe(false);
    expect(miniIgual(pronta({ baixa_em: "2026-10-05T00:00:00Z" }), pronta())).toBe(true);
    expect(miniIgual(pronta({ mesma_oc: false }), pronta())).toBe(false);
    expect(miniIgual(mini({ linhas: [ajuste("a:1:1", { a_enviar: 2.00001 })] }), mini({ linhas: [ajuste("a:1:1", { a_enviar: 2 })] }))).toBe(true); // 4 casas
  });
});

describe("payload — quando a mini vai", () => {
  const base = (m: MiniPT | null, o: Partial<TentativaPT> = {}) => estado(trilha({ tentativas: [tent(1, { mini: m, ...o })] }));
  const tentPayload = (d: EstadoPT, b: EstadoPT, opcoes?: Parameters<typeof payloadPecaTeste>[4]) => payloadPecaTeste(d, b, undefined, undefined, opcoes)._trilhas[0]?.tentativas[0];

  it("só mexeu nas datas (sem baixa possível) → SEM a chave mini", () => {
    const b = base(null);
    const d = clone(b); d.trilhas[0].tentativas[0].data_saida = "2026-10-01";
    const t = tentPayload(d, b)!;
    expect(t).toMatchObject({ id: b.trilhas[0].tentativas[0].id, data_saida: "2026-10-01" });
    expect("mini" in t).toBe(false);
  });
  it("mini mudou → vai a mini E o rev da tentativa (a mini conta como 'mudou')", () => {
    const b = base(null);
    const d = clone(b); d.trilhas[0].tentativas[0].mini = pronta({ mesma_oc: false, linhas: [ajuste("a:x:1", { a_enviar: 5, variante_aviamento_id: AV })] });
    const p = payloadPecaTeste(d, b);
    const t = p._trilhas[0].tentativas[0];
    expect(t.mini).toEqual({
      tamanho: "40|M", variante_tecido_id: VAR, mesma_oc: false, ajustes: [{ chave: "a:x:1", familia: "aviamento", consumo: null, loss_percent: null, a_enviar: 5, variante_aviamento_id: AV, oc_tecido_item_id: null }],
    });
    expect(t.mini && "confere" in t.mini).toBe(false); // sem data de saída = sem baixa = sem confere
    expect(p._rev_base.tentativas[t.id as string]).toBe(3);
    expect(ptDirty(d, b)).toBe(true);
  });
  it("baixa prevista (Data de saída + tamanho + cor, sem baixa salva) → mini com `confere` de TODAS as chaves", () => {
    const b = base(pronta());
    const d = clone(b); d.trilhas[0].tentativas[0].data_saida = "2026-10-05";
    const confere = { [chaveConfere(L1, 1)]: confereDasLinhas([{ chave: "t:tecido:1:1:v", a_enviar: 1.23456 }, { chave: "a:x:1", a_enviar: 2 }]) };
    const t = tentPayload(d, b, { confere })!;
    expect(t.mini?.confere).toEqual({ "t:tecido:1:1:v": 1.2346, "a:x:1": 2 });
    // sem o mapa (aba velha / sem ficha): a mini vai, sem confere → o servidor usa o próprio cálculo
    expect(tentPayload(d, b)!.mini).toBeDefined();
    expect(tentPayload(d, b)!.mini && "confere" in tentPayload(d, b)!.mini!).toBe(false);
  });
  it("card sem Tecido 1 baixa só com o tamanho (semTecido1); com Tecido 1 sem cor = sem baixa e sem mini", () => {
    const b = base(mini({ tamanho: "40|M" }));
    const d = clone(b); d.trilhas[0].tentativas[0].data_saida = "2026-10-05";
    expect(tentPayload(d, b)!.mini).toBeUndefined();
    expect(tentPayload(d, b, { semTecido1: true })!.mini).toBeDefined();
  });
  it("estorno (Data de saída apagada com baixa salva) → data null + mini igual à base, SEM confere", () => {
    const b = base(pronta({ baixa_em: "2026-10-05T12:00:00Z" }), { data_saida: "2026-10-05" });
    const d = clone(b); d.trilhas[0].tentativas[0].data_saida = null;
    const t = tentPayload(d, b, { confere: { [chaveConfere(L1, 1)]: { x: 1 } } })!;
    expect(t.data_saida).toBeNull();
    expect(t.mini).toMatchObject({ tamanho: "40|M", variante_tecido_id: VAR });
    expect("confere" in t.mini!).toBe(false);
  });
  it("Q2 = A: baixa salva + data mantida + mini mudou → estorna e refaz (mini + confere)", () => {
    const b = base(pronta({ baixa_em: "2026-10-05T12:00:00Z" }), { data_saida: "2026-10-05" });
    const d = clone(b); d.trilhas[0].tentativas[0].mini = pronta({ baixa_em: "2026-10-05T12:00:00Z", linhas: [ajuste("a:x:1", { a_enviar: 9 })] });
    expect(acaoNoSalvar(d.trilhas[0].tentativas[0], b.trilhas[0].tentativas[0])).toBe("estorno_e_baixa");
    const t = tentPayload(d, b, { confere: { [chaveConfere(L1, 1)]: { "a:x:1": 9 } } })!;
    expect(t.mini?.confere).toEqual({ "a:x:1": 9 });
  });
  it("travada: baixa salva + só a DATA mudou → nada da mini (a baixa fica); decisão salva trava a mini", () => {
    const b = base(pronta({ baixa_em: "2026-10-05T12:00:00Z" }), { data_saida: "2026-10-05" });
    const d = clone(b); d.trilhas[0].tentativas[0].data_saida = "2026-10-06";
    expect(tentPayload(d, b)!.mini).toBeUndefined();
    const ap = base(pronta(), { aprovacao: "aprovado", data_saida: "2026-10-05", data_entrada: "2026-10-09", empresa_id: F1 });
    const d2 = clone(ap); d2.trilhas[0].tentativas[0].aprovacao = null;
    expect(tentPayload(d2, ap)!.mini).toBeUndefined();
  });
  it("abrir o card não dispara baixa: tudo igual à base → payload vazio e não 'sujo', mesmo com data + mini pronta sem baixa", () => {
    const b = base(pronta(), { data_saida: "2026-10-05" });
    expect(payloadPecaTeste(clone(b), b)._trilhas).toEqual([]);
    expect(ptDirty(clone(b), b)).toBe(false);
  });
  it("reprovar no mesmo Salvar da baixa: a baixa sai (peça gasta) e a próxima herda a mini", () => {
    const b = base(pronta({ mesma_oc: false, linhas: [ajuste("t:tecido:1:1:v", { familia: "tecido", oc_tecido_item_id: ITEM, a_enviar: 4 })] }), { data_saida: "2026-10-01", data_entrada: "2026-10-04" });
    const d = estado(reprovar(b.trilhas[0], { id: F1, nome: "Oficina Um" }));
    const p = payloadPecaTeste(d, b, undefined, undefined, { confere: { [chaveConfere(L1, 1)]: { "t:tecido:1:1:v": 4 } } });
    const [t1, t2] = p._trilhas[0].tentativas;
    expect(t1).toMatchObject({ numero: 1, aprovacao: "reprovado" });
    expect(t1.mini?.confere).toEqual({ "t:tecido:1:1:v": 4 });
    // a 2ª nasce só com a mini herdada: tamanho, cor, mesma_oc e o item de OC — SEM a_enviar
    expect(t2).toMatchObject({ id: null, numero: 2, data_saida: null, aprovacao: null });
    expect(t2.mini).toEqual({
      tamanho: "40|M", variante_tecido_id: VAR, mesma_oc: false,
      ajustes: [{ chave: "t:tecido:1:1:v", familia: "tecido", consumo: null, loss_percent: null, a_enviar: null, variante_aviamento_id: null, oc_tecido_item_id: ITEM }],
    });
  });
  it("tentativa NOVA (id nulo) só com mini com dado entra; mini vazia não", () => {
    const b = estado(trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-10-01", data_entrada: "2026-10-04", empresa_id: F1 })] }));
    expect(payloadPecaTeste(clone(b), b)._trilhas).toEqual([]);
    const d = clone(b); d.trilhas[0].tentativas.push({ ...tentativaVirtual(2), mini: pronta() });
    const t = payloadPecaTeste(d, b)._trilhas[0].tentativas[0];
    expect(t).toMatchObject({ id: null, numero: 2, mini: { tamanho: "40|M" } });
    const d2 = clone(b); d2.trilhas[0].tentativas.push({ ...tentativaVirtual(2), mini: miniNova() });
    expect(payloadPecaTeste(d2, b)._trilhas).toEqual([]);
  });
  it("miniParaPayload: só as linhas COM ajuste vão; mini nula vira cabeçalho vazio", () => {
    expect(miniParaPayload(null)).toEqual({ tamanho: null, variante_tecido_id: null, mesma_oc: true, ajustes: [] });
    expect(miniParaPayload(mini({ linhas: [ajuste("a:1:1"), ajuste("a:2:1", { consumo: 1 })] })).ajustes.map((a) => a.chave)).toEqual(["a:2:1"]);
  });
});

describe("tentativa: dirty/SEM_CAMPOS com a mini; reprovar herda; status", () => {
  it("editarAtual: a virtual que ganha SÓ a mini entra na lista; volta a vazia, sai", () => {
    const t0 = trilha();
    const t1 = editarAtual(t0, { mini: pronta() });
    expect(t1.tentativas).toHaveLength(1);
    expect(tentativaAtualPT(t1).mini?.tamanho).toBe("40|M");
    expect(editarAtual(t1, { mini: miniNova() }).tentativas).toHaveLength(0);
  });
  it("reprovar: a próxima herda tamanho/cor/mesma_oc/OC (sem consumo/loss/a_enviar/variante de aviamento) e já entra na lista; status = 'reprovada_nova'", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: "2026-10-01", data_entrada: "2026-10-04", mini: pronta({ mesma_oc: false, linhas: [
      ajuste("t:tecido:1:1:v", { familia: "tecido", oc_tecido_item_id: ITEM, consumo: 2, loss_percent: 5, a_enviar: 9 }),
      ajuste("a:x:1", { variante_aviamento_id: AV, a_enviar: 3 }),
    ] }) })] });
    const r = reprovar(t, { id: F1, nome: "Oficina Um" });
    const nova = r.tentativas.find((x) => x.numero === 2)!;
    expect(nova).toMatchObject({ id: null, aprovacao: null, data_saida: null });
    expect(nova.mini).toMatchObject({ tamanho: "40|M", variante_tecido_id: VAR, mesma_oc: false, baixa_em: null });
    expect(nova.mini!.linhas).toEqual([ajuste("t:tecido:1:1:v", { familia: "tecido", oc_tecido_item_id: ITEM })]);
    expect(statusTrilha(r)).toBe("reprovada_nova");
    expect(tentativaAtualPT(r).numero).toBe(2);
  });
  it("reprovar SEM nada a herdar segue como na R9 (a próxima é virtual, fora da lista)", () => {
    const r = reprovar(trilha({ tentativas: [tent(1, { data_saida: "2026-10-01", data_entrada: "2026-10-04" })] }), { id: F1, nome: "x" });
    expect(r.tentativas).toHaveLength(1);
    expect(statusTrilha(r)).toBe("reprovada_nova");
  });
  it("a atual derivada depois de uma reprovada que veio do servidor também herda", () => {
    const t = trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-10-01", data_entrada: "2026-10-04", mini: pronta() })] });
    expect(tentativaAtualPT(t)).toMatchObject({ id: null, numero: 2, mini: { tamanho: "40|M", variante_tecido_id: VAR } });
  });
  it("herdarMini: nada a herdar = null; baixa/foto nunca passam", () => {
    expect(herdarMini(null)).toBeNull();
    expect(herdarMini(miniNova())).toBeNull();
    expect(herdarMini(mini({ linhas: [ajuste("a:1:1", { a_enviar: 3 })] }))).toBeNull();
    const h = herdarMini(pronta({ baixa_em: "2026-10-05T00:00:00Z", tem_historico: true, baixa_por_nome: "Ana" }))!;
    expect(h).toMatchObject({ baixa_em: null, baixa_por_nome: null, tem_historico: false });
  });
});

describe("acaoNoSalvar — 6 casos + travas", () => {
  const T = (o: Partial<TentativaPT>): TentativaPT => tent(1, o);
  const baixada = pronta({ baixa_em: "2026-10-05T12:00:00Z" });
  it("null: sem data de saída e sem baixa", () => expect(acaoNoSalvar(T({ mini: pronta() }), T({ mini: pronta() }))).toBeNull());
  it("baixa: data + tamanho + cor, sem baixa salva", () => expect(acaoNoSalvar(T({ data_saida: "2026-10-05", mini: pronta() }), T({ mini: pronta() }))).toBe("baixa"));
  it("sem_baixa_falta_tamanho_cor (P-349): data sem tamanho/cor", () => {
    expect(acaoNoSalvar(T({ data_saida: "2026-10-05", mini: mini({ tamanho: "40|M" }) }), T({}))).toBe("sem_baixa_falta_tamanho_cor");
    expect(acaoNoSalvar(T({ data_saida: "2026-10-05", mini: null }), null)).toBe("sem_baixa_falta_tamanho_cor");
  });
  it("estorno: baixa salva e a data foi apagada", () => expect(acaoNoSalvar(T({ mini: baixada }), T({ data_saida: "2026-10-05", mini: baixada }))).toBe("estorno"));
  it("estorno_e_baixa (Q2 = A): baixa salva, data mantida e a mini mudou", () => {
    const mudada = pronta({ baixa_em: baixada.baixa_em, linhas: [ajuste("a:1:1", { a_enviar: 7 })] });
    expect(acaoNoSalvar(T({ data_saida: "2026-10-05", mini: mudada }), T({ data_saida: "2026-10-05", mini: baixada }))).toBe("estorno_e_baixa");
  });
  it("mini mudou para sem tamanho/cor: só estorna (não há o que baixar)", () => {
    expect(acaoNoSalvar(T({ data_saida: "2026-10-05", mini: mini({ baixa_em: baixada.baixa_em }) }), T({ data_saida: "2026-10-05", mini: baixada }))).toBe("estorno");
  });
  it("null: baixa salva, data mantida e mini igual (mudar só a data mantém a baixa)", () => {
    expect(acaoNoSalvar(T({ data_saida: "2026-10-09", mini: baixada }), T({ data_saida: "2026-10-05", mini: baixada }))).toBeNull();
  });
  it("aprovada/reprovada (decisão SALVA) → null (mini imutável)", () => {
    expect(acaoNoSalvar(T({ data_saida: "2026-10-05", mini: pronta() }), T({ aprovacao: "aprovado", mini: pronta() }))).toBeNull();
    expect(acaoNoSalvar(T({ data_saida: "2026-10-05", mini: pronta() }), T({ aprovacao: "reprovado", mini: pronta() }))).toBeNull();
  });
  it("miniTravada: baixa salva E data no rascunho; ou decidida; senão editável", () => {
    expect(miniTravada(T({ data_saida: "2026-10-05" }), T({ data_saida: "2026-10-05", mini: baixada }))).toBe(true);
    expect(miniTravada(T({ data_saida: null }), T({ data_saida: "2026-10-05", mini: baixada }))).toBe(false); // apagou a data: destrava (vai estornar)
    expect(miniTravada(T({}), T({ aprovacao: "aprovado" }))).toBe(true);
    expect(miniTravada(T({}), T({ aprovacao: "reprovado" }))).toBe(true);
    expect(miniTravada(T({ aprovacao: "aprovado" }), T({ mini: pronta() }))).toBe(false); // decidir só no rascunho ainda não trava
    expect(miniTravada(T({ data_saida: "2026-10-05" }), null)).toBe(false);
  });
});

describe("merge 3 vias da mini (uma unidade: pt:<linha>:mini)", () => {
  const um = (o: Partial<TentativaPT>) => estado(trilha({ tentativas: [tent(1, o)] }));
  const base = um({ mini: pronta() });
  const comMini = (e: EstadoPT, m: MiniPT | null) => { const c = clone(e); c.trilhas[0].tentativas[0].mini = m; return c; };
  const alt = (a: number) => pronta({ linhas: [ajuste("a:x:1", { a_enviar: a })] });

  it("só eu mudei → a minha", () => {
    const r = mergePecaTeste(base, comMini(base, alt(5)), clone(base));
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0].mini?.linhas[0].a_enviar).toBe(5);
  });
  it("só ele mudou → a dele (conta como atualizado)", () => {
    const r = mergePecaTeste(base, clone(base), comMini(base, alt(7)));
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0].mini?.linhas[0].a_enviar).toBe(7);
    expect(r.atualizados).toBeGreaterThan(0);
  });
  it("os dois diferentes → conflito 'Mini explosão' no path pt:<linha>:mini; fica a minha até resolver", () => {
    const r = mergePecaTeste(base, comMini(base, alt(5)), comMini(base, alt(7)));
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].path).toBe(pathPT(L1, "mini"));
    expect(r.conflitos[0].path).toBe(`pt:${L1}:mini`);
    expect(r.conflitos[0].meu).toContain("Mini explosão");
    expect(r.conflitos[0].dele).toContain("Mini explosão");
    expect(r.valor.trilhas[0].tentativas[0].mini?.linhas[0].a_enviar).toBe(5);
  });
  it("os dois chegaram ao MESMO resultado → sem conflito", () => {
    expect(mergePecaTeste(base, comMini(base, alt(5)), comMini(base, alt(5))).conflitos).toEqual([]);
  });
  it("tentativa que não é a atual → path pt:<linha>:t<n>:mini", () => {
    const b = estado(trilha({ tentativas: [tent(1, { mini: pronta() }), tent(2, { mini: pronta() })] }));
    const m = clone(b), d = clone(b);
    m.trilhas[0].tentativas[0].mini = alt(5); d.trilhas[0].tentativas[0].mini = alt(7);
    expect(mergePecaTeste(b, m, d).conflitos.map((c) => c.path)).toEqual([`pt:${L1}:t1:mini`]);
  });
  it("a baixa DELE ≠ a da base → a dele, SEM escolha, + aviso (mesmo com edição minha)", () => {
    const dele = comMini(base, pronta({ baixa_em: "2026-10-05T12:00:00Z", baixa_por_nome: "Ana", linhas: [ajuste("a:x:1", { a_enviar: 7, foto: { rotulo: "Botão", variante: null, unidade: "un", consumo: null, loss_percent: null, necessaria: 7, a_enviar: 7, baixado: 7, faltou: 0, fontes: [] } })] }));
    const r = mergePecaTeste(base, comMini(base, alt(5)), dele);
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0].mini?.baixa_em).toBe("2026-10-05T12:00:00Z");
    expect(r.valor.trilhas[0].tentativas[0].mini?.linhas[0].a_enviar).toBe(7);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/foi feita por outra pessoa/);
    // estorno dele
    const baseBaixada = um({ mini: pronta({ baixa_em: "2026-10-05T12:00:00Z" }), data_saida: "2026-10-05" });
    const r2 = mergePecaTeste(baseBaixada, clone(baseBaixada), um({ mini: pronta(), data_saida: null }));
    expect(r2.valor.trilhas[0].tentativas[0].mini?.baixa_em).toBeNull();
    expect(r2.avisos[0]).toMatch(/foi estornada por outra pessoa/);
  });
  it("sem mudança de ninguém → sem aviso, sem conflito", () => {
    const r = mergePecaTeste(base, clone(base), clone(base));
    expect(r).toMatchObject({ conflitos: [], avisos: [] });
  });
  it("minha mini vale mas a baixa/histórico (campos do servidor) vêm da dele", () => {
    const dele = comMini(base, pronta({ tem_historico: true }));
    const r = mergePecaTeste(base, comMini(base, alt(5)), dele);
    expect(r.valor.trilhas[0].tentativas[0].mini).toMatchObject({ tem_historico: true });
    expect(r.valor.trilhas[0].tentativas[0].mini?.linhas[0].a_enviar).toBe(5);
  });
  it("aplicarCampoDele cobre o path da mini (atual e de outra tentativa)", () => {
    const b = estado(trilha({ tentativas: [tent(1, { mini: pronta() }), tent(2, { mini: pronta() })] }));
    const meu = clone(b); meu.trilhas[0].tentativas[1].mini = alt(5); meu.trilhas[0].tentativas[0].mini = alt(6);
    const fresh = clone(b); fresh.trilhas[0].tentativas[1].mini = alt(9); fresh.trilhas[0].tentativas[0].mini = alt(8);
    const a = aplicarCampoDele(meu, fresh, `pt:${L1}:mini`).valor; // atual = nº 2
    expect(a.trilhas[0].tentativas[1].mini?.linhas[0].a_enviar).toBe(9);
    expect(a.trilhas[0].tentativas[0].mini?.linhas[0].a_enviar).toBe(6);
    const b2 = aplicarCampoDele(meu, fresh, `pt:${L1}:t1:mini`).valor;
    expect(b2.trilhas[0].tentativas[0].mini?.linhas[0].a_enviar).toBe(8);
  });
  it("tentativa que ele apagou: sem edição minha na mini some; com edição minha sobrevive", () => {
    const b = estado(trilha({ tentativas: [tent(1, { mini: pronta() })] }));
    const dele = estado(trilha({ tentativas: [] }));
    expect(mergePecaTeste(b, clone(b), dele).valor.trilhas[0].tentativas).toHaveLength(0);
    expect(mergePecaTeste(b, comMini(b, alt(5)), dele).valor.trilhas[0].tentativas).toHaveLength(1);
  });
});

describe("troca de tamanho/cor, ↺ e ajustes", () => {
  it("trocarTamanhoOuCor zera TODOS os ajustes e mantém 'mesma OC'", () => {
    const m = pronta({ mesma_oc: false, linhas: [ajuste("a:1:1", { a_enviar: 4 }), ajuste("t:x", { familia: "tecido", oc_tecido_item_id: ITEM })] });
    const r = trocarTamanhoOuCor(m, { tamanho: "42|G" });
    expect(r).toMatchObject({ tamanho: "42|G", variante_tecido_id: VAR, mesma_oc: false, linhas: [] });
    expect(trocarTamanhoOuCor(m, { variante_tecido_id: null }).variante_tecido_id).toBeNull();
    expect(trocarTamanhoOuCor(null, { tamanho: "M" })).toMatchObject({ tamanho: "M", mesma_oc: true });
  });
  it("ajustarLinha cria a linha; sem nenhum ajuste a linha sai", () => {
    let m = ajustarLinha(null, "a:1:1", "aviamento", { a_enviar: 3 });
    expect(m.linhas).toHaveLength(1);
    m = ajustarLinha(m, "a:1:1", "aviamento", { a_enviar: null });
    expect(m.linhas).toHaveLength(0);
  });
  it("voltarAoCalculado (↺) tira só o 'a enviar' por padrão e preserva o resto da linha", () => {
    const m = pronta({ linhas: [ajuste("a:1:1", { a_enviar: 3, variante_aviamento_id: AV })] });
    const r = voltarAoCalculado(m, "a:1:1");
    expect(r.linhas[0]).toMatchObject({ a_enviar: null, variante_aviamento_id: AV });
    expect(voltarAoCalculado(r, "a:1:1", ["variante_aviamento_id"]).linhas).toHaveLength(0);
    expect(voltarAoCalculado(m, "nao-existe")).toBe(m);
  });
  it("confereDasLinhas: 4 casas, uma entrada por chave", () => {
    expect(confereDasLinhas([{ chave: "a", a_enviar: 1.00005 }, { chave: "b", a_enviar: 2.5 }])).toEqual({ a: 1.0001, b: 2.5 });
  });
});

describe("prévia de falta e resumo pós-Salvar", () => {
  const lin = (o: Partial<MiniLinha>): MiniLinha => ({
    chave: "k", familia: "aviamento", rotulo: "Botão", variante_rotulo: null, unidade: "un", tipo: null, numero: 1, ordem: null, variante_tecido_id: null,
    pecas: 1, aviamento_id: AV, variante_aviamento_id: null, etiqueta_id: null, cor_id: null, tamanho_bucket: null, consumo: 1, loss_percent: 0,
    necessaria: 1, a_enviar: 1, oc_tecido_item_id: null, ...o,
  });
  const estoque = estoqueMiniDoServidor({
    modo: "por_oc",
    tecidos: [{ tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: VAR, vinculos: [{ oc_tecido_item_id: "i1", prioridade: 1, quantidade_m: 0, saldo: 1 }], fifo: [{ oc_tecido_item_id: "i1", saldo: 1 }, { oc_tecido_item_id: "i2", saldo: 0.5 }] }],
    aviamentos: [{ aviamento_id: AV, variantes: [{ variante_aviamento_id: null, fisico: 2 }] }],
    insumos: [{ etiqueta_id: "e1", tamanho: null, cor_id: null, fisico: 1 }],
  });
  it("estoqueMiniDoServidor: null → null", () => expect(estoqueMiniDoServidor(null)).toBeNull());
  it("aviamento: baixa o que há e sobra o faltou; linhas na ordem dividem o saldo", () => {
    const f = faltasPreview([lin({ chave: "a1", a_enviar: 1.5 }), lin({ chave: "a2", a_enviar: 1.5 })], estoque);
    expect(f).toEqual([{ chave: "a2", familia: "aviamento", rotulo: "Botão", unidade: "un", faltou: 1 }]);
  });
  it("tecido: alocarTecido (vínculo + FIFO) e o saldo consumido pela 1ª linha não está mais livre para a 2ª", () => {
    const t = (chave: string, m: number) => lin({ chave, familia: "tecido", unidade: "m", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: VAR, aviamento_id: null, a_enviar: m });
    expect(faltasPreview([t("t1", 1.2)], estoque)).toEqual([]); // 1 do vínculo + 0.2 do FIFO
    expect(faltasPreview([t("t1", 1.2), t("t2", 0.5)], estoque).map((x) => [x.chave, x.faltou])).toEqual([["t2", 0.2]]);
    expect(faltasPreview([t("t1", 3)], estoque)[0].faltou).toBe(1.5);
  });
  it("desmarcado: só o item escolhido, sem fallback", () => {
    const l = lin({ chave: "t1", familia: "tecido", unidade: "m", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: VAR, aviamento_id: null, a_enviar: 0.8, oc_tecido_item_id: "i2" });
    expect(faltasPreview([l], estoque, "por_oc", false)[0].faltou).toBe(0.3);
  });
  it("insumo/aviamento sem leitura do bucket = sem prévia; sem estoque = []", () => {
    expect(faltasPreview([lin({ familia: "insumo", aviamento_id: null, etiqueta_id: "outra", a_enviar: 9 })], estoque)).toEqual([]);
    expect(faltasPreview([lin({ a_enviar: 9 })], null)).toEqual([]);
    expect(faltasPreview([lin({ familia: "insumo", aviamento_id: null, etiqueta_id: "e1", a_enviar: 3 })], estoque)[0].faltou).toBe(2);
  });

  const R = (n: number, o: Record<string, unknown>) => ({ numero: n, data_saida: null as string | null, aprovacao: null as null | "aprovado" | "reprovado", mini: null as MiniPT | null, ...o });
  const trl = (...ts: ReturnType<typeof R>[]) => [{ mo_linha_id: L1, categoria_nome: "PL", tentativas: ts }];
  const foto = (faltou: number) => ({ rotulo: "Botão", variante: null, unidade: "un" as const, consumo: null, loss_percent: null, necessaria: 1, a_enviar: 1, baixado: 1 - faltou, faltou, fontes: [] });
  it("resumoPosSalvar: baixas, estornos, faltas (da foto) e sem tamanho/cor", () => {
    const antes = trl(R(1, { data_saida: "2026-10-01", mini: pronta() }), R(2, { data_saida: "2026-10-02", mini: pronta({ baixa_em: "2026-10-02T12:00:00Z" }) }), R(3, { data_saida: "2026-10-03", mini: null }));
    const depois = trl(
      R(1, { data_saida: "2026-10-01", mini: pronta({ baixa_em: "2026-10-05T12:00:00Z", linhas: [ajuste("a:1:1", { foto: foto(0.5) })] }) }),
      R(2, { data_saida: null, mini: pronta() }),
      R(3, { data_saida: "2026-10-04", mini: mini({ tamanho: "40|M" }) }),
    );
    expect(resumoPosSalvar(antes, depois)).toEqual({
      baixas: ["PL · tentativa 1"],
      estornos: ["PL · tentativa 2"],
      faltas: ["PL · Botão 0,5 un"],
      semTamanhoCor: ["PL · tentativa 3"],
    });
  });
  it("sem tamanho/cor só avisa quando ESTE Salvar mexeu na tentativa; decidida não avisa; card sem Tecido 1 só exige o tamanho", () => {
    const igual = trl(R(1, { data_saida: "2026-10-01", mini: mini({ tamanho: "40|M" }) }));
    expect(resumoPosSalvar(igual, igual).semTamanhoCor).toEqual([]);
    expect(resumoPosSalvar(igual, igual, { semTecido1: true }).baixas).toEqual([]);
    const decidida = trl(R(1, { data_saida: "2026-10-01", aprovacao: "aprovado", mini: null }));
    expect(resumoPosSalvar([], decidida).semTamanhoCor).toEqual([]);
    expect(resumoPosSalvar([], trl(R(1, { data_saida: "2026-10-01", mini: mini({ tamanho: "40|M" }) })), { semTecido1: true }).semTamanhoCor).toEqual([]);
  });
  it("sem nada novo → tudo vazio", () => {
    const e = trl(R(1, {}));
    expect(resumoPosSalvar(e, e)).toEqual({ baixas: [], estornos: [], faltas: [], semTamanhoCor: [] });
  });
});

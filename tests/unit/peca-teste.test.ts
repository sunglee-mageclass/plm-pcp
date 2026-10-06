// R9 T6 — núcleo PURO da seção Peça Teste (src/lib/peca-teste.ts, parte da T6): tentativa atual virtual, status, reprovar, requisito local,
// payload do Salvar (delta) e merge 3 vias. O requisito (T3) segue coberto por peca-teste-requisito.test.ts.
import { describe, it, expect } from "vitest";
import {
  aplicarCampoDele, aprovar, desfazerDecisao, editarAtual, entradaAntesDaSaida, estadoPTDoServidor, fornecedorMudou, historico, lerPathPT,
  mergePecaTeste, motivoSemDecisao, pathPT, payloadPecaTeste, pecaTesteAprovadaModelo, podeDecidir, ptDirty, reprovar, requisitoLocal,
  statusTrilha, tentativaAtualPT, tentativaVirtual, type EstadoPT, type TentativaPT, type TrilhaPT,
} from "../../src/lib/peca-teste";
import { CASOS_PECA_TESTE, CATEGORIAS_ROTULO, entradaDoCaso } from "../fixtures/peca-teste-casos";

const L1 = "00000000-0000-4000-8000-0000000000a1";
const L2 = "00000000-0000-4000-8000-0000000000a2";
const CAT = "00000000-0000-4000-8000-00000000ca01";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const T1 = "00000000-0000-4000-8000-0000000000b1";
const T2 = "00000000-0000-4000-8000-0000000000b2";

const tent = (numero: number, o: Partial<TentativaPT> = {}): TentativaPT => ({ ...tentativaVirtual(numero), id: `00000000-0000-4000-8000-00000000b${numero}00`.slice(0, 36), rev: 1, ...o });
const trilha = (o: Partial<TrilhaPT> = {}): TrilhaPT => ({
  mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: F1, empresa_nome: "Oficina Um", mo_aprovado: true, tentativas: [], ...o,
});
const estado = (...trilhas: TrilhaPT[]): EstadoPT => ({ trilhas, outros: [] });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("tentativa atual com virtual / histórico / status", () => {
  it("sem nenhuma tentativa: a atual é a virtual nº 1 (sem id, sem datas)", () => {
    const a = tentativaAtualPT(trilha());
    expect(a).toMatchObject({ id: null, numero: 1, data_saida: null, data_entrada: null, aprovacao: null, rev: 0 });
    expect(historico(trilha())).toEqual([]);
  });
  it("última reprovada: a atual é a virtual nº max+1; a reprovada vai para o histórico", () => {
    const t = trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1 })] });
    expect(tentativaAtualPT(t)).toMatchObject({ id: null, numero: 2 });
    expect(historico(t).map((x) => x.numero)).toEqual([1]);
  });
  it("última não reprovada (em teste ou aprovada) é a própria atual", () => {
    const emTeste = trilha({ tentativas: [tent(1, { aprovacao: "reprovado" }), tent(2, { data_saida: "2026-09-22" })] });
    expect(tentativaAtualPT(emTeste).numero).toBe(2);
    expect(tentativaAtualPT(emTeste).id).not.toBeNull();
  });

  it("status nos 4 casos", () => {
    expect(statusTrilha(trilha())).toBe("aguardando_saida");
    expect(statusTrilha(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22" })] }))).toBe("em_teste");
    expect(statusTrilha(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: "aprovado", empresa_id: F1 })] }))).toBe("aprovada");
    expect(statusTrilha(trilha({ tentativas: [tent(1, { data_saida: "2026-09-08", data_entrada: "2026-09-15", aprovacao: "reprovado" })] }))).toBe("reprovada_nova");
    // reprovada e a nova já com saída = em teste
    expect(statusTrilha(trilha({ tentativas: [tent(1, { aprovacao: "reprovado" }), tent(2, { data_saida: "2026-09-22" })] }))).toBe("em_teste");
  });
});

describe("decidir", () => {
  it("podeDecidir exige as 2 datas", () => {
    expect(podeDecidir({ data_saida: null, data_entrada: null })).toBe(false);
    expect(podeDecidir({ data_saida: "2026-09-22", data_entrada: null })).toBe(false);
    expect(podeDecidir({ data_saida: "2026-09-22", data_entrada: "2026-09-29" })).toBe(true);
  });
  it("N1 (sonda do revisor) — 1ª tentativa com as 2 datas e SEM id: a tela NÃO libera a decisão ('nao_salva'); com id libera", () => {
    const t0 = trilha({ tentativas: [] });
    const t = editarAtual(editarAtual(t0, { data_saida: "2026-10-01" }), { data_entrada: "2026-10-03" });
    const at = t.tentativas[0];
    expect(at.id).toBeNull();
    expect(motivoSemDecisao(at, F1, F1)).toBe("nao_salva");
    expect(motivoSemDecisao({ ...at, id: T1 }, F1, F1)).toBeNull();
    // sem as datas a dica continua sendo a das datas
    expect(motivoSemDecisao({ ...at, id: null, data_entrada: null }, F1, F1)).toBe("sem_datas");
  });
  it("motivoSemDecisao: datas primeiro; depois fornecedor salvo (a linha sem fornecedor é recusada no servidor)", () => {
    const ok = { data_saida: "2026-09-22", data_entrada: "2026-09-29" };
    expect(motivoSemDecisao({ data_saida: null, data_entrada: null }, F1, F1)).toBe("sem_datas");
    expect(motivoSemDecisao(ok, null, null)).toBe("sem_fornecedor");
    expect(motivoSemDecisao(ok, null, F1)).toBe("fornecedor_nao_salvo");
    expect(motivoSemDecisao(ok, F1, F2)).toBeNull();
  });
  it("entrada antes da saída é só uma dica (função de apoio, nunca bloqueia)", () => {
    expect(entradaAntesDaSaida({ data_saida: "2026-09-29", data_entrada: "2026-09-22" })).toBe(true);
    expect(entradaAntesDaSaida({ data_saida: "2026-09-22", data_entrada: "2026-09-29" })).toBe(false);
    expect(entradaAntesDaSaida({ data_saida: "2026-09-22", data_entrada: null })).toBe(false);
  });
});

describe("editarAtual / aprovar / desfazer / reprovar", () => {
  it("virtual que ganha dado entra na lista; volta a ficar vazia = sai (nada a gravar)", () => {
    const t0 = trilha();
    const t1 = editarAtual(t0, { data_saida: "2026-09-22" });
    expect(t1.tentativas).toHaveLength(1);
    expect(t1.tentativas[0]).toMatchObject({ id: null, numero: 1, data_saida: "2026-09-22" });
    const t2 = editarAtual(t1, { data_saida: "" });
    expect(t2.tentativas).toHaveLength(0);
  });
  it("tentativa GRAVADA que fica vazia continua na lista (o Salvar a apaga)", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22" })] });
    const v = editarAtual(t, { data_saida: null });
    expect(v.tentativas).toHaveLength(1);
    expect(v.tentativas[0].data_saida).toBeNull();
  });
  it("aprovar congela o fornecedor da linha SALVA; desfazer limpa", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] });
    const a = aprovar(t, { id: F1, nome: "Oficina Um" });
    expect(a.tentativas[0]).toMatchObject({ aprovacao: "aprovado", empresa_id: F1 });
    expect(statusTrilha(a)).toBe("aprovada");
    const d = desfazerDecisao(a);
    expect(d.tentativas[0]).toMatchObject({ aprovacao: null, empresa_id: null });
  });
  it("reprovar congela o fornecedor, vai para o histórico e a virtual seguinte nasce com número N+1 e datas vazias", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] });
    const r = reprovar(t, { id: F1, nome: "Oficina Um" });
    expect(historico(r)).toHaveLength(1);
    expect(historico(r)[0]).toMatchObject({ numero: 1, aprovacao: "reprovado", empresa_id: F1, empresa_nome: "Oficina Um" });
    const prox = tentativaAtualPT(r);
    expect(prox).toMatchObject({ id: null, numero: 2, data_saida: null, data_entrada: null, aprovacao: null });
    expect(statusTrilha(r)).toBe("reprovada_nova");
  });
  it("reprovar uma tentativa NOVA (sem id) e lançar a seguinte no mesmo rascunho: números 1 e 2", () => {
    let t = trilha();
    t = editarAtual(t, { data_saida: "2026-09-08", data_entrada: "2026-09-15" });
    t = reprovar(t, { id: F1, nome: "Oficina Um" });
    t = editarAtual(t, { data_saida: "2026-09-22" });
    expect(t.tentativas.map((x) => [x.numero, x.aprovacao])).toEqual([[1, "reprovado"], [2, null]]);
  });
  it("reprovada é imutável (editar a atual não mexe na reprovada)", () => {
    const t = trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15" })] });
    const e = editarAtual(t, { data_saida: "2026-09-22" });
    expect(e.tentativas.find((x) => x.numero === 1)).toMatchObject({ aprovacao: "reprovado", data_saida: "2026-09-08" });
    expect(e.tentativas.find((x) => x.numero === 2)).toMatchObject({ id: null, data_saida: "2026-09-22" });
  });
});

describe("requisitoLocal", () => {
  it("bate com pecaTesteAprovadaModelo em TODA a fixture compartilhada (e conta N de M)", () => {
    const ids = { F1, F2 };
    const cats = { exige: CAT, sem_switch: "00000000-0000-4000-8000-00000000ca02" };
    for (const caso of CASOS_PECA_TESTE) {
      const linhas = entradaDoCaso(caso, ids, cats);
      const exigindo = linhas.filter((l) => l.exige);
      const trilhas: TrilhaPT[] = exigindo.map((l, i) => trilha({
        mo_linha_id: `00000000-0000-4000-8000-00000000c${i}00`.slice(0, 36), categoria_id: String(l.categoria_id), empresa_id: l.empresa_id, mo_aprovado: l.mo_aprovado,
        // o servidor só devolve na trilha as tentativas do TIPO ATUAL da linha (as do tipo antigo ficam escondidas)
        tentativas: l.tentativas.filter((x) => x.categoria_id === l.categoria_id).map((x) => tent(x.numero, { aprovacao: x.aprovacao, empresa_id: x.empresa_id, id: `00000000-0000-4000-8000-0000${i}${x.numero}00000000`.slice(0, 36) })),
      }));
      const r = requisitoLocal(trilhas, {});
      expect(r.ok, caso.nome).toBe(pecaTesteAprovadaModelo(linhas));
      expect(r.exigem).toBe(exigindo.length);
      expect(r.faltas.length === 0, caso.nome).toBe(r.ok);
    }
    expect(CATEGORIAS_ROTULO.exige).toBeTruthy();
  });

  it("motivos das faltas: peça teste · M.O. pendente · peça teste e M.O.", () => {
    const apr = [tent(1, { aprovacao: "aprovado", empresa_id: F1 })];
    const a = trilha({ mo_linha_id: L1, categoria_nome: "PL", mo_aprovado: true, tentativas: [] });
    const b = trilha({ mo_linha_id: L2, categoria_nome: "Bordado", mo_aprovado: null, tentativas: apr });
    const c = trilha({ mo_linha_id: "00000000-0000-4000-8000-0000000000a3", categoria_nome: "Estampa", mo_aprovado: false, tentativas: [] });
    const r = requisitoLocal([a, b, c], {});
    expect(r.exigem).toBe(3);
    expect(r.aprovadas).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.faltas.map((f) => [f.servico, f.motivo])).toEqual([["PL", "peça teste"], ["Bordado", "M.O. pendente"], ["Estampa", "peça teste e M.O."]]);
  });

  it("fornecedor EFETIVO trocado no rascunho: a aprovada do fornecedor antigo deixa de valer; M.O. reaberta conta como pendente", () => {
    const t = trilha({ mo_aprovado: true, tentativas: [tent(1, { aprovacao: "aprovado", empresa_id: F1 })] });
    expect(requisitoLocal([t], { [L1]: F1 }).ok).toBe(true);
    expect(requisitoLocal([t], { [L1]: F2 }).ok).toBe(false);
    expect(requisitoLocal([t], {}, { [L1]: null }).faltas[0].motivo).toBe("M.O. pendente");
  });

  it("sem trilha nenhuma = cumprido (0 de 0)", () => {
    expect(requisitoLocal([], {})).toEqual({ exigem: 0, aprovadas: 0, ok: true, faltas: [] });
  });
});

describe("payloadPecaTeste / ptDirty (delta)", () => {
  const base = (): EstadoPT => estado(trilha({ tentativas: [tent(1, { id: T1, data_saida: "2026-09-22", rev: 3 })] }));

  it("nada mudou: _trilhas vazio e não está sujo", () => {
    const b = base();
    const p = payloadPecaTeste(clone(b), b);
    expect(p._trilhas).toEqual([]);
    expect(p._rev_base).toEqual({ tentativas: {}, fornecedor: {} });
    expect(ptDirty(clone(b), b)).toBe(false);
  });

  it("só uma data: tentativa com o rev da base, SEM a chave empresa_id e sem _rev_base.fornecedor", () => {
    const b = base();
    const d = clone(b);
    d.trilhas[0] = editarAtual(d.trilhas[0], { data_entrada: "2026-09-29" });
    const p = payloadPecaTeste(d, b);
    expect(p._trilhas).toHaveLength(1);
    expect(p._trilhas[0]).not.toHaveProperty("empresa_id");
    expect(p._trilhas[0].tentativas).toEqual([{ id: T1, numero: 1, data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: null }]);
    expect(p._rev_base.tentativas).toEqual({ [T1]: 3 });
    expect(p._rev_base.fornecedor).toEqual({});
    expect(ptDirty(d, b)).toBe(true);
  });

  it("fornecedor trocado: leva a chave empresa_id e _rev_base.fornecedor[linha] = o da base (ainda sem tentativa mexida)", () => {
    const b = base();
    const d = clone(b);
    d.trilhas[0].empresa_id = F2;
    const p = payloadPecaTeste(d, b);
    expect(p._trilhas).toEqual([{ mo_linha_id: L1, categoria_id: CAT, empresa_id: F2, tentativas: [] }]);
    expect(p._rev_base.fornecedor).toEqual({ [L1]: F1 });
    expect(ptDirty(d, b)).toBe(true);
  });

  it("fornecedor efetivo vindo da M.O. (mapa) vale no lugar do rascunho da seção; igual à base = nada", () => {
    const b = base();
    expect(payloadPecaTeste(clone(b), b, { [L1]: F2 })._trilhas[0].empresa_id).toBe(F2);
    expect(payloadPecaTeste(clone(b), b, { [L1]: F1 })._trilhas).toEqual([]);
    expect(fornecedorMudou({ empresa_id: F2 }, b.trilhas[0])).toBe(true);
    expect(fornecedorMudou({ empresa_id: F1 }, b.trilhas[0])).toBe(false);
  });

  it("tentativa nova (virtual que ganhou dado) vai com id:null e o número; toda DECISÃO leva _rev_base.fornecedor", () => {
    const b = estado(trilha({ tentativas: [tent(1, { id: T1, aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, rev: 2 })] }));
    const d = clone(b);
    d.trilhas[0] = editarAtual(d.trilhas[0], { data_saida: "2026-09-22" });
    let p = payloadPecaTeste(d, b);
    expect(p._trilhas[0].tentativas).toEqual([{ id: null, numero: 2, data_saida: "2026-09-22", data_entrada: null, aprovacao: null }]);
    expect(p._rev_base.fornecedor).toEqual({}); // sem decisão
    d.trilhas[0] = editarAtual(d.trilhas[0], { data_entrada: "2026-09-29" });
    d.trilhas[0] = aprovar(d.trilhas[0], { id: F1, nome: "Oficina Um" });
    p = payloadPecaTeste(d, b);
    expect(p._trilhas[0].tentativas[0]).toMatchObject({ id: null, numero: 2, aprovacao: "aprovado" });
    expect(p._rev_base.fornecedor).toEqual({ [L1]: F1 });
  });

  it("reprovar a atual e lançar a próxima no mesmo Salvar: duas tentativas no payload (a gravada com rev; a nova com id:null)", () => {
    const b = base();
    const d = clone(b);
    d.trilhas[0] = editarAtual(d.trilhas[0], { data_entrada: "2026-09-29" });
    d.trilhas[0] = reprovar(d.trilhas[0], { id: F1, nome: "Oficina Um" });
    d.trilhas[0] = editarAtual(d.trilhas[0], { data_saida: "2026-10-05" });
    const p = payloadPecaTeste(d, b);
    expect(p._trilhas[0].tentativas.map((x) => [x.id, x.numero, x.aprovacao])).toEqual([[T1, 1, "reprovado"], [null, 2, null]]);
    expect(p._rev_base.tentativas).toEqual({ [T1]: 3 });
    expect(p._rev_base.fornecedor).toEqual({ [L1]: F1 });
  });

  it("tentativa GRAVADA que ficou vazia vai com tudo nulo (o servidor apaga)", () => {
    const b = base();
    const d = clone(b);
    d.trilhas[0] = editarAtual(d.trilhas[0], { data_saida: null });
    expect(payloadPecaTeste(d, b)._trilhas[0].tentativas).toEqual([{ id: T1, numero: 1, data_saida: null, data_entrada: null, aprovacao: null }]);
  });

  it("trilha que o servidor não conhece (sem base) não entra", () => {
    const b = estado();
    const d = estado(trilha({ tentativas: [tent(1, { id: null, data_saida: "2026-09-22" })] }));
    expect(payloadPecaTeste(d, b)._trilhas).toEqual([]);
  });
});

describe("mergePecaTeste (3 vias)", () => {
  const b0 = (): EstadoPT => estado(trilha({ tentativas: [tent(1, { id: T1, data_saida: "2026-09-22", rev: 1 })] }));

  it("só EU mudei: o meu fica; o rev vem do servidor", () => {
    const b = b0();
    const meu = clone(b); meu.trilhas[0] = editarAtual(meu.trilhas[0], { data_entrada: "2026-09-29" });
    const dele = clone(b); dele.trilhas[0].tentativas[0].rev = 2;
    const r = mergePecaTeste(b, meu, dele);
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0]).toMatchObject({ data_entrada: "2026-09-29", rev: 2 });
  });

  it("só ELE mudou: adota o dele", () => {
    const b = b0();
    const dele = clone(b); dele.trilhas[0].tentativas[0] = { ...dele.trilhas[0].tentativas[0], data_entrada: "2026-09-30", rev: 2 };
    const r = mergePecaTeste(b, clone(b), dele);
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0].data_entrada).toBe("2026-09-30");
    expect(r.atualizados).toBeGreaterThan(0);
  });

  it("os DOIS mudaram o mesmo campo para o MESMO valor: sem conflito", () => {
    const b = b0();
    const meu = clone(b); meu.trilhas[0] = editarAtual(meu.trilhas[0], { data_entrada: "2026-09-29" });
    const dele = clone(b); dele.trilhas[0].tentativas[0] = { ...dele.trilhas[0].tentativas[0], data_entrada: "2026-09-29", rev: 2 };
    const r = mergePecaTeste(b, meu, dele);
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0]).toMatchObject({ data_entrada: "2026-09-29", rev: 2 });
  });

  it("os DOIS mudaram o mesmo campo para valores DIFERENTES: conflito com path pt:<linha>:<campo>; o meu fica até resolver", () => {
    const b = b0();
    const meu = clone(b); meu.trilhas[0] = editarAtual(meu.trilhas[0], { data_entrada: "2026-09-29" });
    const dele = clone(b); dele.trilhas[0].tentativas[0] = { ...dele.trilhas[0].tentativas[0], data_entrada: "2026-10-02", rev: 2 };
    const r = mergePecaTeste(b, meu, dele);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ path: `pt:${L1}:data_entrada`, meu: "29/09/2026", dele: "02/10/2026" });
    expect(r.valor.trilhas[0].tentativas[0].data_entrada).toBe("2026-09-29");
    // "usar o novo" aplica o do servidor
    const usado = aplicarCampoDele(r.valor, dele, r.conflitos[0].path);
    expect(usado.valor.trilhas[0].tentativas[0].data_entrada).toBe("2026-10-02");
  });

  it("campos diferentes (eu a saída, ele a entrada): une sem conflito", () => {
    const b = estado(trilha({ tentativas: [tent(1, { id: T1, data_saida: "2026-09-22", rev: 1 })] }));
    const meu = clone(b); meu.trilhas[0] = editarAtual(meu.trilhas[0], { data_saida: "2026-09-23" });
    const dele = clone(b); dele.trilhas[0].tentativas[0] = { ...dele.trilhas[0].tentativas[0], data_entrada: "2026-09-29", rev: 2 };
    const r = mergePecaTeste(b, meu, dele);
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0]).toMatchObject({ data_saida: "2026-09-23", data_entrada: "2026-09-29" });
  });

  it("tentativa NOVA dele com o mesmo número que a minha, com dados diferentes = conflito", () => {
    const rep = tent(1, { id: T1, aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, rev: 2 });
    const b = estado(trilha({ tentativas: [rep] }));
    const meu = clone(b); meu.trilhas[0] = editarAtual(meu.trilhas[0], { data_saida: "2026-09-22" });
    const dele = clone(b); dele.trilhas[0].tentativas.push(tent(2, { id: T2, data_saida: "2026-09-25", rev: 0 }));
    const r = mergePecaTeste(b, meu, dele);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].path).toBe(`pt:${L1}:data_saida`);
    // a minha vira a dele (id/rev do servidor) para o próximo Salvar passar no rev
    expect(r.valor.trilhas[0].tentativas.find((x) => x.numero === 2)).toMatchObject({ id: T2, data_saida: "2026-09-22" });
  });

  it("tentativa nova dele e nada meu: adota; tentativa nova minha e nada dele: mantém", () => {
    const rep = tent(1, { id: T1, aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1 });
    const b = estado(trilha({ tentativas: [rep] }));
    const dele = clone(b); dele.trilhas[0].tentativas.push(tent(2, { id: T2, data_saida: "2026-09-25" }));
    expect(mergePecaTeste(b, clone(b), dele).valor.trilhas[0].tentativas.map((x) => x.numero)).toEqual([1, 2]);
    const meu = clone(b); meu.trilhas[0] = editarAtual(meu.trilhas[0], { data_saida: "2026-09-22" });
    const r = mergePecaTeste(b, meu, clone(b));
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas.find((x) => x.numero === 2)).toMatchObject({ id: null, data_saida: "2026-09-22" });
  });

  it("fornecedor: 3 vias; mudado dos 2 lados para valores diferentes = conflito pt:<linha>:fornecedor", () => {
    const b = b0();
    const meu = clone(b); meu.trilhas[0].empresa_id = F2; meu.trilhas[0].empresa_nome = "Oficina Dois";
    const dele = clone(b); dele.trilhas[0].empresa_id = "00000000-0000-4000-8000-0000000000f3"; dele.trilhas[0].empresa_nome = "Oficina Três";
    const r = mergePecaTeste(b, meu, dele);
    expect(r.conflitos).toEqual([{ path: `pt:${L1}:fornecedor`, meu: "Oficina Dois", dele: "Oficina Três" }]);
    expect(r.valor.trilhas[0].empresa_id).toBe(F2);
    const so = mergePecaTeste(b, clone(b), dele);
    expect(so.conflitos).toEqual([]);
    expect(so.valor.trilhas[0].empresa_nome).toBe("Oficina Três");
    const usado = aplicarCampoDele(r.valor, dele, r.conflitos[0].path);
    expect(usado.fornecedor).toEqual({ linhaId: L1, empresaId: "00000000-0000-4000-8000-0000000000f3", empresaNome: "Oficina Três" });
  });

  it("minha DECISÃO vs fornecedor trocado por ele no meio: conflito em aprovacao (quem decidiu confirma)", () => {
    const b = estado(trilha({ tentativas: [tent(1, { id: T1, data_saida: "2026-09-22", data_entrada: "2026-09-29", rev: 1 })] }));
    const meu = clone(b); meu.trilhas[0] = aprovar(meu.trilhas[0], { id: F1, nome: "Oficina Um" });
    const dele = clone(b); dele.trilhas[0].empresa_id = F2; dele.trilhas[0].empresa_nome = "Oficina Dois"; dele.trilhas[0].tentativas[0].rev = 2;
    const r = mergePecaTeste(b, meu, dele);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ path: `pt:${L1}:aprovacao`, meu: "Aprovado" });
    expect(String(r.conflitos[0].dele)).toContain("Oficina Dois");
    expect(r.valor.trilhas[0].tentativas[0].aprovacao).toBe("aprovado");
    // "usar o novo" descarta a decisão
    expect(aplicarCampoDele(r.valor, dele, r.conflitos[0].path).valor.trilhas[0].tentativas[0].aprovacao).toBeNull();
  });

  it("trilha que só existe do lado dele entra; a que sumiu do servidor sai; 'outros' vem dele", () => {
    const b = b0();
    const dele: EstadoPT = { trilhas: [...clone(b).trilhas, trilha({ mo_linha_id: L2, categoria_nome: "Bordado" })], outros: [{ categoria_nome: "Lavanderia", empresa_nome: "Lava Tudo" }] };
    const r = mergePecaTeste(b, clone(b), dele);
    expect(r.valor.trilhas.map((x) => x.mo_linha_id)).toEqual([L1, L2]);
    expect(r.valor.outros).toHaveLength(1);
    expect(mergePecaTeste(b, clone(b), estado()).valor.trilhas).toEqual([]);
  });

  it("ele apagou a tentativa (voltou a virtual): sem edição minha some; com edição minha sobrevive como NOVA", () => {
    const b = b0();
    const dele = estado(trilha({ tentativas: [] }));
    expect(mergePecaTeste(b, clone(b), dele).valor.trilhas[0].tentativas).toEqual([]);
    const meu = clone(b); meu.trilhas[0] = editarAtual(meu.trilhas[0], { data_entrada: "2026-09-29" });
    const r = mergePecaTeste(b, meu, dele);
    expect(r.valor.trilhas[0].tentativas[0]).toMatchObject({ id: null, numero: 1, data_entrada: "2026-09-29" });
  });
});

describe("path e leitura do servidor", () => {
  it("pathPT/lerPathPT ida e volta", () => {
    expect(pathPT(L1, "fornecedor")).toBe(`pt:${L1}:fornecedor`);
    expect(lerPathPT(pathPT(L1, "data_saida"))).toEqual({ linha: L1, campo: "data_saida", numero: null });
    expect(lerPathPT(pathPT(L1, "aprovacao", 3))).toEqual({ linha: L1, campo: "aprovacao", numero: 3 });
    expect(lerPathPT("secao:bom")).toBeNull();
  });
  it("estadoPTDoServidor lê o jsonb da RPC (ordena por número, datas vazias viram null) e tolera null", () => {
    expect(estadoPTDoServidor(null)).toBeNull();
    const e = estadoPTDoServidor({
      trilhas: [{ mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: F1, empresa_nome: "X", mo_aprovado: true, aprovada: false,
        tentativas: [{ id: T2, numero: 2, data_saida: "", aprovacao: null, rev: 0 }, { id: T1, numero: 1, data_saida: "2026-09-08", aprovacao: "reprovado", rev: 4, empresa_id: F1 }] }],
      outros: [{ categoria_nome: "Lavanderia", empresa_nome: "Lava Tudo" }],
    });
    expect(e?.trilhas[0].tentativas.map((x) => x.numero)).toEqual([1, 2]);
    expect(e?.trilhas[0].tentativas[1].data_saida).toBeNull();
    expect(e?.outros).toEqual([{ categoria_nome: "Lavanderia", empresa_nome: "Lava Tudo" }]);
  });
});

// ───────── fix round 1 (revisão T6) ─────────
describe("achado 1 — trilha = (linha, TIPO): nada do tipo antigo migra para o tipo novo", () => {
  const CAT_B = "00000000-0000-4000-8000-00000000ca02";
  const decidida = (cat: string) => trilha({
    categoria_id: cat, tentativas: [{ ...tentativaVirtual(1), data_saida: "2026-10-01", data_entrada: "2026-10-03", aprovacao: "aprovado", empresa_id: F1, empresa_nome: "Oficina Um" }],
  });

  it("(sonda do revisor) o servidor devolve a linha com OUTRO tipo (trocado por mim ou por outra pessoa): vale a trilha dele, sem as minhas tentativas e sem aprovação herdada", () => {
    const base = estado(trilha({ categoria_id: CAT }));
    const meu = estado(decidida(CAT));
    const dele = estado(trilha({ categoria_id: CAT_B, categoria_nome: "Bordado" }));
    const m = mergePecaTeste(base, meu, dele);
    expect(m.conflitos).toEqual([]);
    expect(m.valor.trilhas[0]).toMatchObject({ categoria_id: CAT_B, categoria_nome: "Bordado", tentativas: [] });
    // o payload do retry não leva nada
    expect(payloadPecaTeste(m.valor, dele)._trilhas).toEqual([]);
  });

  it("payloadPecaTeste: cada trilha leva categoria_id; trilha cujo tipo difere da base não entra; `ignorar` tira a linha (datas, decisão e fornecedor)", () => {
    const base = estado(trilha({ categoria_id: CAT }));
    const draft = estado({ ...decidida(CAT), empresa_id: F2, empresa_nome: "Oficina Dois" });
    const p = payloadPecaTeste(draft, base);
    expect(p._trilhas[0].categoria_id).toBe(CAT);
    expect(payloadPecaTeste(draft, base, undefined, new Set([L1]))._trilhas).toEqual([]);
    expect(ptDirty(draft, base, undefined, new Set([L1]))).toBe(false);
    const outroTipo = estado({ ...decidida(CAT_B), categoria_id: CAT_B });
    expect(payloadPecaTeste(outroTipo, base)._trilhas).toEqual([]);
  });
});

describe("achado 3 — a troca de fornecedor é MINHA (via editor da M.O.): minha decisão não vira conflito falso", () => {
  it("(sonda do revisor) base E1; eu troquei para E2 e reprovei; o servidor já tem E2 (meu Salvar da M.O.): sem conflito", () => {
    const t1 = { ...tentativaVirtual(1), id: T1, data_saida: "2026-10-01", data_entrada: "2026-10-03", rev: 2 };
    const base = estado(trilha({ empresa_id: F1, empresa_nome: "F1", tentativas: [t1] }));
    const meu = estado(trilha({ empresa_id: F2, empresa_nome: "F2", tentativas: [{ ...t1, aprovacao: "reprovado", empresa_id: F1, empresa_nome: "F1" }] }));
    const dele = estado(trilha({ empresa_id: F2, empresa_nome: "F2", mo_aprovado: null, tentativas: [{ ...t1 }] }));
    expect(mergePecaTeste(base, meu, dele).conflitos).toEqual([]);
  });
  it("já a troca DELE continua gerando o conflito (outro fornecedor, que eu não vi)", () => {
    const t1 = { ...tentativaVirtual(1), id: T1, data_saida: "2026-10-01", data_entrada: "2026-10-03", rev: 2 };
    const base = estado(trilha({ empresa_id: F1, tentativas: [t1] }));
    const meu = estado(trilha({ empresa_id: F1, tentativas: [{ ...t1, aprovacao: "reprovado", empresa_id: F1 }] }));
    const dele = estado(trilha({ empresa_id: F2, empresa_nome: "F2", tentativas: [{ ...t1 }] }));
    expect(mergePecaTeste(base, meu, dele).conflitos).toHaveLength(1);
  });
});

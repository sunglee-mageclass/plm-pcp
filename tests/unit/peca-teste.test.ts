import { describe, it, expect } from "vitest";
import {
  adicionarTrilha, aprovar, corrigirTentativa, desfazerDecisao, editarAtual, entradaAntesDaSaida, estadoPTDoServidor, estornosPendentes,
  excluirTentativa, historico, lerPathPT, mergePecaTeste, motivoBloqueioMudarDecisao, motivoSemDecisao, mudarDecisaoTentativa, pathPT,
  payloadPecaTeste, podeDecidir, ptDirty, reprovar, requisitoDoEstado, rotuloTentativa, statusTrilha, tentativaAtualPT, tentativaVirtual,
  vezComFornecedor, type EstadoPT, type TentativaPT, type TrilhaPT,
} from "../../src/lib/peca-teste";

const CAT = "00000000-0000-4000-8000-00000000ca01";
const CAT2 = "00000000-0000-4000-8000-00000000ca02";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const FORNS = [{ id: F1, nome_fantasia: "Oficina Um" }, { id: F2, nome_fantasia: "Oficina Dois" }];
const D1 = "2026-10-01", D2 = "2026-10-03";

const tent = (numero: number, o: Partial<TentativaPT> = {}): TentativaPT => ({ ...tentativaVirtual(numero), id: `t-${numero}`, rev: 1, ...o });
const trilha = (o: Partial<TrilhaPT> = {}): TrilhaPT => ({
  categoria_id: CAT, categoria_nome: "PL", tem_mo: true, mo_aprovado: true, fornecedores: FORNS, tentativas: [], excluidas: [], ...o,
});
const estado = (...t: TrilhaPT[]): EstadoPT => ({ trilhas: t, outros: [], tipos_adicionar: [] });
const rep = (n: number, f = F1, nome = "Oficina Um"): TentativaPT => tent(n, { data_saida: D1, data_entrada: D2, aprovacao: "reprovado", empresa_id: f, empresa_nome: nome });

describe("tentativa atual com virtual / histórico / status", () => {
  it("sem nenhuma tentativa: a atual é a virtual nº 1", () => {
    const at = tentativaAtualPT(trilha());
    expect(at).toMatchObject({ id: null, numero: 1, empresa_id: null });
  });
  it("última reprovada: a atual é a virtual nº max+1 SEM fornecedor; a reprovada vai para o histórico", () => {
    const t = trilha({ tentativas: [rep(1)] });
    expect(tentativaAtualPT(t)).toMatchObject({ id: null, numero: 2, empresa_id: null });
    expect(historico(t).map((x) => x.numero)).toEqual([1]);
  });
  it("status nos 4 casos", () => {
    expect(statusTrilha(trilha())).toBe("aguardando_saida");
    expect(statusTrilha(trilha({ tentativas: [tent(1, { data_saida: D1 })] }))).toBe("em_teste");
    expect(statusTrilha(trilha({ tentativas: [tent(1, { data_saida: D1, data_entrada: D2, aprovacao: "aprovado", empresa_id: F1 })] }))).toBe("aprovada");
    expect(statusTrilha(trilha({ tentativas: [rep(1)] }))).toBe("reprovada_nova");
  });
});

describe("os 2 contadores", () => {
  it("2º contador derivado: quantas anteriores do tipo usaram o MESMO fornecedor + 1", () => {
    const ts = [rep(1, F1), rep(2, F2, "Oficina Dois"), tent(3, { empresa_id: F1, empresa_nome: "Oficina Um" })];
    expect(vezComFornecedor(ts, 1)).toBe(1);
    expect(vezComFornecedor(ts, 2)).toBe(1);
    expect(vezComFornecedor(ts, 3)).toBe(2);
  });
  it("tentativa sem fornecedor (ou inexistente) não tem 2º contador", () => {
    expect(vezComFornecedor([tent(1)], 1)).toBeNull();
    expect(vezComFornecedor([], 5)).toBeNull();
  });
  it("rótulo: 'PL — Tentativa 3 (2ª com Oficina Um)'; sem fornecedor só a 1ª parte", () => {
    expect(rotuloTentativa({ categoria_nome: "PL", numero: 3, fornecedor_nome: "Oficina Um", vez: 2 })).toBe("PL — Tentativa 3 (2ª com Oficina Um)");
    expect(rotuloTentativa({ categoria_nome: "PL", numero: 1, fornecedor_nome: null, vez: null })).toBe("PL — Tentativa 1");
  });
  it("excluir a do meio recalcula o 2º contador (derivado): 1=F1, 2=F2, 3=F1 → sem a 2, a 3 vira a 2ª com F1 (nº 2) ainda 2ª vez", () => {
    const t = excluirTentativa(trilha({ tentativas: [rep(1, F1), rep(2, F2, "Oficina Dois"), tent(3, { empresa_id: F1, empresa_nome: "Oficina Um" })] }), 2);
    expect(t.tentativas.map((x) => [x.numero, x.empresa_id])).toEqual([[1, F1], [2, F1]]);
    expect(vezComFornecedor(t.tentativas, 2)).toBe(2);
  });
});

describe("decidir", () => {
  it("podeDecidir exige as 2 datas", () => {
    expect(podeDecidir({ data_saida: D1, data_entrada: null })).toBe(false);
    expect(podeDecidir({ data_saida: D1, data_entrada: D2 })).toBe(true);
  });
  it("motivoSemDecisao: datas → não salva (id nulo) → sem fornecedor → null", () => {
    expect(motivoSemDecisao({ id: "x", data_saida: D1, data_entrada: null, empresa_id: F1 })).toBe("sem_datas");
    expect(motivoSemDecisao({ id: null, data_saida: D1, data_entrada: D2, empresa_id: F1 })).toBe("nao_salva");
    expect(motivoSemDecisao({ id: "x", data_saida: D1, data_entrada: D2, empresa_id: null })).toBe("sem_fornecedor");
    expect(motivoSemDecisao({ id: "x", data_saida: D1, data_entrada: D2, empresa_id: F1 })).toBeNull();
  });
  it("entrada antes da saída é só uma dica", () => expect(entradaAntesDaSaida({ data_saida: D2, data_entrada: D1 })).toBe(true));
});

describe("editarAtual / aprovar / desfazer / reprovar", () => {
  it("virtual que ganha dado (inclusive só o fornecedor) entra na lista; volta a ficar vazia = sai", () => {
    const t1 = editarAtual(trilha(), { empresa_id: F1, empresa_nome: "Oficina Um" });
    expect(t1.tentativas).toHaveLength(1);
    expect(t1.tentativas[0]).toMatchObject({ id: null, numero: 1, empresa_id: F1 });
    expect(editarAtual(t1, { empresa_id: null, empresa_nome: null }).tentativas).toHaveLength(0);
  });
  it("aprovar mantém o fornecedor da tentativa; desfazer NÃO limpa o fornecedor", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: D1, data_entrada: D2, empresa_id: F1, empresa_nome: "Oficina Um" })] });
    const a = aprovar(t);
    expect(a.tentativas[0]).toMatchObject({ aprovacao: "aprovado", empresa_id: F1 });
    expect(desfazerDecisao(a).tentativas[0]).toMatchObject({ aprovacao: null, empresa_id: F1 });
  });
  it("reprovar vai para o histórico (com o fornecedor dela) e a seguinte nasce SEM fornecedor, número N+1", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: D1, data_entrada: D2, empresa_id: F1, empresa_nome: "Oficina Um" })] });
    const r = reprovar(t);
    expect(r.tentativas[0]).toMatchObject({ aprovacao: "reprovado", empresa_id: F1 });
    expect(tentativaAtualPT(r)).toMatchObject({ numero: 2, id: null, empresa_id: null });
  });
  it("reprovada não é editada pela atual", () => {
    const t = trilha({ tentativas: [rep(1)] });
    expect(editarAtual(t, { data_saida: "2026-11-01" }).tentativas[0].data_saida).toBe(D1);
  });
});

describe("histórico editável (A3)", () => {
  it("corrigirTentativa muda datas/fornecedor da reprovada SEM mudar a decisão; em outra decisão não faz nada", () => {
    const t = trilha({ tentativas: [rep(1), tent(2, { data_saida: D1, data_entrada: D2, aprovacao: "aprovado", empresa_id: F1 })] });
    const c = corrigirTentativa(t, 1, { data_saida: "2026-09-30", empresa_id: F2, empresa_nome: "Oficina Dois" });
    expect(c.tentativas[0]).toMatchObject({ aprovacao: "reprovado", data_saida: "2026-09-30", empresa_id: F2 });
    expect(corrigirTentativa(t, 2, { data_saida: "2026-09-30" }).tentativas[1].data_saida).toBe(D1);
  });
  it("(Review) aprovar a tentativa do MEIO com posteriores BLOQUEIA; reabrir a do meio também; reprovar nunca bloqueia", () => {
    const t = trilha({ tentativas: [rep(1), rep(2), tent(3, { data_saida: D1 })] });
    expect(motivoBloqueioMudarDecisao(t, 1, "aprovado")).toBe("aprovar_meio");
    expect(motivoBloqueioMudarDecisao(t, 1, null)).toBe("reabrir_meio");
    expect(motivoBloqueioMudarDecisao(t, 1, "reprovado")).toBeNull();
    expect(mudarDecisaoTentativa(t, 1, "aprovado")).toBe(t);
  });
  it("a ÚLTIMA reprovada pode ser aprovada ou reaberta (sem posteriores)", () => {
    const t = trilha({ tentativas: [rep(1), rep(2)] });
    expect(motivoBloqueioMudarDecisao(t, 2, "aprovado")).toBeNull();
    expect(mudarDecisaoTentativa(t, 2, null).tentativas[1].aprovacao).toBeNull();
  });
  it("(Review) excluir a tentativa 2 de 3: renumera as seguintes e registra a gravada em `excluidas`; a local sem id some sem registrar", () => {
    const t = trilha({ tentativas: [rep(1), rep(2), tent(3, { data_saida: D1 })] });
    const e = excluirTentativa(t, 2);
    expect(e.tentativas.map((x) => [x.id, x.numero])).toEqual([["t-1", 1], ["t-3", 2]]);
    expect(e.excluidas.map((x) => x.id)).toEqual(["t-2"]);
    const local = trilha({ tentativas: [rep(1), { ...tentativaVirtual(2), data_saida: D1 }] });
    const el = excluirTentativa(local, 2);
    expect(el.tentativas).toHaveLength(1);
    expect(el.excluidas).toHaveLength(0);
  });
});

describe("adicionarTrilha", () => {
  it("acrescenta a trilha do tipo escolhido (vazia, sem M.O.) e o tira de tipos_adicionar; tipo desconhecido/repetido = nada", () => {
    const e: EstadoPT = { trilhas: [trilha()], outros: [], tipos_adicionar: [{ categoria_id: CAT2, categoria_nome: "Bordado", fornecedores: [FORNS[0]] }] };
    const r = adicionarTrilha(e, CAT2);
    expect(r.trilhas.map((t) => t.categoria_id)).toEqual([CAT, CAT2]);
    expect(r.trilhas[1]).toMatchObject({ tem_mo: false, fornecedores: [FORNS[0]], tentativas: [] });
    expect(r.tipos_adicionar).toEqual([]);
    expect(adicionarTrilha(e, "zzz")).toBe(e);
    expect(adicionarTrilha(r, CAT2)).toBe(r);
  });
});

describe("requisitoDoEstado", () => {
  it("conta só trilhas com M.O. (tem_mo); N de M; faltas com motivo", () => {
    const e = estado(
      trilha({ tentativas: [tent(1, { data_saida: D1, data_entrada: D2, aprovacao: "aprovado", empresa_id: F1 })] }),
      trilha({ categoria_id: CAT2, categoria_nome: "Bordado", mo_aprovado: null }),
      trilha({ categoria_id: "cat3", categoria_nome: "Manual", tem_mo: false }),
    );
    const r = requisitoDoEstado(e);
    expect(r).toMatchObject({ exigem: 2, aprovadas: 1, ok: false });
    expect(r.faltas).toEqual([{ categoria_id: CAT2, servico: "Bordado", motivo: "peça teste e M.O." }]);
  });
  it("sem trilha = cumprido (0 de 0)", () => expect(requisitoDoEstado(estado())).toMatchObject({ exigem: 0, aprovadas: 0, ok: true }));
});

describe("payloadPecaTeste / ptDirty / estornosPendentes (delta)", () => {
  const base = () => estado(trilha({ tentativas: [tent(1, { data_saida: D1, empresa_id: F1, empresa_nome: "Oficina Um", rev: 4 })] }));
  it("nada mudou: _trilhas vazio e não está sujo", () => {
    expect(payloadPecaTeste(base(), base())._trilhas).toEqual([]);
    expect(ptDirty(base(), base())).toBe(false);
  });
  it("só uma data: a tentativa com o rev da base e o empresa_id dela; sem _rev_base.fornecedor", () => {
    const d = estado(trilha({ tentativas: [{ ...base().trilhas[0].tentativas[0], data_entrada: D2 }] }));
    const p = payloadPecaTeste(d, base());
    expect(p._trilhas).toEqual([{ categoria_id: CAT, tentativas: [{ id: "t-1", numero: 1, empresa_id: F1, data_saida: D1, data_entrada: D2, aprovacao: null }] }]);
    expect(p._rev_base).toEqual({ tentativas: { "t-1": 4 } });
  });
  it("trocar SÓ o fornecedor da tentativa já é mudança (vai com rev)", () => {
    const d = estado(trilha({ tentativas: [{ ...base().trilhas[0].tentativas[0], empresa_id: F2, empresa_nome: "Oficina Dois" }] }));
    expect(payloadPecaTeste(d, base())._trilhas[0].tentativas[0].empresa_id).toBe(F2);
    expect(ptDirty(d, base())).toBe(true);
  });
  it("tentativa nova (virtual que ganhou dado) vai com id:null e o número; reprovar + próxima no mesmo Salvar = 2 tentativas", () => {
    let t = base().trilhas[0];
    t = editarAtual(t, { data_entrada: D2 });
    t = reprovar(t);
    t = editarAtual(t, { empresa_id: F2, empresa_nome: "Oficina Dois", data_saida: "2026-10-10" });
    const p = payloadPecaTeste(estado(t), base());
    expect(p._trilhas[0].tentativas.map((x) => [x.id, x.numero, x.aprovacao, x.empresa_id])).toEqual([["t-1", 1, "reprovado", F1], [null, 2, null, F2]]);
    expect(Object.keys(p._rev_base.tentativas)).toEqual(["t-1"]);
  });
  it("trilha adicionada à mão (sem base) entra quando ganha dado", () => {
    const e = adicionarTrilha({ trilhas: [], outros: [], tipos_adicionar: [{ categoria_id: CAT2, categoria_nome: "Bordado", fornecedores: FORNS }] }, CAT2);
    const t = editarAtual(e.trilhas[0], { data_saida: D1 });
    const p = payloadPecaTeste({ ...e, trilhas: [t] }, { trilhas: [], outros: [], tipos_adicionar: [] });
    expect(p._trilhas).toEqual([{ categoria_id: CAT2, tentativas: [{ id: null, numero: 1, empresa_id: null, data_saida: D1, data_entrada: null, aprovacao: null }] }]);
  });
  it("(Review) exclusão: vai em `excluir` com o rev da base; as seguintes renumeradas NÃO entram (mesmos dados, só o número mudou)", () => {
    const b = estado(trilha({ tentativas: [rep(1), { ...rep(2, F2, "Oficina Dois"), rev: 7 }, tent(3, { data_saida: D1, empresa_id: F1, rev: 2 })] }));
    const d = estado(excluirTentativa(b.trilhas[0], 2));
    const p = payloadPecaTeste(d, b);
    expect(p._trilhas).toEqual([{ categoria_id: CAT, excluir: ["t-2"], tentativas: [] }]);
    expect(p._rev_base.tentativas).toEqual({ "t-2": 7 });
    expect(ptDirty(d, b)).toBe(true);
  });
  it("(Review) excluir tentativa com baixa ativa vira estorno pendente (com o nº da BASE)", () => {
    const comBaixa = { ...rep(2, F2, "Oficina Dois"), mini: { tamanho: "M", variante_tecido_id: null, mesma_oc: true, baixa_em: "2026-10-02T10:00:00Z", baixa_por_nome: null, tem_historico: true, linhas: [] } as any };
    const b = estado(trilha({ tentativas: [rep(1), comBaixa, tent(3, { data_saida: D1, empresa_id: F1 })] }));
    const d = estado(excluirTentativa(b.trilhas[0], 2));
    expect(estornosPendentes(d, b)).toEqual([{ categoria_id: CAT, servico: "PL", numero: 2, refaz: false }]);
  });
  it("corrigir a reprovada do histórico (data + fornecedor) gera a tentativa com o rev, decisão mantida", () => {
    const b = estado(trilha({ tentativas: [{ ...rep(1), rev: 3 }, tent(2, { data_saida: D1, empresa_id: F1 })] }));
    const d = estado(corrigirTentativa(b.trilhas[0], 1, { data_saida: "2026-09-30", empresa_id: F2, empresa_nome: "Oficina Dois" }));
    const p = payloadPecaTeste(d, b);
    expect(p._trilhas[0].tentativas).toEqual([{ id: "t-1", numero: 1, empresa_id: F2, data_saida: "2026-09-30", data_entrada: D2, aprovacao: "reprovado" }]);
    expect(p._rev_base.tentativas).toEqual({ "t-1": 3 });
  });
});

describe("mergePecaTeste (3 vias, por id)", () => {
  const um = (o: Partial<TentativaPT> = {}) => estado(trilha({ tentativas: [tent(1, { data_saida: D1, empresa_id: F1, empresa_nome: "Oficina Um", ...o })] }));
  it("só EU mudei: o meu fica; o rev vem do servidor", () => {
    const base = um();
    const meu = um({ data_entrada: D2 });
    const dele = um({ rev: 2 });
    const r = mergePecaTeste(base, meu, dele);
    expect(r.conflitos).toEqual([]);
    expect(r.valor.trilhas[0].tentativas[0]).toMatchObject({ data_entrada: D2, rev: 2 });
  });
  it("só ELE mudou: adota o dele", () => {
    const r = mergePecaTeste(um(), um(), um({ data_entrada: D2, rev: 2 }));
    expect(r.valor.trilhas[0].tentativas[0].data_entrada).toBe(D2);
    expect(r.atualizados).toBe(1);
  });
  it("os DOIS mudaram o mesmo campo para valores DIFERENTES: conflito pt:<tipo>:<campo>; o meu fica", () => {
    const r = mergePecaTeste(um(), um({ data_entrada: D2 }), um({ data_entrada: "2026-10-09", rev: 2 }));
    expect(r.conflitos.map((c) => c.path)).toEqual([pathPT(CAT, "data_entrada")]);
    expect(r.valor.trilhas[0].tentativas[0].data_entrada).toBe(D2);
  });
  it("fornecedor da tentativa: 3 vias; dos 2 lados diferentes = conflito pt:<tipo>:empresa_id com os NOMES", () => {
    const r = mergePecaTeste(um(), um({ empresa_id: F2, empresa_nome: "Oficina Dois" }), um({ empresa_id: "f3", empresa_nome: "Oficina Três", rev: 2 }));
    expect(r.conflitos).toEqual([{ path: pathPT(CAT, "empresa_id"), meu: "Oficina Dois", dele: "Oficina Três" }]);
  });
  it("minha DECISÃO vs fornecedor trocado por ele no meio: conflito em aprovacao (quem decidiu confirma)", () => {
    const base = um({ data_entrada: D2 });
    const meu = um({ data_entrada: D2, aprovacao: "aprovado" });
    const dele = um({ data_entrada: D2, empresa_id: F2, empresa_nome: "Oficina Dois", rev: 2 });
    const r = mergePecaTeste(base, meu, dele);
    expect(r.conflitos).toEqual([{ path: pathPT(CAT, "aprovacao"), meu: "Aprovado", dele: "fornecedor passou a ser Oficina Dois" }]);
  });
  it("tentativa NOVA dele (com id) e nada meu: adota; trilha só dele entra", () => {
    const base = estado(trilha({ tentativas: [rep(1)] }));
    const dele = estado(trilha({ tentativas: [rep(1), tent(2, { id: "t-2n", data_saida: D1 })] }), trilha({ categoria_id: CAT2, categoria_nome: "Bordado" }));
    const r = mergePecaTeste(base, base, dele);
    expect(r.valor.trilhas).toHaveLength(2);
    expect(r.valor.trilhas[0].tentativas.map((x) => x.id)).toEqual(["t-1", "t-2n"]);
  });
  it("tentativa nova MINHA (sem id) e a dele do mesmo número com dados diferentes = conflito; do mesmo valor = une", () => {
    const base = estado(trilha({ tentativas: [rep(1)] }));
    const meu = estado(trilha({ tentativas: [rep(1), { ...tentativaVirtual(2), data_saida: D1 }] }));
    const dele = estado(trilha({ tentativas: [rep(1), tent(2, { id: "t-2n", data_saida: "2026-10-09" })] }));
    const r = mergePecaTeste(base, meu, dele);
    expect(r.conflitos.map((c) => c.path)).toEqual([pathPT(CAT, "data_saida")]);
    expect(r.valor.trilhas[0].tentativas[1].id).toBe("t-2n");
  });
  it("ele apagou a tentativa: sem edição minha some (aviso); com edição minha sobrevive como NOVA", () => {
    const base = estado(trilha({ tentativas: [rep(1), tent(2, { data_saida: D1 })] }));
    const dele = estado(trilha({ tentativas: [rep(1)] }));
    const semEdicao = mergePecaTeste(base, base, dele);
    expect(semEdicao.valor.trilhas[0].tentativas).toHaveLength(1);
    expect(semEdicao.avisos[0]).toMatch(/tentativa 2 de PL foi excluída por outra pessoa/);
    const meu = estado(trilha({ tentativas: [rep(1), tent(2, { data_saida: D1, data_entrada: D2 })] }));
    const comEdicao = mergePecaTeste(base, meu, dele);
    expect(comEdicao.valor.trilhas[0].tentativas[1]).toMatchObject({ id: null, data_entrada: D2, numero: 2 });
  });
  it("(Review) minha EXCLUSÃO segue valendo e renumera; se ele ALTEROU a excluída = conflito `excluir`", () => {
    const base = estado(trilha({ tentativas: [rep(1), rep(2, F2, "Oficina Dois"), tent(3, { data_saida: D1 })] }));
    const meu = estado(excluirTentativa(base.trilhas[0], 2));
    const sem = mergePecaTeste(base, meu, base);
    expect(sem.conflitos).toEqual([]);
    expect(sem.valor.trilhas[0].tentativas.map((x) => [x.id, x.numero])).toEqual([["t-1", 1], ["t-3", 2]]);
    expect(sem.valor.trilhas[0].excluidas.map((x) => x.id)).toEqual(["t-2"]);
    const dele = estado(trilha({ tentativas: [rep(1), { ...rep(2, F2, "Oficina Dois"), rev: 2, data_saida: "2026-10-09" }, tent(3, { data_saida: D1 })] }));
    const com = mergePecaTeste(base, meu, dele);
    expect(com.conflitos.map((c) => c.path)).toEqual([pathPT(CAT, "excluir", 2)]);
  });
});

describe("path e leitura do servidor", () => {
  it("pathPT/lerPathPT ida e volta", () => {
    expect(lerPathPT(pathPT(CAT, "data_saida"))).toEqual({ categoria: CAT, campo: "data_saida", numero: null });
    expect(lerPathPT(pathPT(CAT, "mini", 2))).toEqual({ categoria: CAT, campo: "mini", numero: 2 });
    expect(lerPathPT("zzz")).toBeNull();
  });
  it("estadoPTDoServidor lê o jsonb novo (fornecedores, tem_mo, tipos_adicionar), ordena por número e tolera null", () => {
    expect(estadoPTDoServidor(null)).toBeNull();
    const e = estadoPTDoServidor({
      trilhas: [{ categoria_id: CAT, categoria_nome: "PL", tem_mo: true, mo_aprovado: false, fornecedores: [{ id: F1, nome_fantasia: "Oficina Um" }],
        tentativas: [{ id: "b", numero: 2, empresa_id: F1, empresa_nome: "Oficina Um", data_saida: D1, data_entrada: "", aprovacao: null, rev: 1, mini: null },
                     { id: "a", numero: 1, empresa_id: null, empresa_nome: null, data_saida: null, data_entrada: null, aprovacao: "reprovado", rev: 0, mini: null }] }],
      outros: [{ categoria_nome: "Corte", empresa_nome: null }],
      tipos_adicionar: [{ categoria_id: CAT2, categoria_nome: "Bordado", fornecedores: [] }],
    })!;
    expect(e.trilhas[0]).toMatchObject({ tem_mo: true, mo_aprovado: false, excluidas: [] });
    expect(e.trilhas[0].tentativas.map((t) => t.numero)).toEqual([1, 2]);
    expect(e.trilhas[0].tentativas[1].data_entrada).toBeNull();
    expect(e.tipos_adicionar).toEqual([{ categoria_id: CAT2, categoria_nome: "Bordado", fornecedores: [] }]);
  });
});

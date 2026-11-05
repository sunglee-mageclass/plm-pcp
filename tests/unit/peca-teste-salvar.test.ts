// @vitest-environment happy-dom
// R9 T6 — o Salvar do card com a etapa da Peça Teste (usePlanejamentoSave + usePecaTeste REAIS, supabase mockado):
//   (Salvar único, nov/2026: M.O./BOM/#Erro/cabeçalho são UMA RPC `salvar_card_planejamento`) (a) a etapa roda DEPOIS do núcleo (que inclui a M.O.); (b) P0409 sem conflito = 2ª chamada com o rev novo e o resto do
//   card salvo 1x; (c) P0409 com conflito = não lança, devolve o conflito, o "não salvo" da seção NÃO some; (d) só-Peça-Teste não toca o resto do
//   card; (e) troca de fornecedor com a M.O. editável: M.O. E Peça Teste levam o empresa_id; (f) sem a seção o Salvar é idêntico ao de antes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const L1 = "00000000-0000-4000-8000-0000000000a1";
const CAT = "00000000-0000-4000-8000-00000000ca01";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const T1 = "00000000-0000-4000-8000-0000000000b1";

type Chamada = { evento: string; args?: any };
const h = vi.hoisted(() => ({
  log: [] as { evento: string; args?: any }[],
  // respostas de `salvar_peca_teste`, na ordem das chamadas (default: sucesso)
  respostasSalvarPT: [] as ({ code?: string; message: string } | null)[],
  // o que `peca_teste_modelo` devolve (muda entre chamadas para simular o outro usuário)
  lerPT: { atual: null as any },
  // `revisao_marcada` que a RPC do núcleo devolve (etapas com #Erro)
  revisao: { atual: {} as Record<string, unknown> },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true, canEdit: () => true }) }));
vi.mock("@/integrations/supabase/client", () => {
  const rpc = (nome: string, args: any) => {
    h.log.push({ evento: `rpc:${nome}`, args });
    if (nome === "peca_teste_modelo") return Promise.resolve({ data: h.lerPT.atual, error: null });
    if (nome === "salvar_peca_teste") {
      const r = h.respostasSalvarPT.length > 0 ? h.respostasSalvarPT.shift()! : null;
      return Promise.resolve({ data: null, error: r });
    }
    if (nome === "marcar_revisao_por_mudanca") return Promise.resolve({ data: {}, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  const from = (tabela: string) => {
    const q: any = {
      update: (payload: any) => { h.log.push({ evento: `update:${tabela}`, args: payload }); return q; },
      select: () => q, eq: () => q, single: () => Promise.resolve({ data: { rev: 3 }, error: null }),
      then: (ok: any, ko: any) => Promise.resolve({ data: [{ id: "m1" }], error: null }).then(ok, ko),
    };
    return q;
  };
  return { supabase: { rpc, from } };
});
vi.mock("@/components/planejamento/planejamento-detail/ficha/persistir-bom", async (importOriginal) => {
  const orig = await importOriginal<any>();
  return {
    ...orig,
    // Salvar único: o núcleo é UMA chamada (o registro guarda os blocos que o hook montou).
    salvarCardPlanejamento: vi.fn(async (i: any) => {
      h.log.push({ evento: "rpc:salvar_card_planejamento", args: i });
      return { modelo_id: i.modeloId, rev: 4, revisao_marcada: h.revisao.atual };
    }),
    lerGradeServidorComprado: vi.fn(async () => null),
    invalidarAposGravarCad: vi.fn(),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { emptyDraft } from "@/components/planejamento/modelo-shared";
import { usePecaTeste, type FornecedorMo } from "@/components/planejamento/planejamento-detail/usePecaTeste";
import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";

const servidor = (o: { empresa?: string; rev?: number; data_entrada?: string | null; fornecedorNome?: string } = {}) => ({
  trilhas: [{
    mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: o.empresa ?? F1, empresa_nome: o.fornecedorNome ?? "Oficina Um",
    mo_aprovado: true, aprovada: false,
    tentativas: [{ id: T1, numero: 1, empresa_id: null, empresa_nome: null, data_saida: "2026-09-22", data_entrada: o.data_entrada ?? null, aprovacao: null, decidido_em: null, rev: o.rev ?? 1 }],
  }],
  outros: [],
});

type Cfg = {
  somente?: boolean; inerte?: boolean; fornecedorMo?: Record<string, FornecedorMo> | null;
  moMudou?: boolean; bomGravar?: boolean; ignoradas?: Set<string>;
};
type Api = { pt: ReturnType<typeof usePecaTeste>; save: ReturnType<typeof usePlanejamentoSave>["save"]; spies: Record<string, any> };
let api: Api;
let root: Root;
let qc: QueryClient;

function Sonda({ cfg }: { cfg: Cfg }) {
  const pt = usePecaTeste({ modeloId: "m1", habilitado: true, podeEditar: true, fornecedorMo: cfg.fornecedorMo ?? null, linhasIgnoradas: cfg.ignoradas ?? null });
  const draft = { ...emptyDraft(), nome: "Vestido", origem: "interno" as const };
  const refs = useRefs(draft, cfg);
  const spies = refs.spies;
  const ficha: any = {
    podeGravarColunasDev: true, podeVerCustos: true,
    conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
    setConflitoBom: vi.fn(), marcarSaveEmVoo: vi.fn(), bomMudouNoServidor: async () => false,
    capturar: () => ({
      estado: {}, snapshot: "", gravar: !!cfg.bomGravar, sujoNaCaptura: false, flags: { grade: !!cfg.bomGravar, consumo: false, aviamentos: false },
      idsEtiquetasServidor: [], tecidosPlanejados: [], totais: null, cad: { gravar: false }, gradeConflito: false, gradeExterna: null,
    }),
    cadGravado: vi.fn(), aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }), bomGravado: vi.fn(), invalidarBom: vi.fn(),
    bomPendenteDeGravar: () => false, etapas: {},
  };
  const { save } = usePlanejamentoSave({
    modeloId: "m1", isEdit: true, isRevenda: false, paOn: false, piOn: false, podeEditarPreco: false, podeVerCustos: true, podeEditarMO: true,
    podeEditarDev: true, podeEditarPlanejamento: true, refEditavel: false, categorias: [],
    draft, setDraft: vi.fn(), draftLiveRef: { current: draft }, touchedRef: { current: new Set() }, baseRef: { current: { draft } },
    revRef: { current: 3 }, retryRef: { current: false }, savingRef: { current: false }, conflitosRef: { current: [] }, setConflitos: vi.fn(),
    setUltimoMerge: vi.fn(), setEnviada: vi.fn(), setLancado: vi.fn(),
    moLinhasRef: refs.moLinhasRef, moBaseRef: refs.moBaseRef, setMoLinhasBase: vi.fn(),
    gradeRevenda: {}, setGradeRevenda: vi.fn(), gradeRevendaDirty: false, gradeRevendaBaseRef: { current: "{}" }, gradeRevendaRevRef: { current: null },
    buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false, qc, onSaved: spies.onSaved, ficha, resetDraftBaseline: spies.resetDraftBaseline,
    pecaTeste: cfg.inerte ? undefined : pt.pecaTesteSave, somentePecaTeste: !!cfg.somente,
  });
  api = { pt, save, spies };
  return null;
}
function useRefs(_d: unknown, cfg: Cfg) {
  const base = [{ id: L1, categoria_terceirizado_id: CAT, valor: 10, aprovado: true, empresa_id: F1, empresa_nome: "Oficina Um" }];
  const mudou = cfg.moMudou
    ? [{ ...base[0], empresa_id: F2, empresa_nome: "Oficina Dois" }]
    : base;
  const moBaseRef = useRef<any>(base);
  const moLinhasRef = useRef<any>(mudou);
  const spies = useRef({ onSaved: vi.fn(async () => {}), resetDraftBaseline: vi.fn() }).current;
  return { moBaseRef, moLinhasRef, spies };
}

async function montar(cfg: Cfg) {
  h.log.length = 0;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda, { cfg }))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
async function editarEntrada(valor: string) {
  await act(async () => { api.pt.editarAtual(L1, { data_entrada: valor }); });
  await assentar();
}
async function salvar(): Promise<any> {
  let r: any;
  await act(async () => { r = await api.save.mutateAsync(undefined); });
  await assentar();
  return r;
}
const eventos = () => h.log.map((c) => c.evento);
const chamadasSalvarPT = () => h.log.filter((c) => c.evento === "rpc:salvar_peca_teste");

beforeEach(() => {
  h.respostasSalvarPT.length = 0;
  h.lerPT.atual = servidor();
  h.revisao.atual = {};
  vi.mocked(toast.warning).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe("Salvar do card — etapa da Peça Teste", () => {
  it("(a) o núcleo (cabeçalho + BOM + M.O. + #Erro) vai numa ÚNICA RPC e a etapa da Peça Teste roda DEPOIS dela", async () => {
    h.revisao.atual = { cad: true };
    await montar({ moMudou: true, bomGravar: true });
    await editarEntrada("2026-09-29");
    const r = await salvar();
    const ev = eventos();
    const iCard = ev.indexOf("rpc:salvar_card_planejamento");
    const iPT = ev.indexOf("rpc:salvar_peca_teste");
    expect(iCard).toBeGreaterThanOrEqual(0);
    expect(iPT).toBeGreaterThan(iCard);
    // nada da cadeia antiga: cada pedaço do núcleo é um BLOCO da mesma chamada
    for (const antigo of ["update:modelos", "rpc:salvar_modelo_servico_mo", "rpc:marcar_revisao_por_mudanca", "rpc:salvar_modelo_bom", "rpc:salvar_cad_completo"]) expect(ev).not.toContain(antigo);
    const nucleo = h.log.find((c) => c.evento === "rpc:salvar_card_planejamento")!.args;
    expect(nucleo.mo).toHaveLength(1);
    expect(nucleo.revBase).toBe(3);
    expect(nucleo.bom.gravar).toBe(true);
    expect(r.pecaTeste.resultado).toEqual({ ok: true });
    expect(r.etapasMarcadas).toEqual(["cad"]);
  });

  it("(a) o payload da etapa = só o que mudou, com o rev da base em _rev_base.tentativas", async () => {
    await montar({});
    await editarEntrada("2026-09-29");
    await salvar();
    const [c] = chamadasSalvarPT();
    expect(c.args._modelo_id).toBe("m1");
    expect(c.args._trilhas).toEqual([{
      mo_linha_id: L1, categoria_id: CAT,
      tentativas: [{ id: T1, numero: 1, data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: null }],
    }]);
    expect(c.args._rev_base).toEqual({ tentativas: { [T1]: 1 }, fornecedor: {} });
  });

  it("(a) gravou: a seção re-baseia (limpa o 'não salvo') e invalida as queries da seção/etapas", async () => {
    await montar({});
    await editarEntrada("2026-09-29");
    expect(api.pt.dirty).toBe(true);
    const inv = vi.spyOn(qc, "invalidateQueries");
    await salvar();
    expect(api.pt.dirty).toBe(false);
    const chaves = inv.mock.calls.map((c) => JSON.stringify((c[0] as any).queryKey));
    for (const k of [["peca-teste", "m1"], ["mo-resumo", "m1"], ["mo-resumo-list"], ["modelo-mo-resumo"], ["plan-kanban-cond", "m1"], ["modelo-condicoes-kanban", "m1"], ["modelo"], ["etapas-cards"], ["etapas-peca-teste"]]) {
      expect(chaves, JSON.stringify(k)).toContain(JSON.stringify(k));
    }
  });

  it("sem nada da Peça Teste a gravar: a etapa não chama a RPC", async () => {
    await montar({});
    const r = await salvar();
    expect(chamadasSalvarPT()).toHaveLength(0);
    expect(r.pecaTeste).toBeNull();
  });

  it("(b) P0409 sem conflito: relê, mescla e re-tenta 1x com o rev novo; o resto do card salvo 1x", async () => {
    await montar({});
    await editarEntrada("2026-09-29");
    // o outro usuário só mexeu no rev (mesmos dados): a seção relê e manda de novo com rev 2
    h.respostasSalvarPT.push({ code: "P0409", message: "peca_teste_conflito: outra pessoa salvou a peca teste" }, null);
    h.lerPT.atual = servidor({ rev: 2 });
    const r = await salvar();
    const cs = chamadasSalvarPT();
    expect(cs).toHaveLength(2);
    expect(cs[0].args._rev_base.tentativas[T1]).toBe(1);
    expect(cs[1].args._rev_base.tentativas[T1]).toBe(2);
    expect(cs[1].args._trilhas[0].tentativas[0].data_entrada).toBe("2026-09-29");
    expect(r.pecaTeste.resultado).toEqual({ ok: true });
    expect(eventos().filter((e) => e === "rpc:salvar_card_planejamento")).toHaveLength(1);
    expect(api.spies.onSaved).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("(c) P0409 COM conflito: não lança; o resultado traz o conflito; a seção continua suja e avisa; o card salvou", async () => {
    await montar({});
    await editarEntrada("2026-09-29");
    h.respostasSalvarPT.push({ code: "P0409", message: "peca_teste_conflito: outra pessoa salvou a peca teste" });
    h.lerPT.atual = servidor({ rev: 2, data_entrada: "2026-10-02" }); // ele pôs outra data de entrada
    const r = await salvar(); // se lançasse, o mutateAsync rejeitaria
    expect(chamadasSalvarPT()).toHaveLength(1);
    expect("conflito" in r.pecaTeste.resultado).toBe(true);
    expect(r.pecaTeste.resultado.conflito[0]).toMatchObject({ path: `pt:${L1}:data_entrada` });
    expect(api.pt.dirty).toBe(true); // a base NÃO avançou para o que eu mandei
    expect(api.pt.conflitos).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith("Card salvo. A Peça Teste foi alterada por outra pessoa — confira a seção.");
    expect(api.spies.resetDraftBaseline).toHaveBeenCalled(); // o resto do card re-baseou
    expect(api.spies.onSaved).toHaveBeenCalledTimes(1);
  });

  it("(c) enquanto houver conflito da seção, o próximo Salvar recusa ANTES de gravar qualquer coisa", async () => {
    await montar({});
    await editarEntrada("2026-09-29");
    h.respostasSalvarPT.push({ code: "P0409", message: "peca_teste_conflito: x" });
    h.lerPT.atual = servidor({ rev: 2, data_entrada: "2026-10-02" });
    await salvar();
    h.log.length = 0;
    await expect(act(async () => { await api.save.mutateAsync(undefined); })).rejects.toThrow(/conflitos da Peça Teste/);
    expect(eventos().filter((e) => e !== "rpc:peca_teste_modelo")).toEqual([]);
  });

  it("erro que não é P0409 vira aviso 'Card salvo, mas a Peça Teste não: …' e a seção fica suja", async () => {
    await montar({});
    await editarEntrada("2026-09-29");
    h.respostasSalvarPT.push({ code: "P0001", message: "peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada" });
    const r = await salvar();
    expect("erro" in r.pecaTeste.resultado).toBe(true);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/^Card salvo, mas a Peça Teste não: /);
    expect(api.pt.dirty).toBe(true);
  });

  it("(d) só-Peça-Teste: NÃO chama o núcleo do card (salvar_card_planejamento); só a etapa da seção", async () => {
    await montar({ somente: true, moMudou: true, bomGravar: true });
    await editarEntrada("2026-09-29");
    const r = await salvar();
    const ev = eventos();
    expect(ev).not.toContain("rpc:salvar_card_planejamento");
    expect(ev).not.toContain("update:modelos");
    expect(ev).not.toContain("rpc:salvar_modelo_bom");
    expect(ev).not.toContain("rpc:salvar_modelo_servico_mo");
    expect(ev).not.toContain("rpc:marcar_revisao_por_mudanca");
    expect(ev.filter((e) => e === "rpc:salvar_peca_teste")).toHaveLength(1);
    expect(r.somentePecaTeste).toBe(true);
    expect(r.pecaTeste.resultado).toEqual({ ok: true });
    // onSuccess mínimo: não re-baseia o draft do card nem chama o onSaved do host
    expect(api.spies.resetDraftBaseline).not.toHaveBeenCalled();
    expect(api.spies.onSaved).not.toHaveBeenCalled();
    expect(api.pt.dirty).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Peça teste salva");
  });

  it("(d) só-Peça-Teste sem nada a gravar: avisa e não chama nada", async () => {
    await montar({ somente: true });
    const r = await salvar();
    expect(eventos().filter((e) => e !== "rpc:peca_teste_modelo")).toEqual([]);
    expect(r.pecaTeste).toBeNull();
  });

  it("(e) troca de fornecedor com a M.O. editável: o núcleo (bloco mo) leva o empresa_id E salvar_peca_teste também (idempotente)", async () => {
    await montar({ moMudou: true, fornecedorMo: { [L1]: { id: F2, nome: "Oficina Dois" } } });
    await act(async () => { api.pt.trocarFornecedor(L1, F2, "Oficina Dois"); });
    await assentar();
    expect(api.pt.dirty).toBe(true);
    await salvar();
    const nucleo = h.log.find((c) => c.evento === "rpc:salvar_card_planejamento")!;
    expect(nucleo.args.mo[0].empresa_id).toBe(F2);
    const [pt] = chamadasSalvarPT();
    expect(pt.args._trilhas[0].empresa_id).toBe(F2);
    expect(pt.args._rev_base.fornecedor).toEqual({ [L1]: F1 }); // o fornecedor que a pessoa VIU
    const ev = eventos();
    expect(ev.indexOf("rpc:salvar_peca_teste")).toBeGreaterThan(ev.indexOf("rpc:salvar_card_planejamento"));
  });

  it("(f) sem a seção (pecaTeste inerte) o Salvar é idêntico ao de antes: nenhuma chamada da Peça Teste e o resto na mesma ordem", async () => {
    await montar({ inerte: true, moMudou: true, bomGravar: true });
    await editarEntrada("2026-09-29"); // a seção até tem rascunho, mas o Salvar não a conhece
    const r = await salvar();
    expect(eventos().filter((e) => e !== "rpc:peca_teste_modelo")).toEqual(["rpc:salvar_card_planejamento"]);
    expect(r.pecaTeste).toBeNull();
  });
});

describe("fix round 1 — tipo da linha trocado (achado 1)", () => {
  it("linha ignorada (tipo trocado no rascunho da M.O.): a seção não fica suja e o Salvar NÃO manda a trilha", async () => {
    await montar({ ignoradas: new Set([L1]) });
    await editarEntrada("2026-09-29");
    expect(api.pt.dirty).toBe(false);
    const r = await salvar();
    expect(chamadasSalvarPT()).toHaveLength(0);
    expect(r.pecaTeste).toBeNull();
  });

  it("P0409 `desatualizada` porque o tipo mudou: o retry NÃO leva minha aprovação/datas para o tipo novo (nenhuma 2ª chamada)", async () => {
    await montar({});
    await act(async () => { api.pt.editarAtual(L1, { data_entrada: "2026-09-29" }); });
    await act(async () => { api.pt.aprovarAtual(L1); });
    await assentar();
    h.respostasSalvarPT.push({ code: "P0409", message: "peca_teste_desatualizada: servico da mao de obra mudou" });
    const fresh = servidor();
    fresh.trilhas[0].categoria_id = "00000000-0000-4000-8000-00000000ca02";
    fresh.trilhas[0].categoria_nome = "Bordado";
    fresh.trilhas[0].tentativas = [];
    h.lerPT.atual = fresh;
    const r = await salvar();
    expect(chamadasSalvarPT()).toHaveLength(1);
    expect(r.pecaTeste.resultado).toEqual({ ok: true });
    expect(api.pt.estado?.trilhas[0].tentativas).toEqual([]);
  });
});

describe("a fonte do Salvar", () => {
  it("o resultado da etapa vai no retorno do mutationFn e o aviso/rebase só no onSuccess (a captura é síncrona, junto da da M.O.)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts", "utf8");
    const iMoCap = src.indexOf("const moLinhasEnviadas = moLinhasRef.current;");
    const iPtCap = src.indexOf("pecaTesteRef.current.capturar() : null");
    expect(iPtCap).toBeGreaterThan(iMoCap);
    // nenhum await entre as duas capturas
    expect(src.slice(iMoCap, iPtCap)).not.toMatch(/\bawait\b/);
    expect(src).toMatch(/resolucaoTrava, precosServidorPosRpc, pecaTeste: etapaPT/);
  });
});

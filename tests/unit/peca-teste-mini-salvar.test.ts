// @vitest-environment happy-dom
// R11 T6 — o Salvar do card com a mini explosão (usePlanejamentoSave + usePecaTeste REAIS, supabase mockado):
//   (a) ordem: Peça Teste DEPOIS da M.O. e ANTES de marcar_revisao_por_mudanca, com a mini no payload; (b) `confere` = o "a enviar" que a tela
//   mostrou, só quando o Salvar faz a baixa; (c) estorno pede confirmação ANTES de enviar (Cancelar não chama RPC; Confirmar salva 1x);
//   (d) P0409 `peca_teste_mini_desatualizada` relê, mescla e re-tenta 1x com o rev novo; (e) P-57: sem a ficha pronta a mini não é capturada;
//   (f) toasts pós-Salvar (baixa/estorno/falta/sem tamanho e cor) e o da reprovação; (g) avisos do merge; (h) sem mini = Salvar idêntico ao da R9.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const L1 = "00000000-0000-4000-8000-0000000000a1";
const CAT = "00000000-0000-4000-8000-00000000ca01";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const T1 = "00000000-0000-4000-8000-0000000000b1";
const V1 = "00000000-0000-4000-8000-0000000000c1";
const KEY = `t:tecido:1:1:${V1}`;

const h = vi.hoisted(() => ({
  log: [] as { evento: string; args?: any }[],
  respostasSalvarPT: [] as ({ code?: string; message: string } | null)[],
  lerPT: { atual: null as any },
  /** chamado quando `salvar_peca_teste` dá certo: troca o que a releitura devolve (simula o servidor depois da baixa/estorno). */
  aoGravarPT: { fn: null as null | (() => void) },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true, canEdit: () => true }) }));
vi.mock("@/integrations/supabase/client", () => {
  const rpc = (nome: string, args: any) => {
    h.log.push({ evento: `rpc:${nome}`, args });
    if (nome === "peca_teste_modelo") return Promise.resolve({ data: h.lerPT.atual, error: null });
    if (nome === "salvar_peca_teste") {
      const r = h.respostasSalvarPT.length > 0 ? h.respostasSalvarPT.shift()! : null;
      if (!r) h.aoGravarPT.fn?.();
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
  return { ...orig, salvarCardPlanejamento: vi.fn(async (i: any) => { h.log.push({ evento: "rpc:salvar_card_planejamento", args: i }); return { modelo_id: i.modeloId, rev: 4, revisao_marcada: {} }; }), lerGradeServidorComprado: vi.fn(async () => null), invalidarAposGravarCad: vi.fn() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { emptyDraft } from "@/components/planejamento/modelo-shared";
import { salvarComConfirmacaoEstorno, usePecaTeste } from "@/components/planejamento/planejamento-detail/usePecaTeste";
import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
import type { MiniApi } from "@/components/planejamento/planejamento-detail/useMiniExplosao";
import type { MiniLinha } from "@/lib/peca-teste-mini";

const linhaTec = (aEnviar: number): MiniLinha => ({
  chave: KEY, familia: "tecido", rotulo: "Tecido 1", variante_rotulo: "Preto", unidade: "m", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, pecas: 1,
  aviamento_id: null, variante_aviamento_id: null, etiqueta_id: null, cor_id: null, tamanho_bucket: null, consumo: 1.5, loss_percent: 10, necessaria: 1.65, a_enviar: aEnviar, oc_tecido_item_id: null,
});

function apiMini(over: Partial<MiniApi> = {}): MiniApi {
  return {
    ativo: true, carregando: false, erro: false, tentarDeNovo: () => {}, fichaIndisponivel: false, pronta: true, semTecido1: false, tamanhos: [], cores: [],
    calcular: (m) => (m && m.tamanho && m.variante_tecido_id ? { linhas: [linhaTec(m.linhas.find((l) => l.chave === KEY)?.a_enviar ?? 1.65)], padrao: {}, fora: 0, faltas: [] } : null),
    fontesTecido: () => ({ vinculadas: [], todas: [] }), variantesAviamento: () => [], emEstoque: () => null,
    ...over,
  };
}

type MiniSrv = { tamanho?: string | null; variante_tecido_id?: string | null; baixa_em?: string | null; linhas?: any[] } | null;
const servidor = (o: { rev?: number; data_saida?: string | null; mini?: MiniSrv; aprovacao?: string | null; data_entrada?: string | null } = {}) => ({
  trilhas: [{
    mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: F1, empresa_nome: "Oficina Um", mo_aprovado: true, aprovada: false,
    tentativas: [{
      id: T1, numero: 1, empresa_id: null, empresa_nome: null, data_saida: o.data_saida ?? null, data_entrada: o.data_entrada ?? null, aprovacao: o.aprovacao ?? null,
      decidido_em: null, rev: o.rev ?? 1,
      mini: o.mini === undefined ? null : o.mini === null ? null : { mesma_oc: true, tem_historico: !!o.mini.baixa_em, linhas: [], ...o.mini },
    }],
  }],
  outros: [],
});
const FOTO = (faltou: number) => ({ rotulo: "Tecido 1", variante: "Preto", unidade: "m", consumo: 1.5, loss_percent: 10, necessaria: 1.65, a_enviar: 1.65, baixado: 1.65 - faltou, faltou, fontes: [] });
const miniOk = (o: Record<string, unknown> = {}) => ({ tamanho: "40|M", variante_tecido_id: V1, ...o });

type Cfg = { mini?: MiniApi | null; moMudou?: boolean };
type Api = { pt: ReturnType<typeof usePecaTeste>; save: ReturnType<typeof usePlanejamentoSave>["save"]; spies: Record<string, any> };
let api: Api;
let root: Root;
let qc: QueryClient;

function Sonda({ cfg }: { cfg: Cfg }) {
  const pt = usePecaTeste({ modeloId: "m1", habilitado: true, podeEditar: true, fornecedorMo: null, linhasIgnoradas: null, mini: cfg.mini ?? null });
  const draft = { ...emptyDraft(), nome: "Vestido", origem: "interno" as const };
  const base = [{ id: L1, categoria_terceirizado_id: CAT, valor: 10, aprovado: true, empresa_id: F1, empresa_nome: "Oficina Um" }];
  const moBaseRef = useRef<any>(base);
  const moLinhasRef = useRef<any>(cfg.moMudou ? [{ ...base[0], valor: 20 }] : base);
  const spies = useRef({ onSaved: vi.fn(async () => {}), resetDraftBaseline: vi.fn() }).current;
  const ficha: any = {
    podeGravarColunasDev: true, podeVerCustos: true, conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
    setConflitoBom: vi.fn(), marcarSaveEmVoo: vi.fn(), bomMudouNoServidor: async () => false,
    capturar: () => ({ estado: {}, snapshot: "", gravar: false, sujoNaCaptura: false, flags: { grade: false, consumo: false, aviamentos: false }, idsEtiquetasServidor: [], tecidosPlanejados: [], totais: null, cad: { gravar: false }, gradeConflito: false, gradeExterna: null }),
    cadGravado: vi.fn(), aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }), bomGravado: vi.fn(), invalidarBom: vi.fn(), bomPendenteDeGravar: () => false, etapas: {},
  };
  const { save } = usePlanejamentoSave({
    modeloId: "m1", isEdit: true, isRevenda: false, paOn: false, piOn: false, podeEditarPreco: false, podeVerCustos: true, podeEditarMO: true,
    podeEditarDev: true, podeEditarPlanejamento: true, refEditavel: false, categorias: [],
    draft, setDraft: vi.fn(), draftLiveRef: { current: draft }, touchedRef: { current: new Set() }, baseRef: { current: { draft } },
    revRef: { current: 3 }, retryRef: { current: false }, savingRef: { current: false }, conflitosRef: { current: [] }, setConflitos: vi.fn(),
    setUltimoMerge: vi.fn(), setEnviada: vi.fn(), setLancado: vi.fn(), moLinhasRef, moBaseRef, setMoLinhasBase: vi.fn(),
    gradeRevenda: {}, setGradeRevenda: vi.fn(), gradeRevendaDirty: false, gradeRevendaBaseRef: { current: "{}" }, gradeRevendaRevRef: { current: null },
    buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false, qc, onSaved: spies.onSaved, ficha, resetDraftBaseline: spies.resetDraftBaseline,
    pecaTeste: pt.pecaTesteSave, somentePecaTeste: false,
  });
  api = { pt, save, spies };
  return null;
}

async function montar(cfg: Cfg) {
  h.log.length = 0;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda, { cfg }))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
async function salvar(): Promise<any> {
  let r: any;
  await act(async () => { r = await api.save.mutateAsync(undefined); });
  await assentar();
  return r;
}
const eventos = () => h.log.map((c) => c.evento);
const chamadasSalvarPT = () => h.log.filter((c) => c.evento === "rpc:salvar_peca_teste");
const editar = async (patch: Record<string, unknown>) => { await act(async () => { api.pt.editarAtual(L1, patch as any); }); await assentar(); };
const setMini = async (m: any) => { await act(async () => { api.pt.editarMini(L1, m); }); await assentar(); };
const miniDoDraft = () => api.pt.estado!.trilhas[0].tentativas[0].mini;

beforeEach(() => {
  h.respostasSalvarPT.length = 0;
  h.aoGravarPT.fn = null;
  h.lerPT.atual = servidor();
  for (const f of [toast.warning, toast.error, toast.success, toast.info]) vi.mocked(f).mockClear();
});

describe("Salvar com a mini — payload, ordem e confere", () => {
  it("(a) a mini vai no payload da Peça Teste, DEPOIS do núcleo do card (UMA RPC: cabeçalho + BOM + M.O. + #Erro); com a data de saída leva `confere` do que a tela mostrou", async () => {
    await montar({ mini: apiMini(), moMudou: true });
    await setMini({ tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] });
    await editar({ data_saida: "2026-10-07" });
    const r = await salvar();
    const ev = eventos();
    expect(ev.indexOf("rpc:salvar_card_planejamento")).toBeGreaterThanOrEqual(0);
    expect(ev.indexOf("rpc:salvar_peca_teste")).toBeGreaterThan(ev.indexOf("rpc:salvar_card_planejamento"));
    const [c] = chamadasSalvarPT();
    expect(c.args._trilhas[0].tentativas[0].mini).toEqual({
      tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, ajustes: [], confere: { [KEY]: 1.65 },
    });
    expect(r.pecaTeste.resultado).toEqual({ ok: true });
  });
  it("(b) `confere` segue o 'a enviar' EDITADO (4 casas) — e só vai quando o Salvar faz a baixa (sem data de saída = sem `confere`)", async () => {
    await montar({ mini: apiMini() });
    await setMini({ tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [{ chave: KEY, familia: "tecido", consumo: null, loss_percent: null, a_enviar: 2, variante_aviamento_id: null, oc_tecido_item_id: null }] });
    await salvar(); // só a mini, sem Data de saída
    expect(chamadasSalvarPT()[0].args._trilhas[0].tentativas[0].mini.confere).toBeUndefined();
    expect(chamadasSalvarPT()[0].args._trilhas[0].tentativas[0].mini.ajustes).toHaveLength(1);
    h.log.length = 0;
    h.lerPT.atual = servidor({ rev: 2, mini: miniOk({ linhas: [{ chave: KEY, familia: "tecido", a_enviar: 2 }] }) });
    await act(async () => { await qc.invalidateQueries({ queryKey: ["peca-teste", "m1"] }); }); await assentar();
    await editar({ data_saida: "2026-10-07" });
    await salvar();
    expect(chamadasSalvarPT()[0].args._trilhas[0].tentativas[0].mini.confere).toEqual({ [KEY]: 2 });
  });
  it("(h) sem mini (nada escolhido): o payload é idêntico ao da R9 — nenhuma chave `mini` — com a API presente ou não", async () => {
    for (const cfg of [{ mini: apiMini() }, { mini: null }]) {
      await montar(cfg);
      await editar({ data_entrada: "2026-10-09" });
      await salvar();
      expect(chamadasSalvarPT()[0].args._trilhas).toEqual([{ mo_linha_id: L1, categoria_id: CAT, tentativas: [{ id: T1, numero: 1, data_saida: null, data_entrada: "2026-10-09", aprovacao: null }] }]);
      expect(chamadasSalvarPT()[0].args._rev_base).toEqual({ tentativas: { [T1]: 1 }, fornecedor: {} });
    }
  });
  it("(e) P-57: com a ficha ainda carregando, a mini NÃO é capturada — o Salvar recusa antes de gravar a Peça Teste", async () => {
    const carregando = apiMini({ pronta: false, carregando: true, calcular: () => null });
    await montar({ mini: carregando });
    await setMini({ tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] });
    await expect(act(async () => { await api.save.mutateAsync(undefined); })).rejects.toThrow(/ficha do card ainda está carregando/);
    expect(chamadasSalvarPT()).toHaveLength(0);
  });
  it("(e2) ERRO de carga (estoque ou variantes) não é 'carregando': o Salvar recusa com o aviso honesto, sem gravar a Peça Teste", async () => {
    const comErro = apiMini({ pronta: false, carregando: false, erro: true, calcular: () => null });
    await montar({ mini: comErro });
    await setMini({ tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] });
    await expect(act(async () => { await api.save.mutateAsync(undefined); })).rejects.toThrow(/Não foi possível carregar os dados da mini explosão/);
    expect(chamadasSalvarPT()).toHaveLength(0);
    // sem mini nenhuma na Peça Teste o erro de carga NÃO trava o Salvar do card
    await montar({ mini: comErro });
    await editar({ data_entrada: "2026-10-09" });
    await salvar();
    expect(chamadasSalvarPT()).toHaveLength(1);
  });
  it("(e) sem permissão de ver a ficha (fichaIndisponivel) o servidor usa o próprio cálculo: salva sem `confere`", async () => {
    await montar({ mini: apiMini({ pronta: false, fichaIndisponivel: true, calcular: () => null }) });
    await setMini({ tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] });
    await salvar();
    expect(chamadasSalvarPT()[0].args._trilhas[0].tentativas[0].mini.confere).toBeUndefined();
  });
});

describe("Estorno: confirmação ANTES de enviar", () => {
  const comBaixa = () => servidor({ data_saida: "2026-10-07", mini: miniOk({ baixa_em: "2026-10-07T10:00:00Z", linhas: [{ chave: KEY, familia: "tecido", foto: FOTO(0) }] }) });

  it("estornosPendentes: vazio sem estorno; com a Data de saída apagada = '<serviço> · tentativa N'", async () => {
    h.lerPT.atual = comBaixa();
    await montar({ mini: apiMini() });
    expect(api.pt.pecaTesteSave.estornosPendentes()).toEqual([]);
    await editar({ data_saida: null });
    expect(api.pt.pecaTesteSave.estornosPendentes()).toEqual(["PL · tentativa 1"]);
    expect(api.pt.pecaTesteSave.estornoRefazBaixa()).toBe(false);
  });
  it("estorno + nova baixa no mesmo Salvar (data preenchida e mini mudada): refaz = true (texto P-365 A)", async () => {
    h.lerPT.atual = comBaixa();
    await montar({ mini: apiMini() });
    await editar({ data_saida: null });
    await editar({ data_saida: "2026-10-07" });
    await setMini({ ...miniDoDraft()!, mesma_oc: false });
    expect(api.pt.pecaTesteSave.estornosPendentes()).toEqual(["PL · tentativa 1"]);
    expect(api.pt.pecaTesteSave.estornoRefazBaixa()).toBe(true);
  });
  it("diálogo SÓ quando há estorno; Cancelar não chama RPC; Confirmar salva 1x (helper do clique do Salvar)", async () => {
    const salvarFn = vi.fn();
    const pedir = vi.fn();
    salvarComConfirmacaoEstorno({ estornosPendentes: () => [], estornoRefazBaixa: () => false }, pedir, salvarFn);
    expect(pedir).not.toHaveBeenCalled();
    expect(salvarFn).toHaveBeenCalledTimes(1);

    salvarFn.mockClear();
    const itens = ["PL · tentativa 1"];
    salvarComConfirmacaoEstorno({ estornosPendentes: () => itens, estornoRefazBaixa: () => false }, pedir, salvarFn);
    expect(salvarFn).not.toHaveBeenCalled(); // Cancelar (nada chamou onConfirmar) = nada é enviado
    const pedido = pedir.mock.calls[0][0];
    expect(pedido.titulo).toBe("Estornar a baixa da peça teste?");
    expect(pedido.descricao).toContain("PL · tentativa 1");
    expect(pedido.destrutivo).toBe(true);
    pedido.onConfirmar();
    expect(salvarFn).toHaveBeenCalledTimes(1);

    pedir.mockClear();
    salvarComConfirmacaoEstorno({ estornosPendentes: () => itens, estornoRefazBaixa: () => true }, pedir, salvarFn);
    expect(pedir.mock.calls[0][0].descricao).toContain("e fazer a baixa de novo com as quantidades novas");
  });
  it("Cancelar: nenhuma RPC sai; Confirmar: o Salvar normal grava o estorno (mini sem `confere`) 1x", async () => {
    h.lerPT.atual = comBaixa();
    await montar({ mini: apiMini() });
    await editar({ data_saida: null });
    let confirmar: (() => void) | null = null;
    h.log.length = 0;
    salvarComConfirmacaoEstorno(api.pt.pecaTesteSave, (p) => { confirmar = p.onConfirmar; }, () => { void api.save.mutateAsync(undefined); });
    await assentar();
    expect(chamadasSalvarPT()).toHaveLength(0); // diálogo aberto = nada enviado
    await act(async () => { confirmar!(); }); await assentar();
    expect(chamadasSalvarPT()).toHaveLength(1);
    const t = chamadasSalvarPT()[0].args._trilhas[0].tentativas[0];
    expect(t.data_saida).toBeNull();
    expect(t.mini.confere).toBeUndefined();
  });
});

describe("P0409 da mini", () => {
  it("(d) `peca_teste_mini_desatualizada`: relê, mescla e re-tenta 1x com o rev novo (sem conflito)", async () => {
    await montar({ mini: apiMini() });
    await setMini({ tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] });
    h.respostasSalvarPT.push({ code: "P0409", message: "peca_teste_mini_desatualizada: o BOM mudou" }, null);
    h.lerPT.atual = servidor({ rev: 2 });
    const r = await salvar();
    const cs = chamadasSalvarPT();
    expect(cs).toHaveLength(2);
    expect(cs[0].args._rev_base.tentativas[T1]).toBe(1);
    expect(cs[1].args._rev_base.tentativas[T1]).toBe(2); // o rev novo
    expect(cs[1].args._trilhas[0].tentativas[0].mini).toMatchObject({ tamanho: "40|M", variante_tecido_id: V1 }); // a mini minha segue
    expect(r.pecaTeste.resultado).toEqual({ ok: true });
    expect(eventos().filter((e) => e === "rpc:salvar_card_planejamento")).toHaveLength(1);
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining("outra pessoa"));
  });
});

describe("2º P0409 sem conflito", () => {
  const mini0 = { tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] };
  it("`peca_teste_mini_desatualizada` 2× seguidas: devolve o erro e o toast mostra o texto específico (não o genérico 'alterada por outra pessoa')", async () => {
    await montar({ mini: apiMini() });
    await setMini(mini0);
    h.respostasSalvarPT.push({ code: "P0409", message: "peca_teste_mini_desatualizada: o BOM mudou" }, { code: "P0409", message: "peca_teste_mini_desatualizada: o BOM mudou" });
    h.lerPT.atual = servidor({ rev: 2 });
    const r = await salvar();
    expect(chamadasSalvarPT()).toHaveLength(2);
    expect(r.pecaTeste.resultado).toHaveProperty("erro");
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("O BOM ou a mini explosão mudou"));
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining("outra pessoa"));
  });
  it("outro P0409 2× seguidas (sem conflito): segue como antes — 'alterada por outra pessoa'", async () => {
    await montar({ mini: apiMini() });
    await setMini(mini0);
    h.respostasSalvarPT.push({ code: "P0409", message: "conflito_versao: peca_teste" }, { code: "P0409", message: "conflito_versao: peca_teste" });
    h.lerPT.atual = servidor({ rev: 2 });
    const r = await salvar();
    expect(r.pecaTeste.resultado).toEqual({ conflito: [] });
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("outra pessoa"));
  });
});

describe("toasts do que o Salvar fez no estoque", () => {
  const baixaFeita = (faltou = 0) => servidor({ rev: 2, data_saida: "2026-10-07", mini: miniOk({ baixa_em: "2026-10-07T10:00:00Z", linhas: [{ chave: KEY, familia: "tecido", foto: FOTO(faltou) }] }) });

  it("baixa feita + falta registrada: 'Baixa de estoque feita pelo “a enviar”: …' e 'Salvo mesmo faltando estoque — falta registrada: …'", async () => {
    await montar({ mini: apiMini() });
    await setMini({ tamanho: "40|M", variante_tecido_id: V1, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] });
    await editar({ data_saida: "2026-10-07" });
    h.aoGravarPT.fn = () => { h.lerPT.atual = baixaFeita(0.65); };
    await salvar();
    expect(toast.success).toHaveBeenCalledWith("Baixa de estoque feita pelo “a enviar”: PL · tentativa 1.");
    expect(toast.warning).toHaveBeenCalledWith("Salvo mesmo faltando estoque — falta registrada: PL · Tecido 1 Preto 0,65 m.");
  });
  it("baixa estornada: 'Baixa estornada (o “a enviar” voltou ao estoque): …'", async () => {
    h.lerPT.atual = baixaFeita();
    await montar({ mini: apiMini() });
    await editar({ data_saida: null });
    h.aoGravarPT.fn = () => { h.lerPT.atual = servidor({ rev: 3, mini: miniOk({ baixa_em: null, linhas: [] }) }); };
    await salvar();
    expect(toast.warning).toHaveBeenCalledWith("Baixa estornada (o “a enviar” voltou ao estoque): PL · tentativa 1.");
  });
  it("Data de saída sem tamanho e cor: 'Sem tamanho e cor da peça não há baixa: …'", async () => {
    await montar({ mini: apiMini() });
    await editar({ data_saida: "2026-10-07" });
    h.aoGravarPT.fn = () => { h.lerPT.atual = servidor({ rev: 2, data_saida: "2026-10-07" }); };
    await salvar();
    expect(toast.warning).toHaveBeenCalledWith("Sem tamanho e cor da peça não há baixa: PL · tentativa 1.");
  });
  it("sem a mini ativa (loja sem Entrada e Saída) o Salvar não relê nem avisa nada de estoque", async () => {
    await montar({ mini: apiMini({ ativo: false }) });
    await editar({ data_saida: "2026-10-07" });
    h.log.length = 0;
    await salvar();
    expect(vi.mocked(toast.warning).mock.calls.filter((c) => /estoque|baixa/i.test(String(c[0])))).toEqual([]);
  });
  it("reprovar uma tentativa COM baixa: o toast diz que a baixa é mantida (peça gasta)", async () => {
    h.lerPT.atual = baixaFeita();
    await montar({ mini: apiMini() });
    await act(async () => { api.pt.reprovarAtual(L1); });
    expect(toast.warning).toHaveBeenCalledWith("Tentativa 1 reprovada. Nasceu a tentativa 2. A baixa da tentativa 1 é mantida (peça gasta). Salve o card para gravar.");
  });
  it("reprovar sem baixa (nem baixa prevista) não ganha o aviso", async () => {
    await montar({ mini: apiMini() });
    await editar({ data_saida: "2026-10-01", data_entrada: "2026-10-05" });
    await act(async () => { api.pt.reprovarAtual(L1); });
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("avisos do merge", () => {
  it("(g) baixa feita por OUTRA pessoa enquanto eu edito: a dela vale e o aviso fica visível no hook", async () => {
    await montar({ mini: apiMini() });
    await editar({ data_entrada: "2026-10-09" });
    h.lerPT.atual = servidor({ rev: 2, data_saida: "2026-10-07", mini: miniOk({ baixa_em: "2026-10-07T10:00:00Z", linhas: [] }) });
    await act(async () => { await qc.invalidateQueries({ queryKey: ["peca-teste", "m1"] }); }); await assentar();
    expect(api.pt.avisos).toEqual(["A baixa de estoque da peça teste (tentativa 1) foi feita por outra pessoa — a mini explosão foi atualizada."]);
    expect(miniDoDraft()?.baixa_em).toBe("2026-10-07T10:00:00Z");
  });
});

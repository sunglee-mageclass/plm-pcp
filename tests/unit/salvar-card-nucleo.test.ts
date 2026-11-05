// @vitest-environment happy-dom
// Salvar único do Planejamento (Task 3) — o NÚCLEO do Salvar do card existente é UMA chamada atômica (`salvar_card_planejamento`):
//   (1) os montadores PUROS dos blocos (`_bom`, `_etiquetas`, `_cad`, `_revisao`, `_mo`, `_grade_revenda`) — bloco só vai se for gravar, senão NULL;
//   (2) o cabeçalho (`_header`) só tem colunas da lista fechada da migration (senão o servidor recusa com header_campo_invalido);
//   (3) o hook: 1 chamada; erro do núcleo = mensagem única "nada foi gravado" e NADA de fora roda; P0409 re-monta tudo e re-chama a RPC.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  log: [] as { nome: string; args?: any }[],
  respostasNucleo: [] as ({ code?: string; message: string } | null)[],
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true, canEdit: () => true }) }));
vi.mock("@/integrations/supabase/client", () => {
  const rpc = (nome: string, args: any) => {
    h.log.push({ nome, args });
    if (nome === "salvar_card_planejamento") {
      const r = h.respostasNucleo.length > 0 ? h.respostasNucleo.shift()! : null;
      return Promise.resolve(r ? { data: null, error: r } : { data: { modelo_id: "m1", rev: 5, revisao_marcada: { cad: true } }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  const from = (tabela: string) => {
    h.log.push({ nome: `from:${tabela}` });
    const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: null, error: null }), single: () => Promise.resolve({ data: { rev: 3, grades: [] }, error: null }) };
    return q;
  };
  return { supabase: { rpc, from } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { emptyDraft, draftFromModeloRow } from "@/components/planejamento/modelo-shared";
import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
import {
  montarArgsSalvarCard, montarBomPayload, montarCadRpcPayload, montarEtiquetasPayload, montarRevisaoPayload,
} from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";

const bomStub = (o: Record<string, unknown> = {}): any => ({
  estado: {
    blocks: [], aviamentos: [], grades: [{ variante_numero: 1, grades: { P: 2 }, grade_total: 2 }],
    etiquetas: [
      { id: "e1", etiqueta_id: "E1", cor_id: "", consumo: 1.5, loss_percent: 0, custo_previsto: 0 },
      { etiqueta_id: "E2", cor_id: "C2", consumo: 2, loss_percent: 5, custo_previsto: 3 },
      { id: "e3", etiqueta_id: null, cor_id: null, consumo: 9, loss_percent: 0, custo_previsto: 0 },
    ],
  },
  gravar: true, flags: { grade: true, consumo: false, aviamentos: false }, gradesPayload: null,
  cad: { gravar: false, payload: null },
  ...o,
});

describe("montadores puros do núcleo", () => {
  it("_bom = {tecidos, aviamentos, grades}; comprado usa a grade cor×tamanho (gradesPayload), não a da ficha", () => {
    expect(montarBomPayload(bomStub())).toEqual({ tecidos: [], aviamentos: [], grades: [{ variante_numero: 1, grades: { P: 2 }, grade_total: 2 }] });
    const gp = [{ variante_numero: 2, grades: { M: 1 }, grade_total: 1 }];
    expect(montarBomPayload(bomStub({ gradesPayload: gp })).grades).toEqual(gp);
  });

  it("_etiquetas = ESTADO completo (com/sem id), sem as linhas sem insumo (a RPC numera pela posição e apaga o resto)", () => {
    expect(montarEtiquetasPayload(bomStub().estado.etiquetas)).toEqual([
      { id: "e1", etiqueta_id: "E1", cor_id: null, consumo: 1.5, loss_percent: 0, custo_previsto: 0 },
      { id: null, etiqueta_id: "E2", cor_id: "C2", consumo: 2, loss_percent: 5, custo_previsto: 3 },
    ]);
  });

  it("_cad usa nomes SEM underscore; sem gravar = null", () => {
    const payload = { _tecidos: [1], _grades: [2], _aviamentos: [3], _etiquetas: [4], _proporcoes: { P: 1 }, _observacoes_molde: null, _data_previsao_corte: null };
    expect(montarCadRpcPayload({ gravar: true, payload } as any)).toEqual({
      tecidos: [1], grades: [2], aviamentos: [3], etiquetas: [4], proporcoes: { P: 1 }, observacoes_molde: null, data_previsao_corte: null,
    });
    expect(montarCadRpcPayload({ gravar: false, payload } as any)).toBeNull();
    expect(montarCadRpcPayload({ gravar: true, payload: null } as any)).toBeNull();
  });

  it("_revisao só com BOM gravado E alguma flag; senão null", () => {
    expect(montarRevisaoPayload({ gravar: true, flags: { grade: true, consumo: false, aviamentos: true } })).toEqual({ grade: true, consumo: false, aviamentos: true });
    expect(montarRevisaoPayload({ gravar: true, flags: { grade: false, consumo: false, aviamentos: false } })).toBeNull();
    expect(montarRevisaoPayload({ gravar: false, flags: { grade: true, consumo: true, aviamentos: true } })).toBeNull();
  });

  it("bloco que não grava vai NULL (o servidor não mexe); _rev_base e _flags sempre presentes", () => {
    const a = montarArgsSalvarCard({ modeloId: "m1", header: { nome: "x" }, revBase: 7, bom: bomStub({ gravar: false }), gradeRevenda: null, mo: null });
    expect(a).toEqual({
      _modelo_id: "m1", _header: { nome: "x" }, _rev_base: 7, _bom: null, _etiquetas: null, _cad: null, _mo: null, _grade_revenda: null, _revisao: null, _flags: {},
    });
    const b = montarArgsSalvarCard({ modeloId: "m1", header: {}, revBase: 7, bom: bomStub(), gradeRevenda: [{ variante_numero: 1 }], mo: [{ id: "l1" }] });
    expect(b._bom).not.toBeNull();
    expect(b._etiquetas).toHaveLength(2);
    expect(b._mo).toEqual([{ id: "l1" }]);
    expect(b._grade_revenda).toEqual([{ variante_numero: 1 }]);
    expect(b._revisao).toEqual({ grade: true, consumo: false, aviamentos: false });
  });
});

describe("_header só leva colunas da lista fechada da RPC (anti-drift com a migration)", () => {
  const sql = readFileSync("supabase/migrations/20261108100000_salvar_card_planejamento.sql", "utf8");
  const lista = sql.slice(sql.indexOf("c_header_ok constant text[] := ARRAY["), sql.indexOf("];", sql.indexOf("c_header_ok constant text[] := ARRAY[")));
  const permitidas = new Set([...lista.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
  it("toda chave do Draft (que vira o payload do cabeçalho) está na lista da migration", () => {
    expect(permitidas.size).toBeGreaterThan(40);
    const fora = Object.keys(emptyDraft()).filter((k) => !permitidas.has(k));
    expect(fora).toEqual([]);
  });
});

// ── o hook ──────────────────────────────────────────────────────────────────────────────────────────────────────
type Api = ReturnType<typeof usePlanejamentoSave>;
let api: Api;
let qc: QueryClient;
const refs = { rev: { current: 3 as number | null }, retry: { current: false } };

function Sonda({ origem }: { origem: string }) {
  const draft = { ...emptyDraft(), nome: "Vestido", origem: origem as any };
  const ficha: any = {
    podeGravarColunasDev: true, podeVerCustos: true,
    conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
    setConflitoBom: vi.fn(), marcarSaveEmVoo: vi.fn(), bomMudouNoServidor: async () => false,
    capturar: () => bomStub({ cad: { gravar: true, payload: { _tecidos: [], _grades: [], _aviamentos: [], _etiquetas: [], _proporcoes: {}, _observacoes_molde: null, _data_previsao_corte: null } } }),
    cadGravado: vi.fn(), aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }), bomGravado: vi.fn(), invalidarBom: vi.fn(),
    bomPendenteDeGravar: () => false, etapas: {},
  };
  const { save } = usePlanejamentoSave({
    modeloId: "m1", isEdit: true, isRevenda: origem === "revenda", paOn: true, piOn: true, podeEditarPreco: false, podeVerCustos: true, podeEditarMO: true,
    podeEditarDev: true, podeEditarPlanejamento: true, refEditavel: false, categorias: [],
    draft, setDraft: vi.fn(), draftLiveRef: { current: draft }, touchedRef: { current: new Set() }, baseRef: { current: { draft } },
    revRef: refs.rev, retryRef: refs.retry, savingRef: { current: false }, conflitosRef: { current: [] }, setConflitos: vi.fn(),
    setUltimoMerge: vi.fn(), setEnviada: vi.fn(), setLancado: vi.fn(),
    moLinhasRef: { current: [] }, moBaseRef: { current: [] }, setMoLinhasBase: vi.fn(),
    gradeRevenda: {}, setGradeRevenda: vi.fn(), gradeRevendaDirty: false, gradeRevendaBaseRef: { current: "{}" }, gradeRevendaRevRef: { current: null },
    buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false, qc, onSaved: vi.fn(async () => {}), ficha, resetDraftBaseline: vi.fn(),
  });
  api = save as any;
  return null;
}
async function montar(origem = "interno") {
  h.log.length = 0;
  refs.rev.current = 3; refs.retry.current = false;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(["modelo", "m1"], { id: "m1", rev: 4, nome: "Vestido", origem, tecidos_planejados: [], fotos_modelo: [], fotos_referencia: [], custos_adicionais: [], proporcoes: {}, enviado_cad: false });
  await act(async () => { createRoot(document.createElement("div")).render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda, { origem }))); });
}
const nucleos = () => h.log.filter((c) => c.nome === "salvar_card_planejamento");
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  h.respostasNucleo.length = 0;
  for (const f of [toast.error, toast.success, toast.warning, toast.info]) vi.mocked(f).mockClear();
});

describe("o hook chama o núcleo UMA vez", () => {
  it("1 chamada com _rev_base = rev do card; nenhuma gravação da cadeia antiga; #Erro vem do retorno", async () => {
    await montar();
    let r: any;
    await act(async () => { r = await (api as any).mutateAsync(undefined); });
    await assentar();
    expect(nucleos()).toHaveLength(1);
    const a = nucleos()[0].args;
    expect(a._modelo_id).toBe("m1");
    expect(a._rev_base).toBe(3);
    expect(a._header.nome).toBe("Vestido");
    expect(a._bom).not.toBeNull();
    expect(a._cad).not.toBeNull();
    const nomes = h.log.map((c) => c.nome);
    for (const antigo of ["salvar_modelo_bom", "salvar_cad_completo", "salvar_modelo_servico_mo", "marcar_revisao_por_mudanca", "salvar_grade_revenda"]) expect(nomes).not.toContain(antigo);
    expect(r.etapasMarcadas).toEqual(["cad"]);
  });

  it("rev do card ausente (null) NÃO vira _rev_base null (sem trava no servidor): vira o P0409 sintético, nenhuma RPC sai", async () => {
    await montar();
    refs.rev.current = null;
    await act(async () => { await (api as any).mutateAsync(undefined).catch(() => {}); });
    await assentar();
    // o 1º ciclo falha ANTES da RPC; o retry do P0409 relê o card (rev 4) e recomeça com a trava certa
    expect(nucleos().every((c) => c.args._rev_base !== null)).toBe(true);
    expect(nucleos()[0]?.args._rev_base).toBe(4);
  });

  it("erro do núcleo: UMA mensagem 'nada foi gravado'; os passos de FORA (espelho PA/PI) NÃO rodam", async () => {
    await montar("revenda");
    h.respostasNucleo.push({ code: "P0001", message: "mao_obra_sem_permissao: editar criacao_planejamento e ver custos" });
    await act(async () => { await (api as any).mutateAsync(undefined).catch(() => {}); });
    await assentar();
    expect(nucleos()).toHaveLength(1);
    const msg = vi.mocked(toast.error).mock.calls[0][0] as string;
    expect(msg).toMatch(/^Não foi possível salvar o card — nada foi gravado\./);
    expect(msg).not.toMatch(/salvos, mas|o CAD não|M\.O\. não/);
    const nomes = h.log.map((c) => c.nome);
    expect(nomes).not.toContain("salvar_produto_acabado");
    expect(nomes).not.toContain("from:produtos_acabados");
  });

  it("P0409 do card: re-monta o payload e re-chama a RPC UMA vez com o rev NOVO (retry do merge)", async () => {
    await montar();
    h.respostasNucleo.push({ code: "P0409", message: "conflito_versao: card" }, null);
    await act(async () => { await (api as any).mutateAsync(undefined).catch(() => {}); });
    await assentar();
    expect(nucleos()).toHaveLength(2);
    expect(nucleos()[0].args._rev_base).toBe(3);
    expect(nucleos()[1].args._rev_base).toBe(4); // o rev lido do servidor no merge
    expect(nucleos()[1].args._header.nome).toBe("Vestido");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

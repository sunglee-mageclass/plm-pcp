// @vitest-environment happy-dom
// urg R2 T12 — fix round 1 (review a-task-12-review.md): H1 semente fresca, M1/M2 cadeia pós-criação, M3 validação antes do INSERT,
// M4 normalizador unificado + CASOS_APLICAR, L1/L2/L4.
import { readFileSync } from "node:fs";
import { createElement as h, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  normalizarInsumosPadrao,
  normalizarInsumosPadraoParaCard,
} from "@/lib/insumos-padrao-normalizadores";
import * as insumosIniciais from "@/lib/insumos-iniciais";
import { resumoToastLote, validarInsumosRascunho } from "@/lib/insumos-iniciais";
import {
  erroPosCriacao,
  executarPassosPosCriacao,
  falhasDoErro,
  garantirCardCriado,
  textoFalhasPosCriacao,
} from "@/lib/criacao-card-passos";
import { matchesTable, TENANT_CONFIG_EXTRA_KEYS } from "@/lib/realtime-invalidation-map";
import type { ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";
import { CASOS_APLICAR, CATALOGO_APLICAR, IP_IDS } from "../fixtures/insumos-padrao-casos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { E1, E2, C1 } = IP_IDS;

// ── M4 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("M4 — um módulo só para os 2 normalizadores; o 'para card' espelha o helper SQL (CASOS_APLICAR)", () => {
  const catalogo = Object.fromEntries(
    Object.entries(CATALOGO_APLICAR).map(([id, cores]) => [
      id,
      { variantes: cores.map((c) => ({ cor_id: c })) },
    ]),
  );
  for (const caso of CASOS_APLICAR) {
    it(`CASOS_APLICAR: ${caso.nome}`, () => {
      const r = normalizarInsumosPadraoParaCard(caso.entrada, catalogo);
      expect(r.linhas).toEqual(caso.esperado);
      expect(r.orfaos).toBe(caso.orfaos);
    });
  }
  it("o módulo exporta também o normalizador da Config; insumos-iniciais.ts NÃO tem mais uma cópia própria", () => {
    expect(typeof normalizarInsumosPadrao).toBe("function");
    const src = readFileSync("src/lib/insumos-iniciais.ts", "utf8");
    expect(src).not.toMatch(/export function normalizarInsumosPadraoParaCard\(/);
    // re-export para quem já importava de insumos-iniciais
    expect(insumosIniciais.normalizarInsumosPadraoParaCard).toBe(normalizarInsumosPadraoParaCard);
  });
  it("a Config segue mantendo id desconhecido (papéis diferentes, mesma casa)", () => {
    expect(
      normalizarInsumosPadrao([{ etiqueta_id: IP_IDS.E_OUTRA, cor_id: null, consumo: 1 }]),
    ).toHaveLength(1);
  });
});

// ── M3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const lin = (p: Partial<ModeloEtiquetaRow> = {}): ModeloEtiquetaRow => ({
  etiqueta_id: E1,
  cor_id: null,
  consumo: 1,
  loss_percent: 0,
  custo_previsto: 0,
  ...p,
});
describe("M3 — validarInsumosRascunho: tudo conferido ANTES do INSERT, com mensagem por campo", () => {
  it("rascunho bom => linhas do payload e nenhum problema", () => {
    const r = validarInsumosRascunho([lin({ cor_id: C1, consumo: 2.5, loss_percent: 10 })]);
    expect(r.problemas).toEqual([]);
    expect(r.linhas).toEqual([{ etiqueta_id: E1, cor_id: C1, consumo: 2.5, loss_percent: 10 }]);
  });
  it("limites inclusivos: consumo 0 e 9999, perda 0 e 100", () => {
    expect(
      validarInsumosRascunho([
        lin({ consumo: 0 }),
        lin({ etiqueta_id: E2, consumo: 9999, loss_percent: 100 }),
      ]).problemas,
    ).toEqual([]);
  });
  it("perda 120, consumo -1, consumo 10000 => uma mensagem por campo, citando o número do insumo", () => {
    expect(validarInsumosRascunho([lin({ loss_percent: 120 })]).problemas).toEqual([
      "Insumo 1: a perda precisa ficar entre 0 e 100.",
    ]);
    expect(
      validarInsumosRascunho([lin(), lin({ etiqueta_id: E2, consumo: -1 })]).problemas,
    ).toEqual(["Insumo 2: o consumo precisa ficar entre 0 e 9999."]);
    expect(validarInsumosRascunho([lin({ consumo: 10000 })]).problemas).toEqual([
      "Insumo 1: o consumo precisa ficar entre 0 e 9999.",
    ]);
  });
  it("casas decimais: consumo > 4 e perda > 2 são recusados (não arredonda calado)", () => {
    expect(validarInsumosRascunho([lin({ consumo: 1.00001 })]).problemas).toEqual([
      "Insumo 1: o consumo aceita no máximo 4 casas decimais.",
    ]);
    expect(validarInsumosRascunho([lin({ loss_percent: 1.005 })]).problemas).toEqual([
      "Insumo 1: a perda aceita no máximo 2 casas decimais.",
    ]);
    expect(
      validarInsumosRascunho([lin({ consumo: 1.1234, loss_percent: 99.99 })]).problemas,
    ).toEqual([]);
  });
  it("linha sem insumo: vazia some; com consumo/perda pede para escolher o insumo", () => {
    const vazia = lin({ etiqueta_id: null, consumo: 0, loss_percent: 0 });
    expect(validarInsumosRascunho([vazia]).linhas).toEqual([]);
    expect(validarInsumosRascunho([vazia]).problemas).toEqual([]);
    expect(validarInsumosRascunho([lin({ etiqueta_id: null, consumo: 3 })]).problemas).toEqual([
      "Insumo 1: escolha o insumo (ou remova a linha).",
    ]);
  });
  it("mais de 20 insumos => problema único; NaN também recusado", () => {
    const muitos = Array.from({ length: 21 }, () => lin());
    expect(validarInsumosRascunho(muitos).problemas).toEqual(["No máximo 20 insumos por card."]);
    expect(validarInsumosRascunho([lin({ consumo: NaN })]).problemas).toEqual([
      "Insumo 1: o consumo precisa ficar entre 0 e 9999.",
    ]);
  });
  it("handleSave valida ANTES do mutate (nenhum INSERT com valor que a RPC recusaria)", () => {
    const src = readFileSync(
      "src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts",
      "utf8",
    );
    const i = src.indexOf("const handleSave = ");
    const corpo = src.slice(i, i + 1500);
    expect(corpo).toContain("validarInsumosRascunho(");
    expect(corpo.indexOf("validarInsumosRascunho(")).toBeLessThan(corpo.indexOf("save.mutate("));
  });
});

// ── M1 + M2 + L4 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("M1/M2 — a cadeia pós-criação tenta TODOS os passos e junta as falhas", () => {
  it("passo que falha NÃO impede os seguintes; devolve as falhas na ordem", async () => {
    const ordem: string[] = [];
    const falhas = await executarPassosPosCriacao([
      {
        etapa: "tecidos",
        run: async () => {
          ordem.push("tecidos");
          throw new Error("t");
        },
      },
      {
        etapa: "insumos",
        run: async () => {
          ordem.push("insumos");
        },
      },
      {
        etapa: "mo",
        run: async () => {
          ordem.push("mo");
          throw new Error("m");
        },
      },
    ]);
    expect(ordem).toEqual(["tecidos", "insumos", "mo"]);
    expect(falhas.map((f) => f.etapa)).toEqual(["tecidos", "mo"]);
  });
  it("tudo certo => sem falhas; erroPosCriacao carrega etapaFalha e a lista", () => {
    const e = erroPosCriacao([
      { etapa: "insumos", erro: new Error("x") },
      { etapa: "mo", erro: new Error("y") },
    ]);
    expect((e as any).etapaFalha).toBe("insumos");
    expect(falhasDoErro(e).map((f) => f.etapa)).toEqual(["insumos", "mo"]);
    // erro "solto" de uma etapa (formato antigo) continua entendido
    expect(falhasDoErro(Object.assign(new Error("z"), { etapaFalha: "preco" }))).toEqual([]);
    expect(
      falhasDoErro(Object.assign(new Error("z"), { etapaFalha: "grade" })).map((f) => f.etapa),
    ).toEqual(["grade"]);
  });
  const motivo = (e: unknown) => (e instanceof Error ? e.message : "?");
  const f = (etapa: any, m = "motivo") => ({ etapa, erro: new Error(m) });
  it("textos de UMA etapa: mo / tecidos / grade como antes; insumos com o motivo", () => {
    const o = { podeEditarDev: true, motivo };
    expect(textoFalhasPosCriacao([f("mo")], o)).toBe(
      "O card foi criado, mas a mão de obra NÃO foi salva — confira e salve de novo.",
    );
    expect(textoFalhasPosCriacao([f("grade")], o)).toBe(
      "O card foi criado, mas a grade NÃO foi salva — confira e salve de novo.",
    );
    expect(textoFalhasPosCriacao([f("tecidos")], o)).toMatch(
      /os tecidos NÃO foram para a Ficha \(BOM\).*salve o card de novo/,
    );
    expect(textoFalhasPosCriacao([f("tecidos")], { ...o, podeEditarDev: false })).toMatch(
      /Peça a quem edita o Desenvolvimento/,
    );
    expect(textoFalhasPosCriacao([f("insumos", "o insumo não existe mais no cadastro.")], o)).toBe(
      "O card foi criado, mas os insumos NÃO foram salvos — o insumo não existe mais no cadastro. Adicione-os na seção Insumos do card.",
    );
  });
  it("texto de VÁRIAS etapas: nomeia cada uma e dá o motivo de cada", () => {
    const t = textoFalhasPosCriacao([f("tecidos", "a"), f("insumos", "b"), f("mo", "c")], {
      podeEditarDev: true,
      motivo,
    });
    expect(t).toContain(
      "O card foi criado, mas NÃO foram salvos: tecidos (Ficha/BOM), insumos e mão de obra.",
    );
    expect(t).toContain("Insumos — b");
    expect(t).toContain("Mão de obra — c");
    expect(t).toContain("Tecidos — a");
    expect(t).toMatch(/refaça o que faltou/);
  });
  it("L4 — retry/2º clique NÃO cria de novo: garantirCardCriado insere 1× e os passos só rodam quando criadoAgora", async () => {
    const ref = { current: null as string | null };
    const inserir = vi.fn().mockResolvedValue("card-1");
    const passo = vi.fn().mockResolvedValue(undefined);
    const rodar = async () => {
      const { id, criadoAgora } = await garantirCardCriado(ref, inserir);
      if (criadoAgora) await executarPassosPosCriacao([{ etapa: "insumos", run: passo }]);
      return id;
    };
    expect(await rodar()).toBe("card-1");
    expect(await rodar()).toBe("card-1"); // retry (ex.: depois de um erro numa etapa seguinte)
    expect(await rodar()).toBe("card-1");
    expect(inserir).toHaveBeenCalledTimes(1);
    expect(passo).toHaveBeenCalledTimes(1);
  });
  it("INSERT que falha não marca o card como criado (o retry tenta inserir de novo)", async () => {
    const ref = { current: null as string | null };
    const inserir = vi
      .fn()
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce("card-2");
    await expect(garantirCardCriado(ref, inserir)).rejects.toThrow("rede");
    expect(ref.current).toBeNull();
    expect((await garantirCardCriado(ref, inserir)).criadoAgora).toBe(true);
  });
  it("usePlanejamentoSave: usa o orquestrador, junta as falhas e lança UMA vez no fim (antes do return)", () => {
    const src = readFileSync(
      "src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts",
      "utf8",
    );
    expect(src).toContain("garantirCardCriado(");
    expect(src).toContain("executarPassosPosCriacao(");
    expect(src).toContain("erroPosCriacao(");
    expect(src).toContain("textoFalhasPosCriacao(");
    expect(src.indexOf("erroPosCriacao(")).toBeGreaterThan(
      src.indexOf("executarPassosPosCriacao("),
    );
    // o insumos NÃO depende do sucesso dos tecidos: são dois passos independentes do mesmo array
    expect(src).toMatch(/etapa: "tecidos"[\s\S]{0,400}etapa: "insumos"/);
  });
});

// ── L1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("L1 — o resumo do 'Criar vários cards' diz quantos insumos padrão ficaram de fora", () => {
  it("sucesso com órfãos => aviso (warning) com a contagem", () => {
    expect(resumoToastLote(3, 3, 0, true, 2)).toEqual({
      tipo: "warning",
      texto:
        "3 cards criados, com os insumos padrão da loja — 2 insumos padrão não existem mais no cadastro e ficaram de fora.",
    });
    expect(resumoToastLote(1, 1, 0, true, 1).texto).toContain(
      "1 insumo padrão não existe mais no cadastro e ficou de fora.",
    );
  });
  it("falha parcial + órfãos => os dois avisos", () => {
    const r = resumoToastLote(2, 1, 1, true, 1);
    expect(r.tipo).toBe("warning");
    expect(r.texto).toContain("em 1 deles");
    expect(r.texto).toContain("ficou de fora");
  });
  it("sem órfãos o texto é o de antes", () => {
    expect(resumoToastLote(3, 3, 0, true, 0)).toEqual({
      tipo: "success",
      texto: "3 cards criados, com os insumos padrão da loja",
    });
    expect(resumoToastLote(3, 0, 0, false, 0)).toEqual({
      tipo: "success",
      texto: "3 cards criados",
    });
  });
  it("BatchCardsDialog passa a contagem de órfãos ao resumo", () => {
    const src = readFileSync("src/routes/_authenticated/criacao.planejamento.tsx", "utf8");
    expect(src.slice(src.indexOf("function BatchCardsDialog"))).toMatch(/orfaos/);
  });
});

// ── H1 + L2 (comportamento do hook com cache velho) ────────────────────────────────────────────────────────────────
const hoisted = vi.hoisted(() => ({
  estado: {
    // lista crua devolvida pelo "servidor" e controle de latência/erro
    raw: [] as unknown,
    etiquetas: [] as any[],
    falhar: false,
    espera: null as null | Promise<void>,
    chamadas: 0,
  },
}));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/integrations/supabase/client", () => {
  const resultado = (tabela: string) =>
    (async () => {
      hoisted.estado.chamadas += 1;
      if (hoisted.estado.espera) await hoisted.estado.espera;
      if (hoisted.estado.falhar) return { data: null, error: { message: "Failed to fetch" } };
      return tabela === "tenant_config"
        ? { data: { insumos_padrao: hoisted.estado.raw }, error: null }
        : { data: hoisted.estado.etiquetas, error: null };
    })();
  const cadeia = (tabela: string): any => {
    const c: any = {
      select: () => c,
      eq: () => c,
      order: () => c,
      maybeSingle: () => resultado(tabela),
      then: (ok: any, ko: any) => resultado(tabela).then(ok, ko),
    };
    return c;
  };
  return { supabase: { from: (t: string) => cadeia(t) } };
});

const etqDb = (id: string, cores: string[] = []) => ({
  id,
  nome: `ETQ ${id.slice(-3)}`,
  formato_tamanho: "nenhum",
  preco: 2,
  tamanho_vinculado: null,
  variantes_etiqueta: cores.map((c) => ({
    cor_id: c,
    preco: null,
    tamanho: null,
    cor: { nome: "cor" },
  })),
});
const lista = (...ids: string[]) =>
  ids.map((id) => ({ etiqueta_id: id, cor_id: null, consumo: 1 }));

async function montar(qc: QueryClient) {
  const { createRoot } = await import("react-dom/client");
  const { useInsumosNovosRascunho } =
    await import("@/components/planejamento/planejamento-detail/useInsumosPadrao");
  const vista: { atual: ReturnType<typeof useInsumosNovosRascunho> | null } = { atual: null };
  function Sonda() {
    vista.atual = useInsumosNovosRascunho(true);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(QueryClientProvider, { client: qc }, h(Sonda)));
  });
  return {
    vista,
    desmontar: () =>
      act(async () => {
        root.unmount();
        container.remove();
      }),
  };
}
const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe("H1 — o rascunho do '+ Novo' só nasce de uma leitura FEITA DEPOIS de abrir", () => {
  beforeEach(() => {
    hoisted.estado.raw = [];
    hoisted.estado.etiquetas = [];
    hoisted.estado.falhar = false;
    hoisted.estado.espera = null;
    hoisted.estado.chamadas = 0;
  });
  const novoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it("cache velho com a lista ANTIGA + servidor com a NOVA => o rascunho é a NOVA (nunca a velha)", async () => {
    const qc = novoQc();
    // cache da abertura anterior: lista velha com o insumo E1
    qc.setQueryData(["planejamento-insumos-padrao", "t1"], {
      raw: lista(E1),
      etiquetas: [{ id: E1, nome: "VELHO", formato_tamanho: "nenhum", preco: 1, variantes: [] }],
    });
    hoisted.estado.raw = lista(E2);
    hoisted.estado.etiquetas = [etqDb(E1), etqDb(E2)];
    let liberar!: () => void;
    hoisted.estado.espera = new Promise<void>((r) => {
      liberar = r;
    });
    const v = await montar(qc);
    // enquanto a leitura nova não chega: carregando, SEM semear do cache
    expect(v.vista.atual!.padrao.carregando).toBe(true);
    expect(v.vista.atual!.padrao.carregado).toBe(false);
    expect(v.vista.atual!.rows).toEqual([]);
    liberar();
    await assentar();
    expect(v.vista.atual!.padrao.carregando).toBe(false);
    expect(v.vista.atual!.rows.map((r) => r.etiqueta_id)).toEqual([E2]);
    expect(v.vista.atual!.dirty).toBe(false);
    await v.desmontar();
  });

  it("a leitura nova FALHA com cache velho presente => não semeia do velho; erro + trava; 'Tentar de novo' recupera", async () => {
    const qc = novoQc();
    qc.setQueryData(["planejamento-insumos-padrao", "t1"], {
      raw: lista(E1),
      etiquetas: [{ id: E1, nome: "VELHO", formato_tamanho: "nenhum", preco: 1, variantes: [] }],
    });
    hoisted.estado.falhar = true;
    const v = await montar(qc);
    await assentar();
    expect(v.vista.atual!.padrao.erro).toBe(true);
    expect(v.vista.atual!.padrao.carregando).toBe(false);
    expect(v.vista.atual!.rows).toEqual([]);
    hoisted.estado.falhar = false;
    hoisted.estado.raw = lista(E2);
    hoisted.estado.etiquetas = [etqDb(E2)];
    await act(async () => {
      v.vista.atual!.padrao.tentarDeNovo();
    });
    await assentar();
    expect(v.vista.atual!.padrao.erro).toBe(false);
    expect(v.vista.atual!.rows.map((r) => r.etiqueta_id)).toEqual([E2]);
    await v.desmontar();
  });

  it("L2 — refetch de FUNDO que falha depois de semeado NÃO esconde o editor nem trava o Salvar; a edição da pessoa fica", async () => {
    const qc = novoQc();
    hoisted.estado.raw = lista(E1);
    hoisted.estado.etiquetas = [etqDb(E1)];
    const v = await montar(qc);
    await assentar();
    expect(v.vista.atual!.rows).toHaveLength(1);
    await act(async () => {
      v.vista.atual!.setRows((rs) => [
        ...rs,
        { etiqueta_id: null, cor_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 },
      ]);
    });
    expect(v.vista.atual!.dirty).toBe(true);
    hoisted.estado.falhar = true;
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["planejamento-insumos-padrao", "t1"] });
    });
    await assentar();
    expect(v.vista.atual!.padrao.erro).toBe(false);
    expect(v.vista.atual!.padrao.carregando).toBe(false);
    expect(v.vista.atual!.padrao.carregado).toBe(true);
    expect(v.vista.atual!.rows).toHaveLength(2);
    await v.desmontar();
  });

  it("lista da loja com lixo/órfão não derruba: semeia só o que serve e conta o órfão", async () => {
    const qc = novoQc();
    hoisted.estado.raw = [...lista(E1), ...lista(IP_IDS.E_OUTRA), "x", null, { etiqueta_id: 5 }];
    hoisted.estado.etiquetas = [etqDb(E1)];
    const v = await montar(qc);
    await assentar();
    expect(v.vista.atual!.rows.map((r) => r.etiqueta_id)).toEqual([E1]);
    expect(v.vista.atual!.padrao.orfaos).toBe(1);
    await v.desmontar();
  });
});

describe("H1 — salvar a Config da Loja (ou um insumo) marca a lista como velha", () => {
  it("a key está em TENANT_CONFIG_EXTRA_KEYS e casa com o predicate de tenant_config e de etiquetas", () => {
    expect(TENANT_CONFIG_EXTRA_KEYS).toContain("planejamento-insumos-padrao");
    const k = ["planejamento-insumos-padrao", "t1"] as const;
    expect(matchesTable("tenant_config", k as any)).toBe(true);
    expect(matchesTable("etiquetas", k as any)).toBe(true);
  });
  it("o hook usa refetchOnMount 'always' (leitura fresca a cada abertura)", () => {
    const src = readFileSync(
      "src/components/planejamento/planejamento-detail/useInsumosPadrao.ts",
      "utf8",
    );
    expect(src).toMatch(/refetchOnMount:\s*"always"/);
    expect(src).toContain("isFetchedAfterMount");
  });
});

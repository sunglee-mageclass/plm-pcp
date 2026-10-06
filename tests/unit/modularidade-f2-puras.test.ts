// [modularidade F2, parte 3] Funções puras da F2: página × módulo desligado (editor de permissões), o que o Importar oferece
// e quais blocos da Config da Loja aparecem por módulo.
import { describe, it, expect } from "vitest";
import { PAGES_CATALOG, ALL_PAGE_KEYS, paginaComModuloDesligado, modulosDesligadosDaPagina } from "@/lib/permissions-catalog";
import { resolverModulos } from "@/hooks/useTenantModules";
import { entidadeOferecida, descritoresOferecidos } from "@/lib/import/oferta";
import { DESCRIPTORS } from "@/lib/import/registry";
import { blocosConfigVisiveis } from "@/lib/config-loja-blocos";

const COMPLETO = resolverModulos({ otb: true, produto_acabado: true, produto_importado: true, etapas_pl: true, distribuicao: true });

describe("paginaComModuloDesligado", () => {
  it("loja com tudo ligado: nenhuma página esmaecida", () => {
    expect(ALL_PAGE_KEYS.filter((k) => paginaComModuloDesligado(k, COMPLETO))).toEqual([]);
  });

  it("módulos ainda não carregados (null) = nada esmaecido", () => {
    expect(ALL_PAGE_KEYS.filter((k) => paginaComModuloDesligado(k, null))).toEqual([]);
  });

  it("sem Entrada e Saída: as páginas do módulo e a Explosão (gate criacao dentro de E&S) ficam desligadas", () => {
    const m = { ...COMPLETO, entrada_saida: false };
    const mod = PAGES_CATALOG.find((x) => x.module === "entrada_saida")!;
    for (const p of mod.pages) expect(paginaComModuloDesligado(p.key, m), p.key).toBe(true);
    expect(paginaComModuloDesligado("producao_explosao", m)).toBe(true);
    // outros módulos não são afetados
    expect(paginaComModuloDesligado("otb", m)).toBe(false);
    expect(paginaComModuloDesligado("criacao_desenvolvimento", m)).toBe(false);
  });

  it("gate da PRÓPRIA página: Plan. Tecido sem OTB (Criação ligada) e Explosão sem Criação (E&S ligada)", () => {
    expect(modulosDesligadosDaPagina("criacao_plan_tecido", { ...COMPLETO, otb: false })).toEqual(["otb"]);
    expect(modulosDesligadosDaPagina("producao_explosao", { ...COMPLETO, criacao: false })).toEqual(["criacao"]);
    expect(modulosDesligadosDaPagina("criacao_plan_tecido", COMPLETO)).toEqual([]);
  });

  it("seção herda a página-mãe (esmaece junto)", () => {
    const m = { ...COMPLETO, criacao: false };
    expect(paginaComModuloDesligado("criacao_desenvolvimento", m)).toBe(true);
    expect(paginaComModuloDesligado("criacao_desenvolvimento:custos", m)).toBe(true);
    expect(paginaComModuloDesligado("criacao_desenvolvimento:custos", COMPLETO)).toBe(false);
  });

  it("Produção desligada esmaece PCP e Expedição (módulos com gate producao) e Etapas PL", () => {
    const m = { ...COMPLETO, producao: false };
    for (const mod of PAGES_CATALOG.filter((x) => x.gate === "producao")) {
      for (const p of mod.pages) {
        // exceção documentada: aprovação de M.O. segue editável sem Produção
        expect(paginaComModuloDesligado(p.key, m), p.key).toBe(p.key !== "producao_servico_aprovacao");
      }
    }
  });

  it("Aprovação de mão de obra (soEdicao) NUNCA fica esmaecida", () => {
    expect(paginaComModuloDesligado("producao_servico_aprovacao", { ...COMPLETO, producao: false })).toBe(false);
  });

  it("chave de módulo fora de ModuleKey (importar, integracao) nunca conta como desligada", () => {
    const tudoOff = resolverModulos(Object.fromEntries(Object.keys(COMPLETO).map((k) => [k, false])));
    expect(paginaComModuloDesligado("importar", tudoOff)).toBe(false);
    expect(paginaComModuloDesligado("integracao", tudoOff)).toBe(false);
  });

  it("todo módulo de topo e toda gate do catálogo é chave conhecida ou das 3 exceções (importar/integracao/pcp-expedicao via gate)", () => {
    const conhecidas = new Set(Object.keys(COMPLETO));
    for (const m of PAGES_CATALOG) {
      const chave = m.gate ?? m.module;
      expect(conhecidas.has(chave) || ["importar", "integracao"].includes(chave), `${m.module} -> ${chave}`).toBe(true);
      for (const p of m.pages) if (p.gate) expect(conhecidas.has(p.gate), `${p.key} gate ${p.gate}`).toBe(true);
    }
  });
});

describe("Importar: o que a loja tem", () => {
  const base = { cadastro: true, entrada_saida: true };
  it("tecido, aviamento e insumo sempre; modelo só com Criação; produto só com PA OU PI", () => {
    const so = (m: Parameters<typeof descritoresOferecidos>[1]) => descritoresOferecidos(DESCRIPTORS, m).map((d) => d.entidade);
    expect(so({ ...base })).toEqual(["tecido", "aviamento", "insumo"]);
    expect(so({ ...base, criacao: true })).toEqual(["tecido", "aviamento", "insumo", "modelo"]);
    expect(so({ ...base, produto_acabado: true })).toEqual(["tecido", "aviamento", "insumo", "produto"]);
    expect(so({ ...base, produto_importado: true })).toEqual(["tecido", "aviamento", "insumo", "produto"]);
    expect(so({ ...base, criacao: true, produto_acabado: true, produto_importado: true })).toEqual(DESCRIPTORS.map((d) => d.entidade));
  });
  it("entidadeOferecida isolada", () => {
    expect(entidadeOferecida("modelo", { criacao: false })).toBe(false);
    expect(entidadeOferecida("modelo", { criacao: true })).toBe(true);
    expect(entidadeOferecida("produto", {})).toBe(false);
    expect(entidadeOferecida("tecido", {})).toBe(true);
  });
  it("a ordem dos descritores oferecidos preserva a de DESCRIPTORS (dependências primeiro)", () => {
    const todos = descritoresOferecidos(DESCRIPTORS, { criacao: true, produto_acabado: true }).map((d) => d.entidade);
    expect(todos).toEqual(DESCRIPTORS.map((d) => d.entidade));
  });
});

describe("blocosConfigVisiveis", () => {
  const completo = { cadastro: true, entrada_saida: true, criacao: true, producao: true, financeiro: true, dashboard: true };
  it("loja completa (sem opt-ins): Kanban, Envio à Explosão e REF; Revenda/Etapas PL só com a chave", () => {
    expect(blocosConfigVisiveis(completo, false)).toEqual({ statusKanban: true, envioExplosao: true, formatoRef: true, fluxoRevenda: false, etapasPl: false });
  });
  it("opt-ins: Fluxo de Revenda com produto_acabado; Etapas PL com etapas_pl", () => {
    expect(blocosConfigVisiveis({ ...completo, produto_acabado: true, etapas_pl: true }, false)).toMatchObject({ fluxoRevenda: true, etapasPl: true });
  });
  it("sem Criação: some Kanban, REF, Envio à Explosão e Revenda (mesmo com PA ligado)", () => {
    expect(blocosConfigVisiveis({ ...completo, criacao: false, produto_acabado: true }, false)).toMatchObject({
      statusKanban: false, envioExplosao: false, formatoRef: false, fluxoRevenda: false,
    });
  });
  it("sem Entrada e Saída: segue o Kanban/REF, só o Envio à Explosão some", () => {
    expect(blocosConfigVisiveis({ ...completo, entrada_saida: false }, false)).toMatchObject({ statusKanban: true, formatoRef: true, envioExplosao: false });
  });
  it("sem Produção: Etapas PL some (mesmo com etapas_pl ligada); o Kanban fica", () => {
    expect(blocosConfigVisiveis({ ...completo, producao: false, etapas_pl: true }, false)).toMatchObject({ etapasPl: false, statusKanban: true });
  });
  it("modo só-estoque continua escondendo tudo", () => {
    expect(blocosConfigVisiveis({ cadastro: true, entrada_saida: true, criacao: true, produto_acabado: true, producao: true, etapas_pl: true }, true))
      .toEqual({ statusKanban: false, envioExplosao: false, formatoRef: false, fluxoRevenda: false, etapasPl: false });
  });
});

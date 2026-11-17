import { describe, it, expect } from "vitest";
import { montarEstruturaManual, type ModuloManual } from "@/lib/manual/estrutura";
import { resolverModulos } from "@/hooks/useTenantModules";

// Usa o PAGES_CATALOG REAL (SSOT) via montarEstruturaManual — nada de catálogo fake.
// `modules` entra JÁ RESOLVIDO (como o useTenantModules entrega), via resolverModulos.

/** Permissão que libera TODAS as páginas (usuário que vê tudo). */
const veTudo = () => true;

/** Acha um módulo por key no resultado. */
const mod = (arvore: ModuloManual[], key: string) => arvore.find((m) => m.moduleKey === key);
/** Todas as pageKeys visíveis (flat). */
const pageKeys = (arvore: ModuloManual[]) => arvore.flatMap((m) => m.telas.map((t) => t.pageKey));

describe("montarEstruturaManual", () => {
  it("loja padrão traz os módulos default ON e esconde os opt-in", () => {
    const arvore = montarEstruturaManual({
      modules: resolverModulos(null), // só os DEFAULTS
      isStockOnly: false,
      criacaoLigada: true,
      podeVer: veTudo,
    });
    // Os 6 módulos de topo default ON aparecem; OTB (opt-in) não.
    expect(mod(arvore, "cadastro")).toBeTruthy();
    expect(mod(arvore, "entrada_saida")).toBeTruthy();
    expect(mod(arvore, "criacao")).toBeTruthy();
    expect(mod(arvore, "financeiro")).toBeTruthy();
    expect(mod(arvore, "dashboard")).toBeTruthy();
    expect(mod(arvore, "otb")).toBeFalsy();
  });

  it("loja só-estoque esconde telas modes:['full'] e mostra modes:['stock']", () => {
    // Só-estoque = só cadastro + entrada_saida ligados.
    const modules = resolverModulos({
      cadastro: true,
      entrada_saida: true,
      criacao: false,
      producao: false,
      financeiro: false,
      dashboard: false,
    });
    const arvore = montarEstruturaManual({
      modules,
      isStockOnly: true,
      criacaoLigada: false,
      podeVer: veTudo,
    });
    const keys = pageKeys(arvore);
    // modes:["stock"] aparecem (OS Tecido/Aviamento, Destinos)
    expect(keys).toContain("entrada_os_tecido");
    expect(keys).toContain("entrada_os_aviamento");
    expect(keys).toContain("cadastro_destinos");
    // modes:["full"] somem (Insumos, OC Insumo, Explosão, Lojas do Direcionamento)
    expect(keys).not.toContain("cadastro_etiquetas");
    expect(keys).not.toContain("entrada_oc_insumo");
    expect(keys).not.toContain("producao_explosao");
    expect(keys).not.toContain("cadastro_lojas");
  });

  it("módulo desligado (otb:false) tira a página com gate:'otb' (Plan. Tecido)", () => {
    const modules = resolverModulos({ otb: false }); // criacao ON (default), otb OFF
    const arvore = montarEstruturaManual({
      modules,
      isStockOnly: false,
      criacaoLigada: true,
      podeVer: veTudo,
    });
    // Plan. Tecido (gate otb) some; o módulo criacao segue com outras telas.
    expect(pageKeys(arvore)).not.toContain("criacao_plan_tecido");
    expect(mod(arvore, "criacao")).toBeTruthy();
  });

  it("com otb ligado a página gate:'otb' aparece", () => {
    const modules = resolverModulos({ otb: true });
    const arvore = montarEstruturaManual({
      modules,
      isStockOnly: false,
      criacaoLigada: true,
      podeVer: veTudo,
    });
    expect(pageKeys(arvore)).toContain("criacao_plan_tecido");
  });

  it("podeVer que nega uma pageKey remove a tela", () => {
    const base = {
      modules: resolverModulos(null),
      isStockOnly: false,
      criacaoLigada: true,
    };
    const comTudo = montarEstruturaManual({ ...base, podeVer: veTudo });
    expect(pageKeys(comTudo)).toContain("criacao_planejamento");

    const semPlanejamento = montarEstruturaManual({
      ...base,
      podeVer: (k) => k !== "criacao_planejamento",
    });
    expect(pageKeys(semPlanejamento)).not.toContain("criacao_planejamento");
    // As outras telas do mesmo módulo continuam.
    expect(pageKeys(semPlanejamento)).toContain("criacao_desenvolvimento");
  });

  it("não inclui permissões-só (soEdicao) e copia as seções da tela", () => {
    const arvore = montarEstruturaManual({
      modules: resolverModulos(null),
      isStockOnly: false,
      criacaoLigada: true,
      podeVer: veTudo,
    });
    // producao_servico_aprovacao é soEdicao → nunca vira tela.
    expect(pageKeys(arvore)).not.toContain("producao_servico_aprovacao");
    // Planejamento tem seções (Custos, preço de venda, Peça Teste).
    const plan = arvore
      .flatMap((m) => m.telas)
      .find((t) => t.pageKey === "criacao_planejamento");
    expect(plan).toBeTruthy();
    expect(plan!.seroes.length).toBeGreaterThan(0);
    expect(plan!.seroes.map((s) => s.key)).toContain("criacao_planejamento:custos");
    // URL e módulo resolvidos.
    expect(plan!.url).toBe("/criacao/planejamento");
    expect(plan!.moduloKey).toBe("criacao");
    expect(plan!.moduloDesligado).toBe(false);
  });
});

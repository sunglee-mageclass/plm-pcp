// [modularidade F1, parte 11, P-256 A] Perfil da loja: sem Criação, OS Tecido / OS Aviamento / Destinos ficam mesmo com
// Financeiro/Dashboard ligados. As páginas "full" seguem exatamente como hoje.
import { describe, it, expect } from "vitest";
import { PAGES_CATALOG, pageInProfile, paginaNoPerfil, type PageDef } from "@/lib/permissions-catalog";

const PAGINAS: PageDef[] = PAGES_CATALOG.flatMap((m) => m.pages);
const SO_ESTOQUE = ["cadastro_destinos", "entrada_os_tecido", "entrada_os_aviamento"];

type Mods = Partial<Record<"cadastro" | "entrada_saida" | "criacao" | "producao" | "financeiro" | "dashboard", boolean>>;
// Reproduz a regra de `isStockOnly` do useTenantModules (só Cadastro + E&S ligados).
const stockOnly = (m: Mods) => !!m.cadastro && !!m.entrada_saida && !m.criacao && !m.producao && !m.financeiro && !m.dashboard;
const visiveis = (m: Mods) =>
  PAGINAS.filter((p) => paginaNoPerfil(p, { isStockOnly: stockOnly(m), criacaoLigada: !!m.criacao })).map((p) => p.key);

const BASE: Mods = { cadastro: true, entrada_saida: true };
const COMBOS: Record<string, Mods> = {
  "só estoque": { ...BASE },
  "estoque + financeiro": { ...BASE, financeiro: true },
  "estoque + dashboard": { ...BASE, dashboard: true },
  "estoque + financeiro + dashboard": { ...BASE, financeiro: true, dashboard: true },
  "Criação off com Produção on": { ...BASE, producao: true },
  "completo": { ...BASE, criacao: true, producao: true, financeiro: true, dashboard: true },
  "Criação on sem E&S": { cadastro: true, criacao: true, dashboard: true },
};

describe("paginaNoPerfil — matriz P-256 A", () => {
  it("as páginas só-estoque são exatamente OS Tecido, OS Aviamento e Destinos", () => {
    expect(PAGINAS.filter((p) => p.modes?.length === 1 && p.modes[0] === "stock").map((p) => p.key).sort()).toEqual([...SO_ESTOQUE].sort());
  });

  it.each(Object.entries(COMBOS))("%s: OS/Destinos visíveis SSE a loja não tem Criação", (_nome, mods) => {
    const v = visiveis(mods);
    for (const k of SO_ESTOQUE) expect(v.includes(k), k).toBe(!mods.criacao);
  });

  it.each(Object.entries(COMBOS))("%s: as demais páginas seguem pageInProfile como hoje", (_nome, mods) => {
    const so = stockOnly(mods);
    for (const p of PAGINAS.filter((x) => !SO_ESTOQUE.includes(x.key))) {
      expect(paginaNoPerfil(p, { isStockOnly: so, criacaoLigada: !!mods.criacao }), p.key).toBe(pageInProfile(p, so ? "stock" : "full"));
    }
  });

  it("loja completa: tudo igual a pageInProfile(p, 'full') (nada muda para quem tem Criação)", () => {
    for (const p of PAGINAS) {
      expect(paginaNoPerfil(p, { isStockOnly: false, criacaoLigada: true }), p.key).toBe(pageInProfile(p, "full"));
    }
  });

  it("só estoque estrito: igual a pageInProfile(p, 'stock') para TODAS (comportamento de sempre)", () => {
    for (const p of PAGINAS) {
      expect(paginaNoPerfil(p, { isStockOnly: true, criacaoLigada: false }), p.key).toBe(pageInProfile(p, "stock"));
    }
  });

  it("estoque + financeiro: páginas 'full' continuam visíveis (Insumos, Alertas…) além de OS/Destinos", () => {
    const v = visiveis(COMBOS["estoque + financeiro"]);
    for (const k of ["cadastro_etiquetas", "entrada_alertas_tecido", "entrada_oc_insumo", "financeiro_resumo"]) expect(v).toContain(k);
    for (const k of SO_ESTOQUE) expect(v).toContain(k);
  });

  it("página sem `modes` ou com os dois perfis aparece sempre", () => {
    const livre: PageDef = { key: "x", label: "X" };
    const ambos: PageDef = { key: "y", label: "Y", modes: ["full", "stock"] };
    for (const ctx of [{ isStockOnly: true, criacaoLigada: false }, { isStockOnly: false, criacaoLigada: false }, { isStockOnly: false, criacaoLigada: true }]) {
      expect(paginaNoPerfil(livre, ctx)).toBe(true);
      expect(paginaNoPerfil(ambos, ctx)).toBe(true);
    }
  });
});

import { describe, it, expect, vi } from "vitest";
import { SEM_ID, setParaIds, idsParaSet, montarFiltrosPlanTecido } from "@/lib/plan-tecido/filtro-painel";

const base = () => ({
  status: "sem_reprovado" as const,
  onStatus: vi.fn(),
  linhas: [{ id: "L1", nome: "Verao", n: 3 }, { id: "L2", nome: "Inverno", n: 1 }],
  semLinha: { n: 2 },
  filtroLinhas: new Set<string | null>(),
  onFiltroLinhas: vi.fn(),
  mostrarCategorias: true,
  cats: ["C1", "C2"],
  catNome: (id: string) => `Cat ${id}`,
  contagem: (id: string | null) => (id === null ? 4 : 5),
  temSemCategoria: true,
  catFilters: new Set<string | null>(),
  onCatFilters: vi.fn(),
});

describe("adaptador set<->ids do painel compartilhado (F2 filtrar-painel)", () => {
  it("null (Sem linha/Sem categoria) vira SEM_ID e volta", () => {
    const ids = setParaIds(new Set<string | null>(["L1", null]));
    expect(ids.sort()).toEqual(["L1", SEM_ID].sort());
    const s = idsParaSet(ids);
    expect(s.has(null)).toBe(true);
    expect(s.has("L1")).toBe(true);
    expect(s.has(SEM_ID)).toBe(false);
    expect(s.size).toBe(2);
  });
  it("vazio <-> vazio", () => {
    expect(setParaIds(new Set())).toEqual([]);
    expect(idsParaSet([]).size).toBe(0);
  });
});

describe("montarFiltrosPlanTecido", () => {
  it("monta Status (single, default sem_reprovado), Linha e Categoria (multi) nessa ordem", () => {
    const f = montarFiltrosPlanTecido(base());
    expect(f.map((x) => x.label)).toEqual(["Status", "Linha", "Categoria de tecido"]);
    const [st, ln, ct] = f;
    expect(st.single).toBe(true);
    if (st.single) {
      expect(st.value).toBe("sem_reprovado");
      expect(st.emptyValue).toBe("sem_reprovado");
      expect(st.options.map((o) => o.id)).toEqual(["sem_reprovado", "todos"]);
    }
    expect(ln.single).toBeFalsy();
    expect(ct.single).toBeFalsy();
  });

  it("opcoes de Linha levam contagem e 'Sem linha' (SEM_ID) so quando semLinha", () => {
    const [, ln] = montarFiltrosPlanTecido(base());
    expect(ln.options).toEqual([
      { id: "L1", nome: "Verao (3)" },
      { id: "L2", nome: "Inverno (1)" },
      { id: SEM_ID, nome: "Sem linha (2)" },
    ]);
    const sem = montarFiltrosPlanTecido({ ...base(), semLinha: null }).find((x) => x.label === "Linha")!;
    expect(sem.options.map((o) => o.id)).toEqual(["L1", "L2"]);
  });

  it("opcoes de Categoria levam contagem e 'Sem categoria' so quando temSemCategoria", () => {
    const ct = montarFiltrosPlanTecido(base()).find((x) => x.label === "Categoria de tecido")!;
    expect(ct.options).toEqual([
      { id: "C1", nome: "Cat C1 (5)" },
      { id: "C2", nome: "Cat C2 (5)" },
      { id: SEM_ID, nome: "Sem categoria (4)" },
    ]);
    const sem = montarFiltrosPlanTecido({ ...base(), temSemCategoria: false }).find((x) => x.label === "Categoria de tecido")!;
    expect(sem.options.map((o) => o.id)).toEqual(["C1", "C2"]);
  });

  it("omite Linha sem opcoes e Categoria quando mostrarCategorias=false ou sem opcoes", () => {
    const a = montarFiltrosPlanTecido({ ...base(), linhas: [], semLinha: null });
    expect(a.map((x) => x.label)).toEqual(["Status", "Categoria de tecido"]);
    const b = montarFiltrosPlanTecido({ ...base(), mostrarCategorias: false });
    expect(b.map((x) => x.label)).toEqual(["Status", "Linha"]);
    const c = montarFiltrosPlanTecido({ ...base(), cats: [], temSemCategoria: false });
    expect(c.map((x) => x.label)).toEqual(["Status", "Linha"]);
  });

  it("valor dos multi reflete o Set (null -> SEM_ID) e onChange devolve Set com null", () => {
    const p = base();
    p.filtroLinhas = new Set<string | null>(["L1", null]);
    p.catFilters = new Set<string | null>(["C2"]);
    const f = montarFiltrosPlanTecido(p);
    const ln = f.find((x) => x.label === "Linha")!;
    const ct = f.find((x) => x.label === "Categoria de tecido")!;
    expect((ln.value as string[]).sort()).toEqual(["L1", SEM_ID].sort());
    expect(ct.value).toEqual(["C2"]);
    (ln.onChange as (v: string[]) => void)([SEM_ID]);
    const arg = p.onFiltroLinhas.mock.calls[0][0] as Set<string | null>;
    expect([...arg]).toEqual([null]);
    (ct.onChange as (v: string[]) => void)(["C1", SEM_ID]);
    expect(new Set(p.onCatFilters.mock.calls[0][0] as Set<string | null>)).toEqual(new Set(["C1", null]));
  });

  it("onChange do Status repassa o valor", () => {
    const p = base();
    const st = montarFiltrosPlanTecido(p)[0];
    if (st.single) st.onChange("todos");
    expect(p.onStatus).toHaveBeenCalledWith("todos");
  });
});

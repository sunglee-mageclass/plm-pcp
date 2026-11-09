import type { FilterConfig } from "@/components/shared/filters";

/**
 * Adaptador do painel de filtros COMPARTILHADO (`FilterButton`, src/components/shared/filters.tsx) para o Plan. Tecido
 * (F2 filtrar-painel). So muda a APRESENTACAO: o estado segue `Set<string | null>` (null = "Sem linha"/"Sem categoria")
 * e a poda segue em `slotPassaFiltroStatus`/`slotPassaFiltroLinha`/`catFilters` (calc.ts / PlanTecidoSheet) — o painel
 * so fala `string[]`, entao `null` viaja como `SEM_ID`.
 */
export const SEM_ID = "__sem__";

export const setParaIds = (s: ReadonlySet<string | null>): string[] => [...s].map((v) => v ?? SEM_ID);
export const idsParaSet = (ids: readonly string[]): Set<string | null> => new Set(ids.map((i) => (i === SEM_ID ? null : i)));

export type StatusPlanTecido = "todos" | "sem_reprovado";

export type FiltroPainelParams = {
  status: StatusPlanTecido;
  onStatus: (v: StatusPlanTecido) => void;
  /** So as linhas com card na vista (+ as ja marcadas). */
  linhas: { id: string; nome: string; n: number }[];
  /** Se ha card sem linha (ou "Sem linha" ja marcado) — so ai a opcao aparece. */
  semLinha: { n: number } | null;
  filtroLinhas: ReadonlySet<string | null>;
  onFiltroLinhas: (s: Set<string | null>) => void;
  /** Filtro de familia so faz sentido em alguns modos do canvas. */
  mostrarCategorias: boolean;
  cats: string[];
  catNome: (id: string) => string;
  contagem: (id: string | null) => number;
  temSemCategoria: boolean;
  catFilters: ReadonlySet<string | null>;
  onCatFilters: (s: Set<string | null>) => void;
};

/** Descritores p/ `<FilterButton filters=...>`: Status (single, default "sem_reprovado" = inativo) · Linha (multi) ·
 *  Categoria de tecido (multi). Secao sem opcoes nao entra (nada pra escolher). */
export function montarFiltrosPlanTecido(p: FiltroPainelParams): FilterConfig[] {
  const out: FilterConfig[] = [
    {
      label: "Status",
      single: true,
      value: p.status,
      emptyValue: "sem_reprovado",
      onChange: (v) => p.onStatus(v as StatusPlanTecido),
      options: [
        { id: "sem_reprovado", nome: "Todos menos reprovado" },
        { id: "todos", nome: "Todos" },
      ],
    },
  ];
  const optsLinha = [
    ...p.linhas.map((l) => ({ id: l.id, nome: `${l.nome} (${l.n})` })),
    ...(p.semLinha ? [{ id: SEM_ID, nome: `Sem linha (${p.semLinha.n})` }] : []),
  ];
  if (optsLinha.length > 0) {
    out.push({ label: "Linha", value: setParaIds(p.filtroLinhas), onChange: (ids) => p.onFiltroLinhas(idsParaSet(ids)), options: optsLinha });
  }
  if (p.mostrarCategorias) {
    const optsCat = [
      ...p.cats.map((cid) => ({ id: cid, nome: `${p.catNome(cid)} (${p.contagem(cid)})` })),
      ...(p.temSemCategoria ? [{ id: SEM_ID, nome: `Sem categoria (${p.contagem(null)})` }] : []),
    ];
    if (optsCat.length > 0) {
      out.push({ label: "Categoria de tecido", value: setParaIds(p.catFilters), onChange: (ids) => p.onCatFilters(idsParaSet(ids)), options: optsCat });
    }
  }
  return out;
}

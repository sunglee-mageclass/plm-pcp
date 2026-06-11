// Catalog of permission pages used by the per-store Admin to restrict access.
export type PageKey = string;
export type PageDef = { key: PageKey; label: string };
export type ModuleDef = { module: string; label: string; basePath: string; pages: PageDef[] };

export const PAGES_CATALOG: ModuleDef[] = [
  {
    module: "cadastro",
    label: "Cadastro",
    basePath: "/cadastro",
    pages: [
      { key: "cadastro_atributos", label: "Atributos" },
      { key: "cadastro_colaboradores", label: "Colaboradores" },
      { key: "cadastro_servico", label: "Serviço" },
      { key: "cadastro_tecidos", label: "Tecidos" },
      { key: "cadastro_aviamentos", label: "Aviamentos" },
    ],
  },
  {
    module: "entrada_saida",
    label: "Entrada e Saída",
    basePath: "/entrada-saida",
    pages: [
      { key: "entrada_oc_tecido", label: "OC Tecido" },
      { key: "entrada_oc_aviamento", label: "OC Aviamento" },
      { key: "entrada_estoque", label: "Estoque" },
    ],
  },
  {
    module: "criacao",
    label: "Criação",
    basePath: "/criacao",
    pages: [
      { key: "criacao_planejamento", label: "Planejamento" },
      { key: "criacao_desenvolvimento", label: "Desenvolvimento" },
    ],
  },
  {
    module: "producao",
    label: "Produção",
    basePath: "/producao",
    pages: [
      { key: "producao_cad", label: "CAD" },
      { key: "producao_terceirizados", label: "Terceirizados" },
      { key: "producao_cq", label: "CQ" },
      { key: "producao_acabamento", label: "Acabamento" },
      { key: "producao_direcionamento", label: "Direcionamento" },
      { key: "producao_lancamentos", label: "Lançamentos" },
    ],
  },
  {
    module: "financeiro",
    label: "Financeiro",
    basePath: "/financeiro",
    pages: [
      { key: "financeiro_parcelas", label: "Parcelas" },
      { key: "financeiro_calendario", label: "Calendário" },
    ],
  },
  {
    module: "dashboard",
    label: "Dashboard",
    basePath: "/dashboard",
    pages: [
      { key: "dashboard_colecao", label: "Coleção" },
      { key: "dashboard_estoque", label: "Estoque" },
      { key: "dashboard_producao", label: "Produção" },
      { key: "dashboard_financeiro", label: "Financeiro" },
      { key: "dashboard_custos", label: "Custos" },
    ],
  },
];

export const ALL_PAGE_KEYS: PageKey[] = PAGES_CATALOG.flatMap((m) => m.pages.map((p) => p.key));

// Catalog of permission pages used by the per-store Admin to restrict access.
export type PageKey = string;
// modes: em quais perfis a página aparece. Ausente = ambos. ["full"] = só PLM
// completo; ["stock"] = só modo só-estoque. (Não substitui permissão por usuário.)
export type StoreProfile = "full" | "stock";
export type PageDef = { key: PageKey; label: string; modes?: StoreProfile[] };
export type ModuleDef = { module: string; label: string; basePath: string; pages: PageDef[] };

/** Página visível no perfil atual da loja (full vs só-estoque)? */
export function pageInProfile(p: PageDef, profile: StoreProfile): boolean {
  return !p.modes || p.modes.includes(profile);
}

export const PAGES_CATALOG: ModuleDef[] = [
  {
    module: "cadastro",
    label: "Cadastro",
    basePath: "/cadastro",
    pages: [
      { key: "cadastro_atributos", label: "Atributos" },
      { key: "cadastro_colaboradores", label: "Colaboradores" },
      { key: "cadastro_servico", label: "Serviços" },
      { key: "cadastro_tecidos", label: "Tecidos" },
      { key: "cadastro_aviamentos", label: "Aviamentos" },
      { key: "cadastro_etiquetas", label: "TAG/Etiquetas", modes: ["full"] },
      { key: "cadastro_destinos", label: "Destinos", modes: ["stock"] },
    ],
  },
  {
    module: "entrada_saida",
    label: "Entrada e Saída",
    basePath: "/entrada-saida",
    pages: [
      { key: "entrada_oc_tecido", label: "OC Tecido" },
      { key: "entrada_alertas_tecido", label: "Alertas de Tecido", modes: ["full"] },
      { key: "entrada_oc_aviamento", label: "OC Aviamento" },
      { key: "entrada_os_tecido", label: "OS Tecido", modes: ["stock"] },
      { key: "entrada_os_aviamento", label: "OS Aviamento", modes: ["stock"] },
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
      { key: "producao_consumo_oc", label: "Consumo por OC" },
      { key: "producao_terceirizados", label: "Serviços" },
      { key: "producao_oficina", label: "Oficina" },
      { key: "producao_cq", label: "Controle de Qualidade" },
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
      { key: "financeiro_calendario", label: "Calendário" },
      { key: "financeiro_parcelas", label: "Lista de Parcelas" },
      { key: "financeiro_resumo", label: "Resumo" },
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

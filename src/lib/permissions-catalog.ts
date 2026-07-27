// Catalog of permission pages used by the per-store Admin to restrict access.
export type PageKey = string;
// modes: em quais perfis a página aparece. Ausente = ambos. ["full"] = só PLM
// completo; ["stock"] = só modo só-estoque. (Não substitui permissão por usuário.)
export type StoreProfile = "full" | "stock";
// `sections`: sub-permissões de uma tela (ex.: esconder Custos/Preço). Cada uma é uma key
// própria em user_permissions (Ver/Editar), gateada no front (e no banco quando sensível).
export type SectionDef = { key: PageKey; label: string };
// `soEdicao`: permissão-só (sem tela/menu) em que apenas "Editar" tem efeito — o modal
// esconde o "Leitor" e mostra um toggle único (ex.: aprovar/reprovar mão de obra).
export type PageDef = { key: PageKey; label: string; modes?: StoreProfile[]; sections?: SectionDef[]; soEdicao?: boolean };
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
      { key: "cadastro_servico", label: "Fornecedores" },
      { key: "cadastro_tecidos", label: "Tecidos" },
      { key: "cadastro_aviamentos", label: "Aviamentos" },
      { key: "cadastro_etiquetas", label: "Insumos", modes: ["full"] },
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
      { key: "entrada_oc_insumo", label: "OC Insumo", modes: ["full"] },
      { key: "entrada_os_tecido", label: "OS Tecido", modes: ["stock"] },
      { key: "entrada_os_aviamento", label: "OS Aviamento", modes: ["stock"] },
      { key: "entrada_estoque", label: "Estoque" },
    ],
  },
  {
    module: "otb",
    label: "OTB",
    basePath: "/otb",
    pages: [
      { key: "otb", label: "OTB" },
    ],
  },
  {
    module: "criacao",
    label: "Estilo & Engenharia",
    basePath: "/criacao",
    pages: [
      { key: "criacao_plan_tecido", label: "Planejamento de Tecido" },
      { key: "criacao_planejamento", label: "Planejamento de Produto",
        sections: [{ key: "criacao_planejamento:custos", label: "Custos / Preço" }] },
      // Permissão-só (sem tela): "Editar" = pode aprovar/reprovar o custo de mão de obra no
      // card do Planejamento (e Plan. Tecido). Chave legada `producao_servico_aprovacao`
      // MANTIDA (trigger no banco + atribuições já feitas); só o rótulo/lugar mudaram.
      { key: "producao_servico_aprovacao", label: "Aprovar/reprovar mão de obra", soEdicao: true },
      { key: "criacao_desenvolvimento", label: "Desenvolvimento",
        sections: [{ key: "criacao_desenvolvimento:custos", label: "Custos / Preço" }] },
      { key: "producao_explosao", label: "Explosão" },
    ],
  },
  {
    module: "producao",
    label: "PCP",
    basePath: "/producao",
    pages: [
      { key: "producao_cad", label: "CAD" },
      { key: "producao_terceirizados", label: "Serviços",
        sections: [{ key: "producao_terceirizados:precos", label: "Preços" }] },
      { key: "producao_oficina", label: "Oficina" },
      { key: "producao_cq", label: "Controle de Qualidade" },
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
      { key: "financeiro_parcelas", label: "OCs" },
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
      { key: "dashboard_comercial", label: "Comercial" },
      { key: "dashboard_leadtime", label: "Leadtime" },
    ],
  },
];

export const ALL_PAGE_KEYS: PageKey[] = PAGES_CATALOG.flatMap((m) =>
  m.pages.flatMap((p) => [p.key, ...(p.sections?.map((s) => s.key) ?? [])]),
);

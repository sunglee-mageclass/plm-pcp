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
// `shortLabel`: forma curta p/ superfícies apertadas (sidebar); `description`: 1 linha de
// CRITÉRIO DE DECISÃO exibida nos hubs de setor (SSOT — antes duplicada por rota, driftava).
export type PageDef = { key: PageKey; label: string; shortLabel?: string; description?: string; modes?: StoreProfile[]; sections?: SectionDef[]; soEdicao?: boolean };
// `gate`: chave de CONTRATAÇÃO (tenant_config.modules) usada p/ habilitar o nível. Ausente = usa o
// próprio `module`. Permite 2 níveis de navegação (ex.: PCP e Expedição) compartilharem a MESMA flag
// de contratação (`producao`) sem virar 2 módulos separados no banco.
export type ModuleDef = { module: string; label: string; basePath: string; pages: PageDef[]; gate?: string };

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
      { key: "cadastro_atributos", label: "Atributos", description: "Cores, anos, meses, categorias e demais listas." },
      { key: "cadastro_colaboradores", label: "Colaboradores", description: "Pessoas envolvidas no processo." },
      { key: "cadastro_servico", label: "Fornecedores", description: "Empresas fornecedoras e representantes." },
      { key: "cadastro_tecidos", label: "Tecidos", description: "Catálogo de tecidos e variantes." },
      { key: "cadastro_aviamentos", label: "Aviamentos", description: "Catálogo de aviamentos." },
      { key: "cadastro_etiquetas", label: "Insumos", description: "Insumos (etiquetas, embalagens, etc.).", modes: ["full"] },
      { key: "cadastro_destinos", label: "Destinos", description: "Destinos de saída (modo só-estoque).", modes: ["stock"] },
      { key: "cadastro_lojas", label: "Lojas", description: "Lojas do Direcionamento (E-commerce, Loja Física, …).", modes: ["full"] },
    ],
  },
  {
    module: "entrada_saida",
    label: "Entrada e Saída",
    basePath: "/entrada-saida",
    pages: [
      // Explosão (baixa de estoque/corte) — realocada de Estilo & Engenharia; 1ª da lista.
      // `modes: ["full"]` preserva o comportamento de ficar oculta no modo só-estoque.
      { key: "producao_explosao", label: "Explosão", description: "Baixa de estoque / envio ao corte.", modes: ["full"] },
      { key: "entrada_oc_tecido", label: "OC Tecido", description: "Ordens de compra de tecidos e recebimento." },
      { key: "entrada_alertas_tecido", label: "Alertas de Tecido", description: "CQ de tecido reprovado: trocar ou cancelar.", modes: ["full"] },
      { key: "entrada_oc_aviamento", label: "OC Aviamento", description: "Ordens de compra de aviamentos." },
      { key: "entrada_oc_insumo", label: "OC Insumo", description: "Ordens de compra de insumos.", modes: ["full"] },
      { key: "entrada_os_tecido", label: "OS Tecido", description: "Ordens de saída / baixa de tecidos.", modes: ["stock"] },
      { key: "entrada_os_aviamento", label: "OS Aviamento", description: "Ordens de saída / baixa de aviamentos.", modes: ["stock"] },
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
      { key: "criacao_plan_tecido", label: "Planejamento de Tecido", shortLabel: "Plan. Tecido", description: "Necessidade de tecido × estoque × OCs por coleção — antes de comprar." },
      { key: "criacao_planejamento", label: "Planejamento de Produto", shortLabel: "Plan. Produto", description: "Cards em planejamento; lança quando CQ e custo estão aprovados.",
        sections: [{ key: "criacao_planejamento:custos", label: "Custos / Preço" }] },
      // Permissão-só (sem tela): "Editar" = pode aprovar/reprovar o custo de mão de obra no
      // card do Planejamento (e Plan. Tecido). Chave legada `producao_servico_aprovacao`
      // MANTIDA (trigger no banco + atribuições já feitas); só o rótulo/lugar mudaram.
      { key: "producao_servico_aprovacao", label: "Aprovar/reprovar mão de obra", soEdicao: true },
      { key: "criacao_desenvolvimento", label: "Desenvolvimento", description: "Modelos aprovados: ficha técnica, BOM e kanban.",
        sections: [{ key: "criacao_desenvolvimento:custos", label: "Custos / Preço" }] },
    ],
  },
  {
    // PCP = o próprio Serviços (nível de página única, como o OTB). CAD e Oficina são permissões
    // sem tela na sidebar (CAD integrado à Explosão; Oficina acessada dentro de Serviços) — ficam aqui.
    module: "pcp",
    label: "PCP",
    basePath: "/pcp",
    gate: "producao",
    pages: [
      { key: "producao_terceirizados", label: "Serviços",
        sections: [{ key: "producao_terceirizados:precos", label: "Preços" }] },
      { key: "producao_cad", label: "CAD" },
      { key: "producao_oficina", label: "Oficina" },
    ],
  },
  {
    // Expedição & Logística = nível novo que agrupa CQ + Direcionamento + Lançamentos.
    module: "expedicao",
    label: "Expedição & Logística",
    basePath: "/expedicao",
    gate: "producao",
    pages: [
      { key: "producao_cq", label: "Controle de Qualidade", description: "Recebimento, conserto, lavagem, defeito." },
      { key: "producao_direcionamento", label: "Direcionamento", description: "E-commerce vs Loja Física." },
      { key: "producao_lancamentos", label: "Lançamentos", description: "Produtos finalizados." },
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

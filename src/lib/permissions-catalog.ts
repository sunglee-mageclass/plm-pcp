// Catalog of permission pages used by the per-store Admin to restrict access.
import type { ModuleKey } from "@/hooks/useTenantModules";

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
// `gate`: chave de CONTRATAÇÃO (tenant_config.modules) da PRÓPRIA página — mesmo conceito
// do `ModuleDef.gate`, mas por página dentro de um módulo já ligado (ex.: `produto_acabado`
// dentro de `criacao`/`entrada_saida`, opt-in, sem ModuleDef próprio). Ausente = só o gate
// do módulo vale.
export type PageDef = { key: PageKey; label: string; shortLabel?: string; description?: string; modes?: StoreProfile[]; sections?: SectionDef[]; soEdicao?: boolean; gate?: string };
// `gate`: chave de CONTRATAÇÃO (tenant_config.modules) usada p/ habilitar o nível. Ausente = usa o
// próprio `module`. Permite 2 níveis de navegação (ex.: PCP e Expedição) compartilharem a MESMA flag
// de contratação (`producao`) sem virar 2 módulos separados no banco.
export type ModuleDef = { module: string; label: string; basePath: string; pages: PageDef[]; gate?: string };

/** Página visível no perfil atual da loja (full vs só-estoque)? */
export function pageInProfile(p: PageDef, profile: StoreProfile): boolean {
  return !p.modes || p.modes.includes(profile);
}

/**
 * Página visível no perfil da loja, com a regra do P-256 A [modularidade F1]: a página só-estoque (`modes` = só
 * `["stock"]`: OS Tecido, OS Aviamento, Destinos) aparece sempre que a loja NÃO tem Criação — mesmo com Financeiro/
 * Dashboard ligados (antes sumia assim que a loja deixava de ser "só estoque" estrito e a saída de material ficava sem
 * tela). As demais seguem `pageInProfile` como sempre. `pageInProfile` fica (compat).
 */
export function paginaNoPerfil(p: PageDef, ctx: { isStockOnly: boolean; criacaoLigada: boolean }): boolean {
  const soEstoque = !!p.modes && p.modes.includes("stock") && !p.modes.includes("full");
  if (soEstoque) return !ctx.criacaoLigada;
  return pageInProfile(p, ctx.isStockOnly ? "stock" : "full");
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de DEPENDÊNCIAS entre módulos [modularidade F1, parte 2, P-251 C]. FONTE ÚNICA, SÓ EM CÓDIGO: NÃO é usado no
// Gerenciar Lojas (o dono decidiu: dar módulo é do super admin, sem aviso nem bloqueio na tela). Quem lê: os avisos de
// "precisa do módulo X" (useRequerModulo), o editor de permissões e o anti-drift (tests/integration/mod-antidrift.test.ts,
// que compara com os portões `_exige_modulos` do banco). Página que depende de módulo fora desta tabela declara no `gate`
// da PageDef (Plan. Tecido → otb; Explosão → criacao).
// ─────────────────────────────────────────────────────────────────────────────
export const MODULE_ROTULO: Record<ModuleKey, string> = {
  cadastro: "Cadastro",
  entrada_saida: "Entrada e Saída",
  criacao: "Criação",
  producao: "Produção",
  financeiro: "Financeiro",
  dashboard: "Dashboard",
  otb: "OTB",
  distribuicao: "Distribuição",
  produto_acabado: "Produto Acabado",
  produto_importado: "Produto Importado",
  etapas_pl: "Etapas PL",
};

export const MODULE_DEPS: Partial<Record<ModuleKey, { exige: ModuleKey[]; motivo: string }>> = {
  producao: { exige: ["criacao", "entrada_saida"], motivo: "A produção parte dos cards da Criação e do material da Entrada e Saída." },
  produto_acabado: { exige: ["criacao", "entrada_saida", "producao", "otb"], motivo: "A revenda nasce de card (Criação) e coleção (OTB), recebe pela Entrada e Saída e passa pelo CQ (Produção)." },
  produto_importado: { exige: ["criacao", "entrada_saida", "producao", "otb"], motivo: "O importado nasce de card (Criação) e coleção (OTB), recebe pela Entrada e Saída e passa pelo CQ (Produção)." },
  otb: { exige: ["criacao"], motivo: "A coleção do OTB organiza os cards da Criação." },
  distribuicao: { exige: ["otb", "criacao"], motivo: "A distribuição por loja mora no Plan. Tecido (OTB) e nos cards (Criação)." },
  etapas_pl: { exige: ["producao"], motivo: "As etapas de PL ficam no PCP (Produção)." },
};

/** Módulos que `chave` exige e a loja NÃO tem ligados (ordem do mapa). `modules` = o mapa já resolvido da loja
 *  (`useTenantModules().modules`); chave ausente = desligado. Módulo sem dependência declarada = []. */
export function faltasDeModulo(modules: Partial<Record<ModuleKey, boolean>>, chave: ModuleKey): ModuleKey[] {
  return (MODULE_DEPS[chave]?.exige ?? []).filter((m) => !modules[m]);
}

export const PAGES_CATALOG: ModuleDef[] = [
  {
    module: "cadastro",
    label: "Cadastro",
    basePath: "/cadastro",
    pages: [
      { key: "cadastro_atributos", label: "Atributos", description: "Cores, anos, meses, categorias e demais listas.",
        // Sub-permissão de EDIÇÃO por atributo (a página `cadastro_atributos` dá o ACESSO à tela;
        // cada section refina QUEM pode editar aquele atributo). Key = `cadastro_atributos:<value>`,
        // casando com o `value` do atributo em cadastro.atributos.tsx e com a RLS do banco.
        sections: [
          { key: "cadastro_atributos:cores", label: "Cor base" },
          { key: "cadastro_atributos:cores_apelido", label: "Cor apelido" },
          { key: "cadastro_atributos:anos", label: "Ano" },
          { key: "cadastro_atributos:meses", label: "Mês" },
          { key: "cadastro_atributos:cat_fornecedor", label: "Categoria do Fornecedor" },
          { key: "cadastro_atributos:cat_tecido", label: "Categoria do Tecido" },
          { key: "cadastro_atributos:cat_aviamento", label: "Categoria de Aviamento" },
          { key: "cadastro_atributos:subcat_aviamento", label: "Subcategoria de Aviamento" },
          { key: "cadastro_atributos:mat_aviamento", label: "Material de Aviamento" },
          { key: "cadastro_atributos:intervalo_largura", label: "Intervalo de Largura" },
          { key: "cadastro_atributos:tipo_insumo", label: "Tipo de Produto (Insumo)" },
          { key: "cadastro_atributos:grupo_produto", label: "Grupo (Produto)" },
          { key: "cadastro_atributos:cat_produto", label: "Categoria (Produto)" },
          { key: "cadastro_atributos:subcat1_produto", label: "Subcategoria 1 (Produto)" },
          { key: "cadastro_atributos:subcat2_produto", label: "Subcategoria 2 (Produto)" },
          { key: "cadastro_atributos:linhas", label: "Linha" },
          { key: "cadastro_atributos:cat_terceirizado", label: "Categoria do Serviço" },
          // Grade de Tamanhos NÃO é section: mora em tenant_config, cujo UPDATE é `is_tenant_admin()`
          // no banco — a permissão por-usuário nunca a destravaria (seria promessa vazia). Fica
          // ADMIN-only (banco garante), gate de UI por admin. Ver GradeTamanhosCard/cadastro.atributos.
        ] },
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
    // Item de TOPO próprio, logo abaixo de Cadastro (pedido do dono) — não é sub-item do Cadastro.
    // Página única cuja key = nome do módulo e basePath = a URL; como `importar` NÃO entra em
    // PAGE_URLS, o sidebar o renderiza como LINK DIRETO (mesmo padrão do OTB).
    module: "importar",
    label: "Importar Dados",
    basePath: "/cadastro/importar",
    pages: [
      { key: "importar", label: "Importar Dados", description: "Importação em massa via planilha (tecido, aviamento, insumo, produto).", modes: ["full"] },
    ],
  },
  {
    module: "entrada_saida",
    label: "Entrada e Saída",
    basePath: "/entrada-saida",
    pages: [
      // Explosão (baixa de estoque/corte) — realocada de Estilo & Engenharia; 1ª da lista.
      // `modes: ["full"]` preserva o comportamento de ficar oculta no modo só-estoque.
      { key: "producao_explosao", label: "Explosão", description: "Baixa de estoque / envio ao corte.", modes: ["full"], gate: "criacao" },
      { key: "entrada_oc_tecido", label: "OC Tecido", description: "Ordens de compra de tecidos e recebimento." },
      { key: "entrada_alertas_tecido", label: "Alertas de Tecido", description: "CQ de tecido reprovado: trocar ou cancelar.", modes: ["full"] },
      { key: "entrada_oc_p_acabado", label: "OC P. Acabado", description: "Ordens de compra de produto acabado (revenda) e recebimento.", modes: ["full"], gate: "produto_acabado" },
      { key: "entrada_oc_p_importado", label: "OC P. Importado", description: "Ordens de compra de produto importado (exterior) e recebimento.", modes: ["full"], gate: "produto_importado" },
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
      { key: "criacao_plan_tecido", label: "Planejamento de Tecido", shortLabel: "Plan. Tecido", description: "Necessidade de tecido × estoque × OCs por coleção — antes de comprar.", gate: "otb" },
      { key: "criacao_produto_acabado", label: "Produto Acabado", description: "Planeje produtos de revenda (comprar pronto) por coleção.", gate: "produto_acabado" },
      { key: "criacao_produto_importado", label: "Produto Importado", description: "Planeje produtos importados (comprar do exterior, com cotação de moeda) por coleção.", gate: "produto_importado" },
      { key: "criacao_planejamento", label: "Planejamento de Produto", shortLabel: "Plan. Produto", description: "Cards em planejamento; lança quando CQ e custo estão aprovados.",
        sections: [
          { key: "criacao_planejamento:custos", label: "Custos / Preço" },
          { key: "criacao_planejamento:preco_venda", label: "Editar preço de venda" },
        ] },
      { key: "criacao_desenvolvimento", label: "Desenvolvimento", description: "Modelos aprovados: ficha técnica, BOM e kanban.",
        sections: [{ key: "criacao_desenvolvimento:custos", label: "Custos / Preço" }] },
    ],
  },
  {
    // PCP = o próprio Serviços (nível de página única, como o OTB). Oficina é permissão
    // sem tela na sidebar (acessada dentro de Serviços) — fica aqui.
    module: "pcp",
    label: "PCP",
    basePath: "/pcp",
    gate: "producao",
    pages: [
      { key: "producao_terceirizados", label: "Serviços",
        sections: [{ key: "producao_terceirizados:precos", label: "Preços" }] },
      // Permissão-só (sem tela): "Editar" = pode aprovar/reprovar a mão de obra terceirizada
      // no card do Planejamento (e Plan. Tecido) — a AÇÃO fica lá, mas a permissão mora aqui
      // (perto de Serviços/Preços, mesmo gate `producao` já usado p/ este card na Início).
      // Chave legada `producao_servico_aprovacao` MANTIDA (trigger no banco + atribuições já
      // feitas). Histórico: nasceu em PCP → 27/jul foi p/ Estilo & Engenharia (perto de onde o
      // botão fica) → voltou pra PCP em 12/ago (o dono não achava em Estilo & Engenharia; "mão
      // de obra" é lido como assunto de PCP/Serviços, mesmo a ação acontecendo no Planejamento).
      { key: "producao_servico_aprovacao", label: "Aprovação de mão de obra", soEdicao: true },
      { key: "producao_oficina", label: "Oficina" },
      // Etapas PL (Fase 2, Task 1) — quadro de PL dentro do hub PCP; opt-in (gate próprio,
      // igual a produto_acabado dentro de criacao/entrada_saida).
      { key: "producao_etapas", label: "Etapas", gate: "etapas_pl" },
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
    // F5c (P-112 A, 28/set): Financeiro passou a gatear CADA ABA pela própria permissão (antes
    // só a página inteira era gateada). `financeiro_servicos` é NOVA (a aba Serviços existia mas
    // não tinha key própria — ficava sempre visível pra quem via a página). A tela abre com
    // QUALQUER uma das 4; cada aba só aparece com a SUA key (admin fura, como sempre).
    module: "financeiro",
    label: "Financeiro",
    basePath: "/financeiro",
    pages: [
      { key: "financeiro_calendario", label: "Calendário" },
      { key: "financeiro_parcelas", label: "OCs" },
      { key: "financeiro_servicos", label: "Serviços" },
      { key: "financeiro_resumo", label: "Resumo" },
    ],
  },
  {
    module: "dashboard",
    label: "Dashboard",
    basePath: "/dashboard",
    pages: [
      // "Desenvolvimento" (visão por gestor) reúne kanban + o-que-destravar + funil das RPCs
      // dashboard_producao/leadtime_itens/colecao (cada uma segue seu próprio gate no banco).
      { key: "dashboard_desenvolvimento", label: "Desenvolvimento" },
      // "Produção & Qualidade" (visão por gestor) reúne CQ pendente + direcionamento + WIP +
      // ranking das RPCs dashboard_producao/producao_servicos/ranking_servicos + contagens de
      // CQ/Direcionamento (cada uma segue seu próprio gate/RLS no banco).
      { key: "dashboard_producao_qualidade", label: "Produção & Qualidade" },
      // "Comercial & Coleção" (visão por gestor): poder de venda / margem / lucro / ticket por linha,
      // calculado no front via preco.ts (custo_unitario_modelos + grade). Sem RPC própria.
      { key: "dashboard_comercial_colecao", label: "Comercial & Coleção" },
      // "Custo & Financeiro" (visão por gestor): a pagar/investido/estoque parado/custo prev×real
      // das RPCs dashboard_financeiro/estoque_parado/custos (cada uma segue seu gate no banco).
      { key: "dashboard_custo_financeiro", label: "Custo & Financeiro" },
      // F5c review (I-1, 29/set): `dashboard_leadtime` é a permissão da PRÓPRIA ABA Leadtime
      // (dashboard.tsx:68 `canView(`dashboard_${t.value}`)`, DASH_TABS tem `value: "leadtime"`) —
      // NÃO é uma chave de dado. Fica aqui como a 5ª aba (mesmo nível de Desenvolvimento/Produção &
      // Qualidade/Comercial & Coleção/Custo & Financeiro acima), fora de DASHBOARD_DADOS_ABAS.
      { key: "dashboard_leadtime", label: "Leadtime" },
      // F5c (P-112 A, 28/set): as 6 chaves de DADOS abaixo continuam EXATAMENTE como estavam (o
      // banco gateia as RPCs por elas + `_pode_ver_custos`) — só o RÓTULO ganhou o prefixo "Dados:"
      // (rótulo é só exibição; a key/payload não mudam). No editor (PermissoesModal/PapelEditor)
      // elas são renderizadas AGRUPADAS, sob uma sub-legenda + InfoHover — ver DASHBOARD_DADOS_ABAS
      // logo abaixo (mapa dado→aba(s) que ele alimenta, lido de dashboard.tsx).
      { key: "dashboard_colecao", label: "Dados: Coleção" },
      { key: "dashboard_estoque", label: "Dados: Estoque" },
      { key: "dashboard_producao", label: "Dados: Produção" },
      { key: "dashboard_financeiro", label: "Dados: Financeiro" },
      { key: "dashboard_custos", label: "Dados: Custos" },
      { key: "dashboard_comercial", label: "Dados: Comercial" },
    ],
  },
  {
    // Integração + API (set/2026, P-65 A): página única, link direto no menu da loja (sem hub); NÃO é módulo contratável —
    // fica fora dos interruptores de Gerenciar Lojas (como o `importar`) e `tenant_module_enabled('integracao')` = ligado.
    // Super admin também a vê em "Admin Mestre" (app-sidebar). Editar = integrar/voltar/editar campos (o servidor confere).
    module: "integracao",
    label: "Integração",
    basePath: "/integracao",
    pages: [
      { key: "integracao", label: "Integração", description: "Organiza os produtos que o programa externo (ERP/e-commerce) lê pela API.", modes: ["full"] },
    ],
  },
];

export const ALL_PAGE_KEYS: PageKey[] = PAGES_CATALOG.flatMap((m) =>
  m.pages.flatMap((p) => [p.key, ...(p.sections?.map((s) => s.key) ?? [])]),
);

// ─────────────────────────────────────────────────────────────────────────────
// F5c (P-112 A, 28/set) — Dashboard: as 6 chaves de DADOS acima (`dashboard_colecao/estoque/
// producao/financeiro/custos/comercial`) continuam INTACTAS (mesmas keys, mesmo payload) — o
// banco as usa direto nos gates de RPC + `_pode_ver_custos`. Isso aqui é só metadado de EXIBIÇÃO:
// pra qual(is) das 5 abas cada chave de dado alimenta números, lido de `dashboard.tsx` (cada
// função `<Aba>Tab` e as RPCs que ela chama):
//   - Desenvolvimento    → dashboard_producao, dashboard_colecao (o leadtime da aba Desenvolvimento
//     é liberado pela permissão da PRÓPRIA aba Leadtime, `dashboard_leadtime` — ver nota abaixo)
//   - Produção & Qualidade → dashboard_producao (dashboard_producao/_servicos/ranking_servicos)
//   - Comercial & Coleção  → dashboard_custos, dashboard_comercial (via `_pode_ver_custos`,
//     `custo_unitario_modelos` — a aba não tem RPC dashboard_* própria)
//   - Custo & Financeiro   → dashboard_financeiro, dashboard_custos
// `dashboard_estoque` é a ÚNICA das 6 sem consumidor hoje: a RPC `dashboard_estoque()` existe no
// banco (grep confirma) mas NENHUMA aba do dashboard.tsx atual a chama (órfã do dashboard de 7
// abas pré-"por gestor" — ver memória `project_dashboard_por_gestor`). Fica listada em Custo &
// Financeiro (vizinha temática mais próxima — estoque parado já mora lá) com aviso no InfoHover.
// ⚠️ F5c review (I-1): `dashboard_leadtime` NÃO entra aqui — é a permissão da PRÓPRIA aba
// Leadtime (dashboard.tsx:68, DASH_TABS `value: "leadtime"`), não uma chave de dado. Ela também
// libera os números de leadtime que aparecem na aba Desenvolvimento (mesma RPC
// `dashboard_leadtime`/`_itens`) — por isso o rótulo da linha-aba ganha um hint próprio no editor
// (ver `DASHBOARD_LEADTIME_HINT` abaixo), em vez de virar uma linha "Dados: Leadtime" agrupada.
export const DASHBOARD_DADOS_ABAS: Record<string, string[]> = {
  dashboard_colecao: ["Desenvolvimento"],
  dashboard_producao: ["Desenvolvimento", "Produção & Qualidade"],
  dashboard_custos: ["Comercial & Coleção", "Custo & Financeiro"],
  dashboard_comercial: ["Comercial & Coleção"],
  dashboard_financeiro: ["Custo & Financeiro"],
  dashboard_estoque: [], // órfã — nenhuma aba chama a RPC hoje (ver comentário acima)
};

// Hint opcional (I-1) exibido junto à linha-aba "Leadtime" nos dois editores: a mesma permissão
// também libera os números de leadtime mostrados dentro da aba Desenvolvimento (RPC compartilhada
// `dashboard_leadtime`/`dashboard_leadtime_itens`), não só a aba Leadtime em si.
export const DASHBOARD_LEADTIME_HINT = "também libera os números de leadtime da aba Desenvolvimento";

// Texto do InfoHover ao lado da sub-legenda "Dados por aba" no editor (usuário e papel). PT,
// explica que sem a chave de dado a aba mostra o gráfico vazio/sem permissão mesmo com a aba em
// si liberada, e que Custos/Comercial também liberam ver custo no card do produto.
export const DASHBOARD_DADOS_INFO =
  "Cada aba do Dashboard mostra números de uma ou mais dessas permissões de DADOS. " +
  "Sem a chave de dado, a aba abre mas o gráfico correspondente fica vazio ou sem permissão — " +
  "mesmo com a aba liberada acima. \"Dados: Custos\" e \"Dados: Comercial\" também liberam ver " +
  "o custo no card do produto (fora do Dashboard).";

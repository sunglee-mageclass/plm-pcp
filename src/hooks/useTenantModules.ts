import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenant } from "@/hooks/useActiveTenantId";

/**
 * Módulos habilitáveis por loja (tenant_config.modules, jsonb).
 * As chaves batem com PAGES_CATALOG em src/lib/permissions-catalog.ts.
 * Fallback: tudo ligado quando não há config (resiliência no rollout).
 */
export type ModuleKey =
  | "cadastro"
  | "entrada_saida"
  | "criacao"
  | "producao"
  | "financeiro"
  | "dashboard"
  | "otb"
  | "distribuicao"
  | "produto_acabado"
  | "produto_importado"
  | "etapas_pl";

const DEFAULTS: Record<ModuleKey, boolean> = {
  cadastro: true,
  entrada_saida: true,
  criacao: true,
  producao: true,
  financeiro: true,
  dashboard: true,
  otb: false, // opt-in
  distribuicao: false, // opt-in
  produto_acabado: false, // opt-in
  produto_importado: false, // opt-in
  etapas_pl: false, // opt-in
};

// produto_acabado e etapas_pl não são módulos de topo (sem tela basePath própria — são
// GATEs dentro de outro módulo/tela; ver PageDef.gate em permissions-catalog.ts e o
// kanban de Etapas PL dentro de PCP), então nunca entram em LANDING_ORDER; a entrada
// existe só p/ o Record<ModuleKey,string> ficar exaustivo.
const MODULE_BASE_PATH: Record<ModuleKey, string> = {
  cadastro: "/cadastro",
  entrada_saida: "/entrada-saida",
  criacao: "/criacao",
  producao: "/pcp",
  financeiro: "/financeiro",
  dashboard: "/dashboard",
  otb: "/otb",
  // Distribuição por produto (set/2026): a página antiga está OCULTA (P-49 B) — o módulo é gate do "Distribuir por
  // loja" (Plan. Tecido) e do plano no Direcionamento; a entrada existe só p/ o Record ficar exaustivo (fora do LANDING_ORDER).
  distribuicao: "/criacao/plan-tecido",
  produto_acabado: "/criacao/produto-acabado",
  produto_importado: "/criacao/produto-importado",
  etapas_pl: "/pcp",
};

// Prioridade para landing/redirect. Dashboard primeiro mantém o comportamento
// atual (index → /dashboard); cadastro por último (é base de dados, não landing).
const LANDING_ORDER: ModuleKey[] = [
  "dashboard",
  "entrada_saida",
  "producao",
  "criacao",
  "financeiro",
  "cadastro",
];

/** Mapa de módulos já resolvido (padrões + o que a loja gravou) — mesma conta do `useTenantModules`, reusável para a loja de
 *  OUTRO usuário (editor de permissões, [modularidade F2]). */
export function resolverModulos(raw: Partial<Record<ModuleKey, boolean>> | null | undefined): Record<ModuleKey, boolean> {
  return { ...DEFAULTS, ...(raw ?? {}) };
}

export function useTenantModules() {
  const { tenantId, resolvido } = useActiveTenant();
  const { data, status, isFetched } = useQuery({
    // tenantId na key: troca de loja => key nova => refaz o fetch da loja nova.
    queryKey: ["tenant_config", "modules", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("modules").eq("tenant_id", tenantId).maybeSingle();
      return ((data as any)?.modules ?? null) as Partial<Record<ModuleKey, boolean>> | null;
    },
    staleTime: 5 * 60 * 1000,
  });

  // `pronto` [modularidade F1, parte 1]: a loja E a config dela já chegaram (sucesso OU erro). Antes disso `modules`
  // são os DEFAULTS e quem decide por eles pisca/redireciona errado numa URL direta. Erro conta como pronto (cai nos
  // DEFAULTS, comportamento de sempre) — nunca "Carregando" eterno. Sem loja (sem usuário) também é pronto.
  const pronto = resolvido && (tenantId === "" || status !== "pending");

  const modules: Record<ModuleKey, boolean> = resolverModulos(data);

  const isModuleEnabled = (key: string) =>
    modules[key as ModuleKey] ?? DEFAULTS[key as ModuleKey] ?? true;

  // Modo só-estoque: apenas Cadastro + Entrada e Saída ligados.
  const isStockOnly =
    !!modules.cadastro &&
    !!modules.entrada_saida &&
    !modules.criacao &&
    !modules.producao &&
    !modules.financeiro &&
    !modules.dashboard;

  const firstActiveModulePath =
    MODULE_BASE_PATH[LANDING_ORDER.find((k) => modules[k]) ?? "cadastro"];

  // `isLoading` = `!pronto` (M9): os consumidores antigos ganham o conserto da corrida sem mudar de código.
  const isLoading = !pronto;

  return { modules, isModuleEnabled, isStockOnly, firstActiveModulePath, isLoading, isFetched, pronto };
}

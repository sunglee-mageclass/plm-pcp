import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

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
  | "produto_acabado";

const DEFAULTS: Record<ModuleKey, boolean> = {
  cadastro: true,
  entrada_saida: true,
  criacao: true,
  producao: true,
  financeiro: true,
  dashboard: true,
  otb: false, // opt-in
  produto_acabado: false, // opt-in
};

// produto_acabado não é um módulo de topo (sem tela basePath própria — é um GATE de
// PÁGINA dentro de criacao/entrada_saida, ver PageDef.gate em permissions-catalog.ts),
// então nunca entra em LANDING_ORDER; a entrada existe só p/ o Record<ModuleKey,string>
// ficar exaustivo.
const MODULE_BASE_PATH: Record<ModuleKey, string> = {
  cadastro: "/cadastro",
  entrada_saida: "/entrada-saida",
  criacao: "/criacao",
  producao: "/pcp",
  financeiro: "/financeiro",
  dashboard: "/dashboard",
  otb: "/otb",
  produto_acabado: "/criacao/produto-acabado",
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

export function useTenantModules() {
  const tenantId = useActiveTenantId();
  const { data, isLoading } = useQuery({
    // tenantId na key: troca de loja => key nova => refaz o fetch da loja nova.
    queryKey: ["tenant_config", "modules", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("modules").eq("tenant_id", tenantId).maybeSingle();
      return ((data as any)?.modules ?? null) as Partial<Record<ModuleKey, boolean>> | null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const modules: Record<ModuleKey, boolean> = { ...DEFAULTS, ...(data ?? {}) };

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

  return { modules, isModuleEnabled, isStockOnly, firstActiveModulePath, isLoading };
}

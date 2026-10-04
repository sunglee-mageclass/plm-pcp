import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolverModulos, type ModuleKey } from "@/hooks/useTenantModules";

/**
 * [modularidade F2, F10] Módulos (já resolvidos) de UMA loja qualquer — o editor de permissões edita usuário/papel que pode
 * ser de OUTRA loja (super admin), então não serve o `useTenantModules` (que lê a loja ATIVA). Mesma tabela e mesma conta;
 * queryKey com a loja (troca de loja = outra chave). `modules = null` enquanto carrega, sem loja ou em erro: quem usa trata
 * como "nada desligado" (não esmaece o que não sabe) — ver `paginaComModuloDesligado`.
 */
export function useModulosDaLoja(tenantId: string | null | undefined): { modules: Record<ModuleKey, boolean> | null; carregando: boolean } {
  const { data, status } = useQuery({
    queryKey: ["tenant_config", "modules", "da-loja", tenantId ?? ""],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("modules").eq("tenant_id", tenantId!).maybeSingle();
      if (error) throw error;
      return ((data as any)?.modules ?? null) as Partial<Record<ModuleKey, boolean>> | null;
    },
    staleTime: 5 * 60 * 1000,
  });
  if (!tenantId || status === "error") return { modules: null, carregando: false };
  if (status === "pending") return { modules: null, carregando: true };
  return { modules: resolverModulos(data), carregando: false };
}

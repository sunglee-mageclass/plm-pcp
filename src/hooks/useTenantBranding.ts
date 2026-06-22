import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

export type TenantBranding = {
  nome: string | null;
  cnpj: string | null;
  contato: string | null;
  logoUrl: string | null;
};

/**
 * Identidade da loja p/ cabeçalho de relatórios imprimíveis (nome, CNPJ, contato
 * e logo assinada — bucket "tenant-logos"). Mesma fonte do cadastro da loja
 * (tabela `tenants`). Cacheado; várias RelatorioPrint compartilham a query.
 */
export function useTenantBranding(): TenantBranding {
  const { user } = useAuth();
  const tenantId = useActiveTenantId();
  const { data } = useQuery({
    queryKey: ["tenant-branding", user?.id, tenantId],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: u } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      const tid = (u as any)?.tenant_id;
      if (!tid) return null;
      const { data: t } = await supabase
        .from("tenants")
        .select("nome, cnpj, contato, logo_url")
        .eq("id", tid)
        .maybeSingle();
      if (!t) return null;
      let logoUrl: string | null = null;
      const path = (t as any).logo_url as string | null | undefined;
      if (path) {
        const { data: signed } = await supabase.storage.from("tenant-logos").createSignedUrl(path, 3600);
        logoUrl = signed?.signedUrl ?? null;
      }
      return {
        nome: (t as any).nome ?? null,
        cnpj: (t as any).cnpj ?? null,
        contato: (t as any).contato ?? null,
        logoUrl,
      } as TenantBranding;
    },
  });
  return data ?? { nome: null, cnpj: null, contato: null, logoUrl: null };
}

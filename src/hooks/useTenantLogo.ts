import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * URL assinada da logo da loja (tenants.logo_url, bucket "tenant-logos"),
 * a mesma enviada no cadastro da loja. Retorna null se não houver.
 */
export function useTenantLogo(): string | null {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["tenant-logo", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: u } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      const tid = u?.tenant_id;
      if (!tid) return null;
      const { data: t } = await supabase
        .from("tenants")
        .select("logo_url")
        .eq("id", tid)
        .maybeSingle();
      const path = (t as any)?.logo_url as string | null | undefined;
      if (!path) return null;
      const { data: signed } = await supabase.storage.from("tenant-logos").createSignedUrl(path, 3600);
      return signed?.signedUrl ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? null;
}

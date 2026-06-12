import { supabase } from "@/integrations/supabase/client";

let cached: string | null = null;

/**
 * Returns the current user's tenant_id, used as a path prefix for all storage uploads
 * so that bucket RLS policies can enforce tenant isolation via the first folder name.
 */
export async function tenantPrefix(): Promise<string> {
  if (cached) return cached;
  const { data, error } = await supabase.rpc("get_user_tenant_id");
  if (error) throw error;
  if (!data) throw new Error("Loja do usuário não encontrada.");
  cached = data as string;
  return cached;
}

export function clearTenantPrefixCache() {
  cached = null;
}

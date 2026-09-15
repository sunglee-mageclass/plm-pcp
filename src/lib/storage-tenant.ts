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

/**
 * Sanitiza o nome do arquivo para a "key" do Storage do Supabase: acento/espaço/símbolo
 * quebram a key (erro "Invalid key: .../Véu - 2060.jpeg"). Remove acentos e troca o resto
 * por "_". Use com um uuid na frente p/ garantir unicidade.
 */
export function sanitizeStorageName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload genérico para um bucket específico, com a key tenant-prefixada e sanitizada — mesma
 * convenção do `uploadFile` de cada módulo (`tenant/prefixo/uuid-nome`), mas com o BUCKET como
 * parâmetro. Usado pela foto do card de Produto Acabado/Importado, que agora sobe no bucket
 * "modelos" (a foto do produto É a foto do modelo — ver 20260915120000_produto_foto_vira_foto_modelo).
 * Retorna o path (sem o bucket), pronto p/ gravar numa coluna e ler com useSignedUrl(path, bucket).
 */
export async function uploadToBucket(bucket: string, prefix: string, file: File): Promise<string> {
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

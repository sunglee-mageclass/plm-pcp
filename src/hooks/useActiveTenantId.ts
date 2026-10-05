import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * tenant_id ATIVO do usuário (public.users.tenant_id) — para o super_admin é a
 * loja "em visualização" escolhida no TenantSwitcher. Serve para CHAVEAR as
 * queries de identidade da loja (módulos, abas, fuso, posição da oficina) por
 * tenant: ao trocar de loja, a key muda e a query refaz o fetch da loja nova,
 * sem reaproveitar o cache da loja anterior (era o motivo da sidebar não
 * respeitar as toggles ao trocar de loja).
 */
export function useActiveTenant(): {
  tenantId: string;
  resolvido: boolean;
  erro: boolean;
  tentarDeNovo: () => void;
} {
  const { user, loading } = useAuth();
  const { data, status, refetch } = useQuery({
    queryKey: ["active-tenant-id", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("tenant_id").eq("id", user!.id).maybeSingle();
      // [backend F1] o erro TEM de subir: antes `data` null virava "" e o React Query via SUCESSO, então um refetch de foco
      // com a rede caída trocava a loja por "" (módulos nos DEFAULTS, Sheet sujo desmontado). Lançando, o RQ mantém o
      // último valor bom no refetch e marca `error` só quando nunca houve valor (1ª carga).
      if (error) throw error;
      return data?.tenant_id ?? "";
    },
  });
  // Sentinela "" quando sem usuário/tenant — todas as queries usam `enabled: !!tenantId`,
  // então o `.eq("tenant_id", "")` nunca chega a executar. Mantemos tipo `string` para
  // satisfazer as assinaturas tipadas do Supabase (que não aceitam null em .eq()).
  const tenantId = (data as string | undefined) ?? "";
  // `erro` [backend F1]: a 1ª carga FALHOU (depois dos retries do React Query) e não há valor anterior. Falha de refetch
  // com valor guardado NÃO é `erro` — o `tenantId` anterior segue valendo.
  const erro = status === "error" && data === undefined;
  // `resolvido` [modularidade F1, parte 1]: a auth terminou E (não há usuário OU a loja já chegou OU a 1ª carga falhou).
  // Antes desse ponto `tenantId === ""` NÃO significa "sem loja", significa "ainda não sei" — quem decidia por ele
  // (módulos nos DEFAULTS) redirecionava por engano numa URL direta.
  const resolvido = !loading && (!user?.id || data !== undefined || erro);
  const tentarDeNovo = () => {
    void refetch();
  };
  return { tenantId, resolvido, erro, tentarDeNovo };
}

/**
 * Relê a loja ativa DEPOIS de o servidor trocá-la (TenantSwitcher). Como a leitura que falha agora MANTÉM o valor antigo,
 * uma releitura que falhasse deixaria a tela na loja ANTERIOR como se nada tivesse mudado: nesse caso zera a query (sem
 * valor) para a 1ª carga refazer e, se falhar de novo, aparecer o erro com "Tentar de novo" em vez de uma loja errada.
 */
export async function recarregarLojaAtiva(qc: QueryClient): Promise<void> {
  const filtro = { queryKey: ["active-tenant-id"] };
  await qc.refetchQueries(filtro);
  const falhou = qc.getQueryCache().findAll(filtro).some((q) => q.state.status === "error");
  if (falhou) await qc.resetQueries(filtro);
}

export function useActiveTenantId(): string {
  return useActiveTenant().tenantId;
}

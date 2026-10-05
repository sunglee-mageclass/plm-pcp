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
  tentando: boolean;
  tentarDeNovo: () => void;
} {
  const { user, loading } = useAuth();
  const { data, errorUpdateCount, isFetching, refetch } = useQuery({
    queryKey: ["active-tenant-id", user?.id],
    enabled: !!user?.id,
    // [backend F1, review I1] 1 retry (~1 s) em vez dos 3 padrões (~7 s): sem rede a tela ficava em branco por ~7 s antes do
    // aviso e de novo depois de cada "Tentar de novo". Refetch com dado guardado não aparece na tela de qualquer jeito.
    retry: 1,
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
  // `errorUpdateCount > 0` (e não `status === "error"`): durante o "Tentar de novo" o RQ volta o status para "pending" (sem
  // dado), mas o erro NÃO some — o aviso fica na tela com o botão em "Tentando…" em vez de sumir para o branco.
  const erro = data === undefined && errorUpdateCount > 0;
  const tentando = erro && isFetching;
  // `resolvido` [modularidade F1, parte 1]: a auth terminou E (não há usuário OU a loja já chegou OU a 1ª carga falhou).
  // Antes desse ponto `tenantId === ""` NÃO significa "sem loja", significa "ainda não sei" — quem decidia por ele
  // (módulos nos DEFAULTS) redirecionava por engano numa URL direta.
  const resolvido = !loading && (!user?.id || data !== undefined || erro);
  const tentarDeNovo = () => {
    void refetch();
  };
  return { tenantId, resolvido, erro, tentando, tentarDeNovo };
}

/**
 * Relê a loja ativa DEPOIS de o servidor trocá-la (TenantSwitcher). Como a leitura que falha agora MANTÉM o valor antigo,
 * uma releitura que não trouxe a loja ESCOLHIDA (erro, pausa por falta de rede, cancelamento, corrida de 2 trocas) deixaria a
 * tela na loja ANTERIOR como se nada tivesse mudado: nesse caso zera a query do usuário atual (sem valor) para a 1ª carga
 * refazer e, se falhar de novo, aparecer o erro com "Tentar de novo" em vez de uma loja errada.
 * Devolve `true` quando a loja nova foi lida; `false` quando precisou zerar (o chamador não deve repetir a query).
 */
export async function recarregarLojaAtiva(
  qc: QueryClient,
  userId: string | undefined,
  tenantIdNovo: string,
): Promise<boolean> {
  if (!userId) {
    await qc.refetchQueries({ queryKey: ["active-tenant-id"] });
    return true;
  }
  const key = ["active-tenant-id", userId];
  await qc.refetchQueries({ queryKey: key, exact: true });
  if (qc.getQueryData<string>(key) === tenantIdNovo) return true;
  await qc.resetQueries({ queryKey: key, exact: true });
  return false;
}

export function useActiveTenantId(): string {
  return useActiveTenant().tenantId;
}

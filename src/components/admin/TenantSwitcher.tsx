import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { setActiveTenant } from "@/lib/admin.functions";
import { clearTenantPrefixCache } from "@/lib/storage-tenant";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Seletor de loja para super_admin: troca o tenant_id do próprio usuário, fazendo
 * todas as telas (que filtram por get_user_tenant_id) passarem a mostrar a loja
 * escolhida. Após trocar, LIMPA o cache do react-query para refazer as queries
 * com a nova loja — sem recarregar a página inteira (era lento e re-bootava o app).
 */
export function TenantSwitcher() {
  const { user, isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const callSet = useServerFn(setActiveTenant);

  const { data: tenants = [] } = useQuery({
    queryKey: ["tenant-switcher", "tenants"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const { data: current } = useQuery({
    queryKey: ["tenant-switcher", "current", user?.id],
    enabled: isSuperAdmin && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.tenant_id ?? null;
    },
  });

  const switchMut = useMutation({
    mutationFn: (tenant_id: string) => callSet({ data: { tenant_id } }),
    onMutate: (tenant_id: string) => {
      // Reflete SÓ o seletor imediatamente. NÃO seta o active-tenant-id otimista:
      // se setasse, a query de módulos (chaveada por tenant) refazia AGORA, com o
      // tenant ANTIGO ainda no servidor, e cacheava os módulos errados sob a chave
      // nova — por isso a sidebar não respeitava as toggles da loja selecionada.
      qc.setQueryData(["tenant-switcher", "current", user?.id], tenant_id);
    },
    onSuccess: async () => {
      // DEPOIS que o servidor trocou o tenant: relê o tenant ATIVO (muda a chave
      // das queries de identidade -> módulos/abas/fuso/logo/nomenclatura da loja
      // nova) e então invalida o resto dos dados.
      // Limpa o cache de tenantPrefix() (módulo-level): sem isso, os uploads da loja
      // nova seguiriam montando o caminho com o tenant ANTIGO e a RLS de storage
      // rejeitaria até dar F5.
      clearTenantPrefixCache();
      await qc.refetchQueries({ queryKey: ["active-tenant-id"] });
      qc.invalidateQueries();
      // Sai de qualquer CARD/detalhe: a URL podia apontar p/ um registro da loja
      // ANTERIOR (ex.: /cadastro/tecidos/<id>), que não existe na loja nova — ficava
      // preso mostrando dado velho até dar F5. Volta pro centro (/home).
      navigate({ to: "/home" });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["tenant-switcher", "current"] });
    },
  });

  if (!isSuperAdmin) return null;

  return (
    <div className="px-2 py-2">
      {tenants.length === 0 ? (
        <>
          <div className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground">
            <Store className="h-3.5 w-3.5" /> Loja em visualização
          </div>
          <p className="text-xs text-muted-foreground italic px-0.5">
            Nenhuma loja ainda — crie em Admin → Lojas.
          </p>
        </>
      ) : (
        <Select
          value={current ?? ""}
          onValueChange={(v) => switchMut.mutate(v)}
          disabled={switchMut.isPending}
        >
          {/* Cartão compacto (mockup aprovado): eyebrow + nome + chevron num alvo único. */}
          <SelectTrigger className="h-auto min-h-[44px] rounded-[10px] px-2.5 py-1.5 text-left md:min-h-0">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Store className="h-4 w-4 shrink-0 opacity-75" />
              <span className="flex min-w-0 flex-col items-start">
                <span className="text-[8.5px] font-semibold uppercase leading-none tracking-[0.1em] opacity-60">Loja em visualização</span>
                <span className="truncate text-[12.5px] font-semibold leading-tight"><SelectValue placeholder="Selecione a loja…" /></span>
              </span>
            </span>
          </SelectTrigger>
          <SelectContent>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

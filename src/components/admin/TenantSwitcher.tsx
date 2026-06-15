import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { setActiveTenant } from "@/lib/admin.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Seletor de loja para super_admin: troca o tenant_id do próprio usuário, fazendo
 * todas as telas (que filtram por get_user_tenant_id) passarem a mostrar a loja
 * escolhida. Após trocar, recarrega a página para refazer todas as queries.
 */
export function TenantSwitcher() {
  const { user, isSuperAdmin } = useAuth();
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
    onSuccess: () => window.location.reload(),
  });

  if (!isSuperAdmin) return null;

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground">
        <Store className="h-3.5 w-3.5" /> Loja em visualização
      </div>
      {tenants.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-0.5">
          Nenhuma loja ainda — crie em Admin → Lojas.
        </p>
      ) : (
        <Select
          value={current ?? ""}
          onValueChange={(v) => switchMut.mutate(v)}
          disabled={switchMut.isPending}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Selecione a loja…" />
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RequirePermission } from "@/components/RequirePermission";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scissors } from "lucide-react";

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido")({
  component: () => (
    <RequirePermission page="criacao_plan_tecido">
      <PlanTecidoListPage />
    </RequirePermission>
  ),
});

type ColecaoRow = { id: string; nome: string; tipo: string | null; status: string | null; mes_id: string | null; ano_id: string | null };

function PlanTecidoListPage() {
  const { isModuleEnabled } = useTenantModules();
  const { data: colecoes = [] } = useQuery({
    queryKey: ["plan-tecido-colecoes"],
    queryFn: async () =>
      ((await supabase.from("colecoes").select("id, nome, tipo, status, mes_id, ano_id").order("created_at", { ascending: false })).data ?? []) as ColecaoRow[],
  });

  if (!isModuleEnabled("otb")) {
    return <div className="p-6 text-sm text-muted-foreground">Ative o módulo OTB para planejar tecido por coleção.</div>;
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Scissors className="h-5 w-5" />
        <h1 className="font-display text-xl font-semibold">Plan. Tecido</h1>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {colecoes.map((c) => (
          <Link key={c.id} to="/criacao/plan-tecido/$colecaoId" params={{ colecaoId: c.id }}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2"><CardTitle className="text-base">{c.nome}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{c.tipo === "poder_venda" ? "Poder de Venda" : "Orçamento"}</Badge>
                <Badge variant={c.status === "confirmada" ? "default" : "outline"}>{c.status}</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
        {colecoes.length === 0 && <div className="text-sm text-muted-foreground">Nenhuma coleção ainda.</div>}
      </div>
    </div>
  );
}

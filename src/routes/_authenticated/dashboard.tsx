import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Package, Palette, Factory, DollarSign, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const stats = [
  { label: "Coleções ativas", value: "12", icon: Palette },
  { label: "Ordens de produção", value: "48", icon: Factory },
  { label: "Itens em estoque", value: "1.284", icon: Package },
  { label: "Cadastros", value: "326", icon: ClipboardList },
  { label: "Faturamento (mês)", value: "R$ 84,2k", icon: DollarSign },
  { label: "Eficiência geral", value: "92%", icon: BarChart3 },
];

function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visão geral da operação de criação e produção.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bem-vindo ao PLM+PCP</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use o menu lateral para navegar entre os módulos. As sub-páginas e dados reais
          serão implementados nas próximas etapas.
        </CardContent>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { DollarSign } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: () => (
    <ModulePage
      icon={DollarSign}
      title="Financeiro"
      description="Contas a pagar e receber, fluxo de caixa e custos."
      subPages={["Contas a pagar", "Contas a receber", "Fluxo de caixa", "Custos de produção"]}
    />
  ),
});

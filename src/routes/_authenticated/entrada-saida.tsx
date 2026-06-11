import { createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/entrada-saida")({
  component: () => (
    <ModulePage
      icon={Package}
      title="Entrada e Saída"
      description="Movimentação de estoque: notas de entrada, saída e transferências."
      subPages={["Notas de entrada", "Notas de saída", "Transferências", "Inventário"]}
    />
  ),
});

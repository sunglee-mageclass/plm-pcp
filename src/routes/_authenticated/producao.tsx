import { createFileRoute } from "@tanstack/react-router";
import { Factory } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/producao")({
  component: () => (
    <ModulePage
      icon={Factory}
      title="Produção"
      description="Planejamento e controle: ordens, células, apontamentos e qualidade."
      subPages={["Ordens de produção", "Planejamento (PCP)", "Apontamentos", "Qualidade", "Células"]}
    />
  ),
});

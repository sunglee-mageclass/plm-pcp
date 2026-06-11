import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: () => (
    <ModulePage
      icon={Settings}
      title="Configurações"
      description="Parâmetros gerais, integrações e preferências da empresa."
      subPages={["Empresa", "Parâmetros gerais", "Integrações", "Notificações"]}
    />
  ),
});

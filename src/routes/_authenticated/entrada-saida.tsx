import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/components/ModuleGuard";

export const Route = createFileRoute("/_authenticated/entrada-saida")({
  component: () => <ModuleGuard module="entrada_saida" />,
});

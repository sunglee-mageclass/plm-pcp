import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/components/ModuleGuard";

export const Route = createFileRoute("/_authenticated/cadastro")({
  component: () => <ModuleGuard module="cadastro" />,
});

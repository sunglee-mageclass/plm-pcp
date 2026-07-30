import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/components/ModuleGuard";

// Nível Expedição & Logística (CQ + Direcionamento + Lançamentos). Gate de contratação continua
// na flag `producao` (compartilhada com PCP).
export const Route = createFileRoute("/_authenticated/expedicao")({
  component: () => <ModuleGuard module="producao" />,
});

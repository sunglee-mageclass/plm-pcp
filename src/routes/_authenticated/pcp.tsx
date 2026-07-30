import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/components/ModuleGuard";

// Nível PCP (= Serviços). Gate de contratação continua na flag `producao` (PCP e Expedição
// compartilham a mesma flag). /pcp redireciona p/ /pcp/servicos (ver pcp.index.tsx).
export const Route = createFileRoute("/_authenticated/pcp")({
  component: () => <ModuleGuard module="producao" />,
});

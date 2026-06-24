import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
import { AlertasList } from "@/components/oc-tecido/CqTecido";

export const Route = createFileRoute("/_authenticated/entrada-saida/alertas-tecido")({
  component: () => (
    <RequirePermission page="entrada_alertas_tecido">
      <div className="container mx-auto p-3 sm:p-6 space-y-6">
        <header className="flex items-start gap-3">
          <AlertTriangle className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Alertas de Tecido</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tecidos sinalizados no CQ para revisão do estilo. Resolva com Estilo OK, troca ou cancelamento.
            </p>
          </div>
        </header>

        <AlertasList />
      </div>
    </RequirePermission>
  ),
});

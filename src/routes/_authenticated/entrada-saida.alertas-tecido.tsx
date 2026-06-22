import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
import { AlertasList } from "@/components/oc-tecido/CqTecido";

export const Route = createFileRoute("/_authenticated/entrada-saida/alertas-tecido")({
  component: () => (
    <RequirePermission page="entrada_alertas_tecido">
      <div className="container mx-auto p-3 sm:p-6 space-y-6">
        <header className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Alertas de Tecido</h1>
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

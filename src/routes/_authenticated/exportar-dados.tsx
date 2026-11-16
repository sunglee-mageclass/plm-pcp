import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { ExportarDadosPage } from "@/components/exportar/ExportarDadosPage";

export const Route = createFileRoute("/_authenticated/exportar-dados")({
  component: () => (
    <RequirePermission page="exportar_dados">
      <ExportarDadosPage />
    </RequirePermission>
  ),
});

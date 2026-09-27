import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { IntegracaoPage } from "@/components/integracao/IntegracaoPage";

export const Route = createFileRoute("/_authenticated/integracao")({
  component: () => (
    <RequirePermission page="integracao">
      <IntegracaoPage />
    </RequirePermission>
  ),
});

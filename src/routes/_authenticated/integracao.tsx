import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { IntegracaoPage } from "@/components/integracao/IntegracaoPage";
import { AvisoComputador } from "@/components/integracao/AvisoComputador";
import { useIsMobile } from "@/hooks/use-mobile";

function PaginaIntegracao() {
  // P-87: < 768 px = só o aviso — a IntegracaoPage (e as RPCs dela) nem monta.
  const estreita = useIsMobile();
  return estreita ? <AvisoComputador /> : <IntegracaoPage />;
}

export const Route = createFileRoute("/_authenticated/integracao")({
  component: () => (
    <RequirePermission page="integracao">
      <PaginaIntegracao />
    </RequirePermission>
  ),
});

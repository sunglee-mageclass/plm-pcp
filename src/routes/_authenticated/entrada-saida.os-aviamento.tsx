import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { OrdemSaidaPage } from "@/components/entrada-saida/OrdemSaidaPage";

export const Route = createFileRoute("/_authenticated/entrada-saida/os-aviamento")({
  component: () => (
    <RequirePermission page="entrada_os_aviamento">
      <OrdemSaidaPage tipo="aviamento" />
    </RequirePermission>
  ),
});

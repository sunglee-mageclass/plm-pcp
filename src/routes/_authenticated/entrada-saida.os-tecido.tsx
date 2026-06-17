import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { OrdemSaidaPage } from "@/components/entrada-saida/OrdemSaidaPage";

export const Route = createFileRoute("/_authenticated/entrada-saida/os-tecido")({
  component: () => (
    <RequirePermission page="entrada_os_tecido">
      <OrdemSaidaPage tipo="tecido" />
    </RequirePermission>
  ),
});

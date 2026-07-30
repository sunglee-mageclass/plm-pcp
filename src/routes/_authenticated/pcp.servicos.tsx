import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/pcp/servicos")({
  component: () => (
    <RequirePermission page="producao_terceirizados">
      <Outlet />
    </RequirePermission>
  ),
});

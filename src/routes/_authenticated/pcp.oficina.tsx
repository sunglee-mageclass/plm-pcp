import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/pcp/oficina")({
  component: () => (
    <RequirePermission page="producao_oficina">
      <Outlet />
    </RequirePermission>
  ),
});

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/cad")({
  component: () => (
    <RequirePermission page="producao_cad">
      <Outlet />
    </RequirePermission>
  ),
});

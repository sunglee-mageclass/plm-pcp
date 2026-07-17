import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/explosao")({
  component: () => (
    <RequirePermission page="producao_explosao">
      <Outlet />
    </RequirePermission>
  ),
});

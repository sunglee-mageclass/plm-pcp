import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/cq")({
  component: () => (
    <RequirePermission page="producao_cq">
      <Outlet />
    </RequirePermission>
  ),
});

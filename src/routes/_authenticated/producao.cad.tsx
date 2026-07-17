import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/cad")({
  beforeLoad: () => {
    throw redirect({ to: "/producao/explosao" });
  },
  component: () => (
    <RequirePermission page="producao_cad">
      <Outlet />
    </RequirePermission>
  ),
});

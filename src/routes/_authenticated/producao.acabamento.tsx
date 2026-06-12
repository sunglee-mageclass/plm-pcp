import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/acabamento")({
  component: () => (
    <RequirePermission page="producao_acabamento">
      <Outlet />
    </RequirePermission>
  ),
});

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/direcionamento")({
  component: () => (
    <RequirePermission page="producao_direcionamento">
      <Outlet />
    </RequirePermission>
  ),
});

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/cadastro/tecidos")({
  component: () => (
    <RequirePermission page="cadastro_tecidos">
      <Outlet />
    </RequirePermission>
  ),
});

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido")({
  component: () => (
    <RequirePermission page="criacao_plan_tecido">
      <Outlet />
    </RequirePermission>
  ),
});

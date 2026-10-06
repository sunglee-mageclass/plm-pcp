import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";

// Explosão = 1ª página do PCP (urgentes R9). Mesma permissão de antes (`producao_explosao`); o gate de módulo
// (Criação + Produção) vem do `PageDef.gate` / do módulo PCP no catálogo.
export const Route = createFileRoute("/_authenticated/pcp/explosao")({
  component: () => (
    <RequirePermission page="producao_explosao">
      <Outlet />
    </RequirePermission>
  ),
});

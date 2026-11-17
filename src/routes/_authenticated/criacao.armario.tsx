import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { ArmarioListPage } from "@/components/armario/ArmarioListPage";

// F7 Armário — só o armário aberto vive na URL (?armario=): a lista é por loja e os filtros Ano/Mês são estado local.
// Ano/Mês são dado próprio do armário (sem relação com coleção).
type ArmarioSearch = { armario?: string };

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_authenticated/criacao/armario")({
  validateSearch: (s: Record<string, unknown>): ArmarioSearch => ({
    armario: str(s.armario),
  }),
  component: () => (
    <RequirePermission page="criacao_armario">
      <ArmarioPage />
    </RequirePermission>
  ),
});

function ArmarioPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  return (
    <ArmarioListPage
      search={search}
      onSearch={(next) => navigate({ search: next, replace: next.armario === search.armario, resetScroll: false })}
    />
  );
}

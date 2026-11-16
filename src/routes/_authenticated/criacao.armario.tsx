import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { ArmarioListPage } from "@/components/armario/ArmarioListPage";

// F7 Armário — coleção, subcoleção e armário abertos vivem na URL (?colecao=&sub=&armario=), mesmo padrão do
// Produto Acabado (F5/Voltar preservam onde o usuário estava; tela endereçável).
type ArmarioSearch = { colecao?: string; sub?: string; armario?: string };

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_authenticated/criacao/armario")({
  validateSearch: (s: Record<string, unknown>): ArmarioSearch => ({
    colecao: str(s.colecao),
    sub: str(s.sub),
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

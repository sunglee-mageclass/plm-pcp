import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { Breadcrumb } from "@/components/shared/Breadcrumb";

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
      <ArmarioPlaceholder />
    </RequirePermission>
  ),
});

// Esqueleto navegável — as tarefas D2–D4 substituem pelo conteúdo real.
function ArmarioPlaceholder() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Estilo & Engenharia", to: "/criacao" }, { label: "Armário" }]} />
      <h1 className="text-2xl font-semibold">Armário</h1>
      <p className="text-muted-foreground">Em construção</p>
    </div>
  );
}

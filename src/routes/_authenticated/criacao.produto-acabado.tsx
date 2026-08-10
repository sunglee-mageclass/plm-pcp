import { createFileRoute, Link } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import { useTenantModules } from "@/hooks/useTenantModules";

// Stub — a tela completa (planejador Produto Acabado, canvas por coleção) é a Task 6.
// Esta rota existe só para a sidebar/hub (gate `produto_acabado`, Task 5) terem um destino.
// Sem ModuleGuard aqui de propósito — mesmo padrão do OTB (RequirePermission + gate na
// sidebar/hub via PageDef.gate); ver comentário completo em entrada-saida.oc-p-acabado.tsx.
export const Route = createFileRoute("/_authenticated/criacao/produto-acabado")({
  component: () => (
    <RequirePermission page="criacao_produto_acabado">
      <ProdutoAcabadoStub />
    </RequirePermission>
  ),
});

function ProdutoAcabadoStub() {
  // Mitigação parcial de UI (achado IMPORTANT do review, fix round 1) — mesmo raciocínio
  // de entrada-saida.oc-p-acabado.tsx: módulo OFF ainda é alcançável por URL direta com a
  // permissão de página concedida; isto só evita mostrar a tela quando dá pra saber que
  // está desligado (o gap de RLS/modgate fica pro review final).
  const { isModuleEnabled, isLoading } = useTenantModules();
  if (isLoading) return null;
  if (!isModuleEnabled("produto_acabado")) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <Package className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Módulo Produto Acabado desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Ative em <Link to="/admin/configuracoes" className="underline underline-offset-2">Config da Loja</Link> para usar o planejador Produto Acabado.
        </p>
      </div>
    );
  }
  return (
    <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <Package className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Produto Acabado</h1>
      <p className="max-w-md text-sm text-muted-foreground">Em construção.</p>
    </div>
  );
}

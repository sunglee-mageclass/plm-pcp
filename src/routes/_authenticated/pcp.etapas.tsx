import { createFileRoute, Link } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Breadcrumb } from "@/components/shared/Breadcrumb";

// Etapas PL (Fase 2, Task 1) — página ÚNICA (sem sub-rota de detalhe ainda), então o
// componente renderiza direto (sem <Outlet/>), diferente de pcp.servicos.tsx que envolve
// as sub-rotas $modeloId/index. Sem ModuleGuard aqui de propósito — mesmo precedente do
// produto_acabado/otb (CLAUDE.md, corrida de render do useTenantModules().isLoading antes
// do tenantId resolver): renderiza um empty-state próprio quando `etapas_pl` está OFF.
export const Route = createFileRoute("/_authenticated/pcp/etapas")({
  component: () => (
    <RequirePermission page="producao_etapas">
      <EtapasPlPage />
    </RequirePermission>
  ),
});

function EtapasPlPage() {
  const { isModuleEnabled, isLoading } = useTenantModules();

  // Evita flashear a tela errada no primeiro paint (mesmo padrão de criacao.produto-acabado.tsx).
  if (isLoading) return null;

  if (!isModuleEnabled("etapas_pl")) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <ListChecks className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Módulo Etapas PL desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Ative em <Link to="/admin/configuracoes" className="underline underline-offset-2">Config da Loja</Link> para usar o quadro de Etapas.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 p-3 sm:p-6">
      <Breadcrumb items={[{ label: "PCP", to: "/pcp" }, { label: "Etapas" }]} />
      <h1 className="font-display text-2xl font-semibold">Etapas — Produção PL</h1>
      <p className="text-sm text-muted-foreground">Quadro em construção (Fase 2).</p>
    </div>
  );
}

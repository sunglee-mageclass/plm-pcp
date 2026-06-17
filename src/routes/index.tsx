import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  // Landing pelo 1º módulo ativo (loja sem Dashboard cai no módulo certo, ex.: Estoque).
  const { firstActiveModulePath, isLoading: modsLoading } = useTenantModules();
  if (loading || (user && modsLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  return <Navigate to={firstActiveModulePath as any} replace />;
}

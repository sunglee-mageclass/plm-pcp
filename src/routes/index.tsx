import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";
import { HomePage } from "@/components/home/HomePage";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  // Logado: entra direto pelo 1º módulo ativo (loja sem Dashboard cai no módulo certo).
  const { firstActiveModulePath, isLoading: modsLoading } = useTenantModules();
  if (loading || (user && modsLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  // Deslogado: home pública (animação de tecelagem + Entrar). Logado: vai pro sistema.
  if (!user) return <HomePage />;
  return <Navigate to={firstActiveModulePath as any} replace />;
}

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { HomePage } from "@/components/home/HomePage";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  // Deslogado: home pública (animação + Entrar). Logado: centro /home (boas-vindas + atenção).
  if (!user) return <HomePage />;
  return <Navigate to="/home" replace />;
}

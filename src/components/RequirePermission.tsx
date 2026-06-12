import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  page?: string;
  anyOf?: string[];
  children: ReactNode;
}

export function RequirePermission({ page, anyOf, children }: Props) {
  const { canView, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  const allowed =
    (page ? canView(page) : false) ||
    (anyOf ? anyOf.some((p) => canView(p)) : false);
  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center px-4">
        <h1 className="text-xl font-semibold text-foreground">Acesso negado</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          Você não tem permissão para acessar esta página. Entre em contato com o administrador da sua loja.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

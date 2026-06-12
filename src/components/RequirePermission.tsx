import { Navigate } from "@tanstack/react-router";
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
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

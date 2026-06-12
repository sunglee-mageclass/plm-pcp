import { createContext, useContext, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  page?: string;
  anyOf?: string[];
  children: ReactNode;
}

// Propagates "read only" mode through the React tree so portaled content
// (Dialog/Sheet, which render outside the page's DOM subtree) can also
// disable their own form controls. Pages don't read this directly.
const ReadOnlyContext = createContext(false);
export function useReadOnly() {
  return useContext(ReadOnlyContext);
}

export function RequirePermission({ page, anyOf, children }: Props) {
  const { canView, canEdit, loading } = useAuth();
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

  const editable =
    (page ? canEdit(page) : false) ||
    (anyOf ? anyOf.some((p) => canEdit(p)) : false);
  if (editable) return <>{children}</>;

  return (
    <ReadOnlyContext.Provider value={true}>
      <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <Lock className="h-4 w-4 shrink-0" />
        Modo somente leitura — você não tem permissão de edição nesta área.
      </div>
      {children}
    </ReadOnlyContext.Provider>
  );
}

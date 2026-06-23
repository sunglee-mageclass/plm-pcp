import { createFileRoute, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { StoreClock } from "@/components/shared/StoreClock";
import { useAuth } from "@/hooks/useAuth";
import { useApplySystemIdentity } from "@/hooks/useSystemIdentity";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function useModuleLabel() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith("/admin")) return "Admin";
  for (const mod of PAGES_CATALOG) {
    if (pathname.startsWith(mod.basePath)) return mod.label;
  }
  return "sisTrama";
}

function AuthenticatedLayout() {
  const { user, loading, signOut } = useAuth();
  const identity = useApplySystemIdentity();
  const moduleLabel = useModuleLabel();
  // Loja inativa = suspensão real: a RLS já bloqueia os dados (get_user_tenant_id
  // retorna o UUID sentinela nil '0000…', NUNCA NULL — invariante 13); aqui só
  // mostramos a mensagem em vez de telas vazias.
  const { data: tenantAtivo } = useQuery({
    queryKey: ["meu-tenant-ativo", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("meu_tenant_ativo" as any);
      return data as boolean | null;
    },
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (tenantAtivo === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold text-foreground">Loja inativa</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          O acesso a esta loja está suspenso. Entre em contato com o suporte para reativar.
        </p>
        <button
          onClick={() => signOut()}
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
          Sair
        </button>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-14 flex items-center gap-2 border-b px-4 bg-card">
            <SidebarTrigger />
            <div className="ml-2 text-sm font-medium text-muted-foreground">
              {moduleLabel}
            </div>
            <StoreClock className="ml-auto" />
          </header>
          <main className="flex-1 p-4 sm:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

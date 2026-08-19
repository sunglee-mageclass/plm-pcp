import { createFileRoute, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { StoreClock } from "@/components/shared/StoreClock";
import { useAuth } from "@/hooks/useAuth";
import { useApplySystemIdentity } from "@/hooks/useSystemIdentity";
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { PAGE_URLS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

// Módulo dono do path atual (por basePath). null = rota não gateada por módulo (home, /admin, perfil).
// Casa basePath exato ou com "/" depois, pra "/cadastro" não pegar "/cadastroX".
function moduleForPath(pathname: string): { module: string; label: string } | null {
  for (const mod of PAGES_CATALOG) {
    if (pathname === mod.basePath || pathname.startsWith(mod.basePath + "/")) return { module: mod.module, label: mod.label };
  }
  return null;
}

function useCurrentModule() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith("/admin")) return { module: null as string | null, label: "Admin" as string | null };
  const m = moduleForPath(pathname);
  // label null = rota sem módulo (ex.: /home) → o header cai pro NOME DO SISTEMA configurado
  // (identidade, ex.: "WISH360"), nunca um nome fixo.
  return { module: m?.module ?? null, label: m?.label ?? null };
}

// Breadcrumb do header sticky: SEÇÃO › PÁGINA (dono, jul/2026 — o mockup Navy Trust v2 usa o
// breadcrumb organizado; antes o header mostrava só a seção). A página vem do catálogo casando o
// pathname com PAGE_URLS (prefixo mais longo). Sem página específica (hub no basePath, /home) →
// só a seção.
function useBreadcrumb(): { section: string | null; page: string | null } {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = pathname.startsWith("/admin") ? "Admin" : (moduleForPath(pathname)?.label ?? null);
  const mod = PAGES_CATALOG.find((m) => pathname === m.basePath || pathname.startsWith(m.basePath + "/"));
  let page: string | null = null;
  if (mod) {
    let best = "";
    for (const p of mod.pages) {
      const url = PAGE_URLS[p.key];
      if (url && (pathname === url || pathname.startsWith(url + "/")) && url.length > best.length) { best = url; page = p.label; }
    }
  }
  return { section, page };
}

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // CONGELA o primeiro pathname do mount: durante a transição pro /auth o layout re-renderiza
  // com o pathname já trocado e o <Navigate replace> regravava redirect="/auth" (QA ao vivo).
  const destinoOriginal = useRef(pathname).current;
  const { user, loading, signOut } = useAuth();
  const identity = useApplySystemIdentity();
  const { section, page } = useBreadcrumb();
  // Atualização AO VIVO entre usuários: 1 canal Realtime tenant-scoped que invalida as
  // queries de config/cadastro quando OUTRO usuário salva (item 11 do dono). No-op sem user.
  useRealtimeInvalidation();
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
    // Preserva o destino (deep-link/sessão expirada): o login volta pra cá via ?redirect=.
    return <Navigate to="/auth" search={{ redirect: destinoOriginal }} replace />;
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
          {/* sticky: o header (botão do sidebar + breadcrumb + relógio) acompanha a rolagem.
              NAVY no MOBILE (Navy Trust v2 — como o mockup); claro no desktop. z abaixo de overlays. */}
          <header className="sticky top-0 z-30 h-14 flex items-center gap-2 border-b px-4 bg-card max-md:border-transparent max-md:bg-sidebar max-md:text-sidebar-foreground">
            <SidebarTrigger className="max-md:h-11 max-md:w-11 max-md:text-sidebar-foreground max-md:hover:bg-white/10 max-md:hover:text-sidebar-foreground" />
            {/* Breadcrumb SEÇÃO › Página (dono, jul/2026). No DESKTOP mostra a cadeia inteira;
                no MOBILE só a PÁGINA (o breadcrumb completo trunca os dois lados e não cabe — dono).
                Sem página (hub/home) → a seção / nome do sistema vira o título único. */}
            <div className="ml-2 flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <span className={cn("truncate text-muted-foreground max-md:text-sidebar-foreground/70", page && "max-md:hidden")}>
                {section ?? identity.nome_sistema}
              </span>
              {page && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 max-md:hidden" />
                  <span className="truncate text-foreground max-md:text-sidebar-foreground">{page}</span>
                </>
              )}
            </div>
            {/* Slot p/ ações da PÁGINA no header (portal <HeaderActions>). No mobile navy ganha uma
                BANDEJA clara só quando tem conteúdo (`:not(:empty)`), senão os botões sumiriam no navy. */}
            <div id="sticky-header-actions" className="flex min-w-0 items-center gap-1.5 overflow-x-auto max-md:[&:not(:empty)]:rounded-lg max-md:[&:not(:empty)]:bg-card max-md:[&:not(:empty)]:px-1 max-md:[&:not(:empty)]:py-0.5 max-md:[&:not(:empty)]:text-foreground" />
            <StoreClock className="ml-auto shrink-0" />
          </header>
          <main className="flex-1 p-4 sm:p-6 overflow-x-hidden overflow-y-auto">
            {/* O gate de módulo por rota é feito pelos LAYOUTS de cada nível (<ModuleGuard module=…>,
                ex.: pcp.tsx/expedicao.tsx), que redirecionam pra loja sem o módulo. */}
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

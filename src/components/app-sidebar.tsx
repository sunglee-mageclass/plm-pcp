import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Shield,
  Settings,
  ClipboardList,
  Package,
  Palette,
  Factory,
  DollarSign,
  BarChart3,
  LogOut,
  Crown,
  Store,
  Users,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { TenantSwitcher } from "@/components/admin/TenantSwitcher";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Button } from "@/components/ui/button";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSystemIdentity } from "@/hooks/useSystemIdentity";

const MODULE_META: Record<string, { title: string; icon: typeof BarChart3 }> = {
  dashboard: { title: "Dashboard", icon: BarChart3 },
  cadastro: { title: "Cadastro", icon: ClipboardList },
  entrada_saida: { title: "Entrada e Saída", icon: Package },
  criacao: { title: "Criação", icon: Palette },
  producao: { title: "Produção", icon: Factory },
  financeiro: { title: "Financeiro", icon: DollarSign },
};

// Map of page key -> URL for sidebar subitems. Modules without an entry render as a single direct link.
const PAGE_URLS: Record<string, string> = {
  cadastro_atributos: "/cadastro/atributos",
  cadastro_colaboradores: "/cadastro/colaboradores",
  cadastro_servico: "/cadastro/servico",
  cadastro_tecidos: "/cadastro/tecidos",
  cadastro_aviamentos: "/cadastro/aviamentos",
  cadastro_etiquetas: "/cadastro/etiquetas",
  entrada_oc_tecido: "/entrada-saida/oc-tecido",
  entrada_oc_aviamento: "/entrada-saida/oc-aviamento",
  entrada_estoque: "/entrada-saida/estoque",
  criacao_planejamento: "/criacao/planejamento",
  criacao_desenvolvimento: "/criacao/desenvolvimento",
  producao_cad: "/producao/cad",
  producao_terceirizados: "/producao/terceirizados",
  // Oficina e Acabamento saíram do menu: acessados dentro de Terceirizados.
  // (rotas e permissões mantidas; só não aparecem na navegação lateral)
  producao_cq: "/producao/cq",
  producao_direcionamento: "/producao/direcionamento",
  producao_lancamentos: "/producao/lancamentos",
};

const systemItems: { title: string; url: string; icon: typeof Settings }[] = [];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin, isSuperAdmin, isTenantAdmin, canView, user, signOut } = useAuth();
  const { isModuleEnabled } = useTenantModules();

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "oficina_posicao"],
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("oficina_posicao").maybeSingle();
      return data as { oficina_posicao?: "terceirizados" | "acabamento" } | null;
    },
  });
  const oficinaPos = tenantCfg?.oficina_posicao ?? "terceirizados";

  const visibleMainItems = PAGES_CATALOG
    // Gate de módulo (a loja contratou?): vale para todos os papéis, inclusive admin.
    .filter((m) => isModuleEnabled(m.module))
    .filter((m) =>
      isAdmin || isSuperAdmin || isTenantAdmin
        ? true
        : m.pages.some((p) => canView(p.key)),
    )
    .map((m) => {
      let pages = m.pages;
      if (m.module === "producao" && oficinaPos === "acabamento") {
        const oficina = pages.find((p) => p.key === "producao_oficina");
        const rest = pages.filter((p) => p.key !== "producao_oficina");
        if (oficina) {
          const cqIdx = rest.findIndex((p) => p.key === "producao_cq");
          if (cqIdx >= 0) rest.splice(cqIdx + 1, 0, oficina);
          else rest.push(oficina);
        }
        pages = rest;
      }
      const subs = pages
        .filter((p) => PAGE_URLS[p.key] && (isAdmin || isSuperAdmin || isTenantAdmin || canView(p.key)))
        .map((p) => ({ key: p.key, label: p.label, url: PAGE_URLS[p.key] }));
      return {
        url: m.basePath,
        title: MODULE_META[m.module]?.title ?? m.label,
        icon: MODULE_META[m.module]?.icon ?? BarChart3,
        subs,
      };
    });

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className={cn("flex items-center py-3", collapsed ? "justify-center px-1" : "gap-2 px-2")}>
          <SystemBrand collapsed={collapsed} />
          <ThemeToggleButton collapsed={collapsed} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {isSuperAdmin && !collapsed && (
          <div className="border-b pb-1">
            <TenantSwitcher />
          </div>
        )}
        <SidebarGroup>
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMainItems.map((item) => {
                const active = isActive(item.url);
                if (item.subs.length === 0) {
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }
                return (
                  <Collapsible key={item.url} defaultOpen={active} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={active} tooltip={item.title}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.subs.map((sub) => (
                            <SidebarMenuSubItem key={sub.key}>
                              <SidebarMenuSubButton asChild isActive={isActive(sub.url)}>
                                <Link to={sub.url}>
                                  <span>{sub.label}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin")} tooltip="Admin">
                    <Link to="/admin">
                      <Shield className="h-4 w-4" />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center gap-1">
              <Crown className="h-3 w-3" /> Admin Mestre
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin/lojas")} tooltip="Lojas">
                    <Link to="/admin/lojas">
                      <Store className="h-4 w-4" />
                      <span>Gerenciar Lojas</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin/usuarios")} tooltip="Usuários">
                    <Link to="/admin/usuarios">
                      <Users className="h-4 w-4" />
                      <span>Gerenciar Usuários</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isTenantAdmin && !isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center gap-1">
              <Shield className="h-3 w-3" /> Admin da Loja
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/admin/usuarios-loja")}
                    tooltip="Usuários da Loja"
                  >
                    <Link to="/admin/usuarios-loja">
                      <Users className="h-4 w-4" />
                      <span>Usuários da Loja</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/admin/configuracoes")}
                    tooltip="Configurações da Loja"
                  >
                    <Link to="/admin/configuracoes">
                      <Settings className="h-4 w-4" />
                      <span>Configurações da Loja</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
        {!collapsed && user && (
          <div className="px-2 py-1 text-xs text-muted-foreground truncate">{user.email}</div>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          onClick={signOut}
          className="justify-start gap-2"
          aria-label="Sair da conta"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

function ThemeToggleButton({ collapsed }: { collapsed: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  if (collapsed) return null;
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-7 w-7 shrink-0"
            aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
          >
            {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SystemBrand({ collapsed }: { collapsed: boolean }) {
  const identity = useSystemIdentity();
  const initials = (identity.nome_sistema || "SI").slice(0, 2).toUpperCase();
  return (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm overflow-hidden aspect-square">
        {identity.logoSignedUrl ? (
          <img src={identity.logoSignedUrl} alt={identity.nome_sistema} className="h-full w-full object-contain" />
        ) : (
          initials
        )}
      </div>
      {!collapsed && (
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-semibold leading-none truncate">{identity.nome_sistema}</span>
          {identity.subtitulo && (
            <span className="text-xs text-muted-foreground mt-0.5 truncate">{identity.subtitulo}</span>
          )}
        </div>
      )}
    </>
  );
}

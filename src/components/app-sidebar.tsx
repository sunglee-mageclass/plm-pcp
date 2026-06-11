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
import { Button } from "@/components/ui/button";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";

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
  entrada_oc_tecido: "/entrada-saida/oc-tecido",
  entrada_oc_aviamento: "/entrada-saida/oc-aviamento",
  entrada_estoque: "/entrada-saida/estoque",
  criacao_planejamento: "/criacao/planejamento",
  criacao_desenvolvimento: "/criacao/desenvolvimento",
  producao_cad: "/producao/cad",
  producao_terceirizados: "/producao/terceirizados",
  producao_oficina: "/producao/oficina",
  producao_cq: "/producao/cq",
  producao_acabamento: "/producao/acabamento",
  producao_direcionamento: "/producao/direcionamento",
  producao_lancamentos: "/producao/lancamentos",
};

const systemItems = [
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin, isSuperAdmin, isTenantAdmin, canView, user, signOut } = useAuth();

  const visibleMainItems = PAGES_CATALOG
    .filter((m) =>
      isAdmin || isSuperAdmin || isTenantAdmin
        ? true
        : m.pages.some((p) => canView(p.key)),
    )
    .map((m) => {
      const subs = m.pages
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
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            P+
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-none">PLM+PCP</span>
              <span className="text-xs text-muted-foreground mt-0.5">Moda & Confecção</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
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
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

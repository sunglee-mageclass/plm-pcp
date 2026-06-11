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
} from "lucide-react";

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
  useSidebar,
} from "@/components/ui/sidebar";
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
    .map((m) => ({
      url: m.basePath,
      title: MODULE_META[m.module]?.title ?? m.label,
      icon: MODULE_META[m.module]?.icon ?? BarChart3,
    }));

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
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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

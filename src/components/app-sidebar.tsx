import { useEffect, useState } from "react";
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
  Home,
  LogOut,
  Crown,
  Store,
  Users,
  ChevronRight,
  Sun,
  Moon,
  KeyRound,
  Target,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { TenantSwitcher } from "@/components/admin/TenantSwitcher";

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
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useTabLabels } from "@/hooks/useTabLabels";
import { Button } from "@/components/ui/button";
import { PAGES_CATALOG, pageInProfile } from "@/lib/permissions-catalog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSystemIdentity } from "@/hooks/useSystemIdentity";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";

const MODULE_META: Record<string, { title: string; icon: typeof BarChart3 }> = {
  dashboard: { title: "Dashboard", icon: BarChart3 },
  cadastro: { title: "Cadastro", icon: ClipboardList },
  entrada_saida: { title: "Entrada e Saída", icon: Package },
  criacao: { title: "Estilo & Engenharia", icon: Palette },
  producao: { title: "PCP", icon: Factory },
  financeiro: { title: "Financeiro", icon: DollarSign },
  otb: { title: "OTB", icon: Target },
};

// Map of page key -> URL for sidebar subitems. Modules without an entry render as a single direct link.
const PAGE_URLS: Record<string, string> = {
  cadastro_atributos: "/cadastro/atributos",
  cadastro_colaboradores: "/cadastro/colaboradores",
  cadastro_servico: "/cadastro/servico",
  cadastro_tecidos: "/cadastro/tecidos",
  cadastro_aviamentos: "/cadastro/aviamentos",
  cadastro_etiquetas: "/cadastro/etiquetas",
  cadastro_destinos: "/cadastro/destinos",
  entrada_oc_tecido: "/entrada-saida/oc-tecido",
  entrada_alertas_tecido: "/entrada-saida/alertas-tecido",
  entrada_oc_aviamento: "/entrada-saida/oc-aviamento",
  entrada_oc_insumo: "/entrada-saida/oc-insumo",
  entrada_os_tecido: "/entrada-saida/os-tecido",
  entrada_os_aviamento: "/entrada-saida/os-aviamento",
  entrada_estoque: "/entrada-saida/estoque",
  criacao_plan_tecido: "/criacao/plan-tecido",
  criacao_planejamento: "/criacao/planejamento",
  criacao_desenvolvimento: "/criacao/desenvolvimento",
  producao_explosao: "/entrada-saida/explosao",
  producao_terceirizados: "/producao/terceirizados",
  // Oficina é acessada dentro de Serviços; não aparece como item próprio na navegação lateral.
  producao_cq: "/producao/cq",
  producao_direcionamento: "/producao/direcionamento",
  producao_lancamentos: "/producao/lancamentos",
};

// Bolinhas de atenção ao lado de itens do menu (contadores vindos da RPC sidebar_badges).
// A cor comunica urgência: atraso = vermelho, alerta = âmbar, pronto p/ lançar = azul.
const BADGE_CLS: Record<string, string> = {
  criacao_planejamento: "bg-sky-500 text-white",
  entrada_alertas_tecido: "bg-amber-500 text-white",
  entrada_oc_tecido: "bg-red-500 text-white",
  entrada_oc_aviamento: "bg-red-500 text-white",
  entrada_oc_insumo: "bg-red-500 text-white",
  otb_divergencia: "bg-red-500 text-white",
  producao_terceirizados: "bg-red-500 text-white",
  producao_cq: "bg-red-500 text-white",
  producao_direcionamento: "bg-red-500 text-white",
};

function NavBadge({ n, className }: { n: number; className?: string }) {
  if (!n || n <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // No mobile, ao navegar (clicar num item), esconde a sidebar automaticamente.
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  const { isAdmin, isSuperAdmin, isTenantAdmin, canView, user, signOut } = useAuth();
  const { isModuleEnabled, isStockOnly } = useTenantModules();
  const profile = isStockOnly ? "stock" : "full";
  const tabLabels = useTabLabels();
  // "Planejamento de Produto" é longo demais na sidebar → encurta p/ "Plan. Produto"
  // (o nome por extenso segue no catálogo/permissões e no título da tela).
  const labelFor = (key: string, fallback: string) => {
    if (tabLabels[key]) return tabLabels[key];
    if (key === "criacao_plan_tecido") return "Plan. Tecido";
    if (key === "criacao_planejamento") return "Plan. Produto";
    return fallback;
  };

  // Contadores de atenção da sidebar (uma RPC leve, tenant-scoped). refetch on focus +
  // rede de segurança a cada 60s; o "Lançar"/alertas/OC invalidam ["sidebar-badges"].
  const { data: badges } = useQuery({
    queryKey: ["sidebar-badges"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sidebar_badges" as any);
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const countFor: Record<string, number> = {
    criacao_planejamento: Number(badges?.prontos_lancar ?? 0),
    entrada_alertas_tecido: Number(badges?.alertas_tecido ?? 0),
    entrada_oc_tecido: Number(badges?.oc_tecido_atrasada ?? 0),
    entrada_oc_aviamento: Number(badges?.oc_aviamento_atrasada ?? 0),
    entrada_oc_insumo: Number(badges?.oc_etiqueta_atrasada ?? 0),
    otb_divergencia: Number(badges?.otb_divergencia ?? 0),
    producao_terceirizados: Number(badges?.erro_terceirizados ?? 0),
    producao_cq: Number(badges?.erro_cq ?? 0),
    producao_direcionamento: Number(badges?.erro_direcionamento ?? 0),
  };
  // Agregado por módulo (quando o grupo está recolhido/ícone): soma + cor da MAIOR urgência
  // entre os subs presentes, derivada do BADGE_CLS de cada um (vermelho > âmbar > azul).
  // Assim os #Erro de produção (producao_cq/terceirizados/direcionamento = bg-red) pintam o
  // grupo PCP de VERMELHO, em vez de cair no default azul.
  const itemBadge = (subs: { key: string }[]) => {
    const present = subs.filter((s) => (countFor[s.key] ?? 0) > 0);
    const total = present.reduce((a, s) => a + (countFor[s.key] ?? 0), 0);
    const hasRed = present.some((s) => (BADGE_CLS[s.key] ?? "").includes("bg-red"));
    const hasAmber = present.some((s) => (BADGE_CLS[s.key] ?? "").includes("bg-amber"));
    const cls = hasRed ? "bg-red-500 text-white" : hasAmber ? "bg-amber-500 text-white" : "bg-sky-500 text-white";
    return { total, cls };
  };

  const visibleMainItems = PAGES_CATALOG
    // Gate de módulo (a loja contratou?): vale para todos os papéis, inclusive admin.
    .filter((m) => isModuleEnabled(m.module))
    .filter((m) =>
      isAdmin || isSuperAdmin || isTenantAdmin
        ? true
        : m.pages.some((p) => canView(p.key)),
    )
    .map((m) => {
      const subs = m.pages
        .filter((p) => pageInProfile(p, profile))
        .filter((p) => PAGE_URLS[p.key] && (isAdmin || isSuperAdmin || isTenantAdmin || canView(p.key)))
        .map((p) => ({ key: p.key, label: labelFor(p.key, p.label), url: PAGE_URLS[p.key] }));
      return {
        url: m.basePath,
        title: tabLabels[m.module] || MODULE_META[m.module]?.title || m.label,
        icon: MODULE_META[m.module]?.icon ?? BarChart3,
        subs,
      };
    });

  // Topo (a pedido do dono): OTB e Estilo & Engenharia logo abaixo de Início.
  const moveTop = (url: string) => {
    const i = visibleMainItems.findIndex((x) => x.url === url);
    if (i > 0) visibleMainItems.unshift(visibleMainItems.splice(i, 1)[0]);
  };
  moveTop("/criacao"); // Criação sobe primeiro…
  moveTop("/otb");     // …e OTB fica acima dela.

  // Cadastro vai pro FIM, logo abaixo de Dashboard, separado por uma linha (pedido do dono).
  const cadastroItem = visibleMainItems.find((x) => x.url === "/cadastro");
  const mainItems = visibleMainItems.filter((x) => x.url !== "/cadastro");

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  const renderItem = (item: (typeof visibleMainItems)[number]) => {
    const active = isActive(item.url);
    const { total: badgeTotal, cls: badgeCls } = itemBadge(item.subs);
    if (item.subs.length === 0) {
      // OTB divergência: espelha o padrão dos itens com subitens — pílula (NavBadge)
      // quando aberto, dot no canto quando recolhido.
      const otbDiv = item.url === "/otb" ? (countFor.otb_divergencia ?? 0) : 0;
      return (
        <SidebarMenuItem key={item.url}>
          <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
            <Link to={item.url} className="relative">
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
              {otbDiv > 0 && (collapsed
                ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" title="Coleção(ões) com divergência" />
                : <NavBadge n={otbDiv} className={cn("ml-auto", BADGE_CLS.otb_divergencia)} />
              )}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    }
    return (
      <Collapsible key={item.url} defaultOpen={active} className="group/collapsible">
        <SidebarMenuItem>
          {collapsed ? (
            // Sidebar recolhida: o ícone do módulo NAVEGA pra página de cards
            // (basePath), em vez de só abrir o submenu (que fica escondido).
            <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
              <Link to={item.url} className="relative">
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
                {/* Ícone-only (sidebar recolhida): dot no canto sinaliza pendências. */}
                {badgeTotal > 0 && <span className={cn("absolute right-1 top-1 h-2 w-2 rounded-full", badgeCls)} />}
              </Link>
            </SidebarMenuButton>
          ) : (
            <CollapsibleTrigger asChild>
              <SidebarMenuButton isActive={active} tooltip={item.title}>
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
                {badgeTotal > 0 && <NavBadge n={badgeTotal} className={cn("ml-auto", badgeCls)} />}
                <ChevronRight className={cn("h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90", badgeTotal > 0 ? "ml-1" : "ml-auto")} />
              </SidebarMenuButton>
            </CollapsibleTrigger>
          )}
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.subs.map((sub) => (
                <SidebarMenuSubItem key={sub.key}>
                  <SidebarMenuSubButton asChild isActive={isActive(sub.url)}>
                    <Link to={sub.url}>
                      <span>{sub.label}</span>
                      {(countFor[sub.key] ?? 0) > 0 && (
                        <NavBadge n={countFor[sub.key]} className={cn("ml-auto", BADGE_CLS[sub.key])} />
                      )}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className={cn("flex items-center py-3", collapsed ? "justify-center px-1" : "gap-2 px-2")}>
          {/* Logo + nome levam ao Início (convenção universal). Toggle de tema fica de fora. */}
          <Link
            to="/home"
            aria-label="Ir para o Início"
            className={cn(
              "flex min-w-0 items-center rounded-md transition-opacity hover:opacity-80",
              collapsed ? "justify-center" : "flex-1 gap-2",
            )}
          >
            <SystemBrand collapsed={collapsed} />
          </Link>
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
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/home")} tooltip="Início">
                  <Link to="/home">
                    <Home className="h-4 w-4" />
                    <span>Início</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {mainItems.map(renderItem)}
              {/* Cadastro abaixo de Dashboard, separado por uma linha. */}
              {cadastroItem && (
                <>
                  <SidebarSeparator className="my-1" />
                  {renderItem(cadastroItem)}
                </>
              )}

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* "Sistema" só aparece para quem tem acesso de admin (antes o cabeçalho ficava
            visível e vazio para usuário comum). */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Sistema</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin")} tooltip="Admin">
                    <Link to="/admin">
                      <Shield className="h-4 w-4" />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

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
        <TrocarSenhaDialog collapsed={collapsed} />
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
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-7 w-7 shrink-0"
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}

// Qualquer usuário troca a PRÓPRIA senha (auth.updateUser usa a sessão atual; não
// precisa de admin). Fica no rodapé da sidebar, ao lado de "Sair".
function TrocarSenhaDialog({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [senha, setSenha] = useState("");
  const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false);

  const clearFields = () => { setSenha(""); setConf(""); };
  // Campos de senha são transientes (não vêm de um registro); dirty = qualquer campo preenchido.
  const dirty = open && (senha !== "" || conf !== "");
  const { requestClose, confirm } = useUnsavedGuard({
    dirty,
    onClose: () => { setOpen(false); clearFields(); },
  });

  const submit = async () => {
    if (senha.length < 6) { toast.error("A senha deve ter ao menos 6 caracteres."); return; }
    if (senha !== conf) { toast.error("As senhas não conferem."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setBusy(false);
    if (error) { toast.error(mensagemErro(error, "Erro ao trocar a senha.")); return; }
    toast.success("Senha alterada.");
    setOpen(false);
    clearFields();
  };

  return (
    <>
      <UnsavedChangesGuard confirm={confirm} message="A nova senha ainda não foi salva." />
      <Dialog open={open} onOpenChange={(o) => { if (o) setOpen(true); else requestClose(); }}>
        <DialogTrigger asChild>
          <Button variant="ghost" size={collapsed ? "icon" : "sm"} className="justify-start gap-2" aria-label="Trocar senha">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {!collapsed && <span>Trocar senha</span>}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Trocar senha</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nova-senha">Nova senha</Label>
              <Input id="nova-senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf-senha">Confirmar nova senha</Label>
              <Input id="conf-senha" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

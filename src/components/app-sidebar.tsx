import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Shield,
  Settings,
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
  ArrowLeft,
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
import { useSidebarBadges } from "@/hooks/useSidebarBadges";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useTabLabels } from "@/hooks/useTabLabels";
import { Button } from "@/components/ui/button";
import { PAGES_CATALOG, pageInProfile } from "@/lib/permissions-catalog";
import { PAGE_URLS, MODULE_META, BADGE_CLS, pageBadgeCounts } from "@/lib/nav";
import { NavBadge } from "@/components/shared/NavBadge";
import { supabase } from "@/integrations/supabase/client";
import { useSystemIdentity } from "@/hooks/useSystemIdentity";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";

// MODULE_META (título/ícone por módulo) e PAGE_URLS (key→URL) agora vivem em @/lib/nav (SSOT),
// compartilhados com os HUBs de setor (SectionHub) pra os bloquinhos não desatualizarem.

// Bolinhas de atenção ao lado de itens do menu (contadores vindos da RPC sidebar_badges).
// A cor comunica urgência: atraso = vermelho, alerta = âmbar, pronto p/ lançar = azul.


export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // No mobile, ao navegar (clicar num item), esconde a sidebar automaticamente.
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  const { isAdmin, isSuperAdmin, isTenantAdmin, canView, user, signOut } = useAuth();
  // Iniciais p/ o avatar do rodapé: nome real se houver; senão prefixo do e-mail.
  const fullName = (((user?.user_metadata as any)?.full_name as string) || "").trim();
  const userInitials = (fullName
    ? fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")
    : (user?.email ?? "?").slice(0, 2)).toUpperCase();
  const { isModuleEnabled, isStockOnly } = useTenantModules();
  const profile = isStockOnly ? "stock" : "full";
  const tabLabels = useTabLabels();
  // "Planejamento de Produto" é longo demais na sidebar → encurta p/ "Plan. Produto"
  // (o nome por extenso segue no catálogo/permissões e no título da tela).
  const labelFor = (key: string, fallback: string) => {
    if (tabLabels[key]) return tabLabels[key];
    for (const m of PAGES_CATALOG) {
      const pg = m.pages.find((x) => x.key === key);
      if (pg?.shortLabel) return pg.shortLabel;
    }
    return fallback;
  };

  // Contadores de atenção (fonte única compartilhada com a Home — useSidebarBadges).
  const { data: badges } = useSidebarBadges();
  const countFor: Record<string, number> = pageBadgeCounts(badges);
  // Agregado por módulo (quando o grupo está recolhido/ícone): soma + cor da MAIOR urgência
  // entre os subs presentes, derivada do BADGE_CLS de cada um (vermelho > âmbar > azul).
  // Assim os #Erro de produção (producao_cq/terceirizados/direcionamento = bg-red) pintam o
  // grupo PCP de VERMELHO, em vez de cair no default azul.
  const itemBadge = (subs: { key: string }[]) => {
    const present = subs.filter((s) => (countFor[s.key] ?? 0) > 0);
    const total = present.reduce((a, s) => a + (countFor[s.key] ?? 0), 0);
    const hasRed = present.some((s) => (BADGE_CLS[s.key] ?? "").includes("bg-red"));
    const hasAmber = present.some((s) => (BADGE_CLS[s.key] ?? "").includes("bg-amber"));
    const cls = hasRed ? "bg-red-600 text-white" : hasAmber ? "bg-amber-400 text-amber-950" : "bg-sky-300 text-sky-950";
    return { total, cls };
  };

  const visibleMainItems = PAGES_CATALOG
    // Gate de módulo (a loja contratou?): vale para todos os papéis, inclusive admin.
    .filter((m) => isModuleEnabled(m.gate ?? m.module))
    .filter((m) =>
      isAdmin || isSuperAdmin || isTenantAdmin
        ? true
        // Espelha o filtro dos BLOCOS do hub: página real (não-soEdicao), gate de página
        // ligado, no perfil da loja — senão o link pousa num hub vazio (ex.: usuário só
        // com "Aprovar mão de obra", ou módulo cujas páginas visíveis estão todas gateadas).
        : m.pages.some((p) => !p.soEdicao && (!p.gate || isModuleEnabled(p.gate)) && pageInProfile(p, profile) && canView(p.key)),
    )
    .map((m) => {
      const subs = m.pages
        .filter((p) => pageInProfile(p, profile))
        // Gate de PÁGINA (ex.: produto_acabado dentro de criacao/entrada_saida): além do
        // gate do módulo (já filtrado acima), a própria página pode exigir outra flag.
        .filter((p) => !p.gate || isModuleEnabled(p.gate))
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
                ? <NavBadge n={otbDiv} className={cn("absolute right-0.5 top-0.5 h-3.5 min-w-[0.875rem] px-1 text-[9px]", BADGE_CLS.otb_divergencia)} />
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
            // Sidebar recolhida: o ícone do módulo abre o HUB do setor (basePath) com os bloquinhos.
            // O hub agora DERIVA os blocos do catálogo (SectionHub) — não fica mais desatualizado.
            <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
              <Link to={item.url} className="relative">
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
                {/* Ícone-only (sidebar recolhida): CONTAGEM no canto (era só um dot). */}
                {badgeTotal > 0 && <NavBadge n={badgeTotal} className={cn("absolute right-0.5 top-0.5 h-3.5 min-w-[0.875rem] px-1 text-[9px]", badgeCls)} />}
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

      <SidebarFooter className="border-t p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <TrocarSenhaDialog />
            <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8" aria-label="Sair da conta" title="Sair">
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          /* Cartão de usuário (mockup aprovado): avatar + e-mail + ações em ícone. */
          <div className="flex items-center gap-2 rounded-[10px] bg-sidebar-accent/50 px-2 py-1.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sidebar-accent font-display text-[11px] font-semibold">
              {userInitials}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{user?.email}</span>
            <TrocarSenhaDialog />
            <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 shrink-0 max-md:h-11 max-md:w-11" aria-label="Sair da conta" title="Sair">
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
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
      className="h-7 w-7 shrink-0 max-md:h-11 max-md:w-11"
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}

// Qualquer usuário troca a PRÓPRIA senha (auth.updateUser usa a sessão atual; não
// precisa de admin). Fica no rodapé da sidebar, ao lado de "Sair".
function TrocarSenhaDialog() {
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
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 max-md:h-11 max-md:w-11" aria-label="Trocar senha" title="Trocar senha">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
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
          {/* Rodapé §G: Voltar à esquerda (nunca "Cancelar"), Salvar à direita (ml-auto);
              flex items-center gap-2 — NÃO justify-end (espelha ColecaoSheet.tsx/cadastro.lojas.tsx). */}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={requestClose}>
              <ArrowLeft className="h-4 w-4 mr-1" />Voltar
            </Button>
            <Button className="ml-auto" onClick={submit} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          </div>
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground font-display font-bold text-sm overflow-hidden aspect-square">
        {identity.logoSignedUrl ? (
          <img src={identity.logoSignedUrl} alt={identity.nome_sistema} className="h-full w-full object-contain" />
        ) : (
          initials
        )}
      </div>
      {!collapsed && (
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-display text-sm font-semibold leading-none truncate">{identity.nome_sistema}</span>
          {identity.subtitulo && (
            <span className="text-xs text-muted-foreground mt-0.5 truncate">{identity.subtitulo}</span>
          )}
        </div>
      )}
    </>
  );
}

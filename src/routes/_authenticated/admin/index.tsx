import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Shield, Building2, Users, UserCog, Settings, Palette, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminPage,
});

type AdminLink = { to: string; icon: LucideIcon; title: string; description: string };

function AdminPage() {
  const { isAdmin, isSuperAdmin, isTenantAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const links: AdminLink[] = isSuperAdmin
    ? [
        { to: "/admin/lojas", icon: Building2, title: "Gerenciar Lojas", description: "Criar, editar e desativar lojas do sistema." },
        { to: "/admin/usuarios", icon: Users, title: "Gerenciar Usuários", description: "Visão global de usuários e papéis de todas as lojas." },
        { to: "/admin/configuracoes", icon: Settings, title: "Configurações da Loja", description: "Fuso horário, parâmetros de produção, grade, kanban e nomes de campos da loja em visualização." },
        { to: "/admin/identidade", icon: Palette, title: "Identidade do Sistema", description: "Nome, subtítulo, logo e favicon exibidos no sistema." },
        { to: "/admin/auditoria", icon: ScrollText, title: "Auditoria", description: "Log de todos os eventos: o que foi criado, editado ou excluído, por quem e quando." },
      ]
    : isTenantAdmin
      ? [
          { to: "/admin/usuarios-loja", icon: UserCog, title: "Usuários da Minha Loja", description: "Convidar, editar e definir permissões dos usuários." },
          { to: "/admin/configuracoes", icon: Settings, title: "Configurações da Loja", description: "Parâmetros de produção, grade, kanban e nomes de campos." },
          { to: "/admin/auditoria", icon: ScrollText, title: "Auditoria", description: "Log dos eventos da sua loja: criado, editado ou excluído, por quem e quando." },
        ]
      : [];

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-start gap-3">
        <Shield className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão de usuários, lojas e configurações do sistema.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="block">
            {/* Mesmo shell do SectionHub (dono, jul/2026): p-4, descrição text-sm line-clamp-2 e SEM
                CardContent vazio — antes o padding extra deixava os cards mais altos com espaço morto. */}
            <Card className="flex h-full flex-row items-start gap-3 p-4 transition-all hover:-translate-y-px hover:shadow-md">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/15 text-primary">
                <l.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">{l.title}</CardTitle>
                <CardDescription className="text-sm line-clamp-2">{l.description}</CardDescription>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

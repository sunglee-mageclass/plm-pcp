import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Shield, Building2, Users, UserCog, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      ]
    : isTenantAdmin
      ? [
          { to: "/admin/usuarios-loja", icon: UserCog, title: "Usuários da Minha Loja", description: "Convidar, editar e definir permissões dos usuários." },
          { to: "/admin/configuracoes", icon: Settings, title: "Configurações da Loja", description: "Parâmetros de produção, grade, kanban e nomes de campos." },
        ]
      : [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Shield className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão de usuários, lojas e configurações do sistema.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="block">
            <Card className="h-full hover:border-primary/60 hover:shadow-sm transition-all">
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <l.icon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-base">{l.title}</CardTitle>
                  <CardDescription className="text-xs">{l.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

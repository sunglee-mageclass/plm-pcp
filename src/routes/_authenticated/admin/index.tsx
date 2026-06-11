import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { ModulePage } from "@/components/module-page";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return (
    <ModulePage
      icon={Shield}
      title="Admin"
      description="Gestão de usuários, papéis e configurações avançadas do sistema."
      subPages={["Usuários", "Papéis & Permissões", "Auditoria", "Logs do sistema"]}
    />
  );
}

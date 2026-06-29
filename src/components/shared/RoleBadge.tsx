import { StatusBadge } from "@/components/shared/StatusBadge";

// Badge de role padronizado (mesma cor/label nas telas de super_admin e de loja).
export function RoleBadge({ role }: { role: string }) {
  if (role === "super_admin") return <StatusBadge tone="warning">Super Admin</StatusBadge>;
  if (role === "admin") return <StatusBadge tone="info">Admin</StatusBadge>;
  if (role === "tenant_admin") return <StatusBadge tone="info">Admin da Loja</StatusBadge>;
  return <StatusBadge tone="neutral">Usuário</StatusBadge>;
}

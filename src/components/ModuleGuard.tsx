import { Navigate, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTenantModules } from "@/hooks/useTenantModules";

/**
 * Guarda de módulo: se a loja não tem o módulo habilitado, redireciona para o
 * primeiro módulo ativo (NUNCA hardcode /dashboard — ele pode estar desligado).
 * Sem children, renderiza o <Outlet/> da rota-layout.
 */
export function ModuleGuard({ module, children }: { module: string; children?: ReactNode }) {
  const { isModuleEnabled, firstActiveModulePath, isLoading } = useTenantModules();
  if (isLoading) return null; // evita flash de conteúdo antes de carregar a config
  if (!isModuleEnabled(module)) return <Navigate to={firstActiveModulePath as any} replace />;
  return <>{children ?? <Outlet />}</>;
}

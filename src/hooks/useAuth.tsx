import { createContext, useContext, useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearTenantPrefixCache } from "@/lib/storage-tenant";

export type UserPermission = { pagina: string; pode_ver: boolean; pode_editar: boolean };

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isTenantAdmin: boolean;
  permissions: UserPermission[];
  canView: (pagina: string) => boolean;
  canEdit: (pagina: string) => boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = (uid: string) => {
      setTimeout(async () => {
        try {
          const [{ data: rolesData }, { data: permsData }] = await Promise.all([
            supabase.from("user_roles").select("role").eq("user_id", uid),
            supabase
              .from("user_permissions")
              .select("pagina,pode_ver,pode_editar")
              .eq("user_id", uid),
          ]);
          const roles = (rolesData ?? []).map((r) => r.role);
          setIsSuperAdmin(roles.includes("super_admin"));
          setIsTenantAdmin(roles.includes("tenant_admin"));
          setIsAdmin(
            roles.includes("admin") ||
              roles.includes("super_admin") ||
              roles.includes("tenant_admin"),
          );
          setPermissions((permsData ?? []) as UserPermission[]);
        } finally {
          // Só liberamos o gate DEPOIS que roles/permissões chegaram. Setar
          // loading=false antes (como era) deixava um tick com permissions=[] →
          // telas gateadas (Financeiro, abas do Dashboard) piscavam "Acesso negado".
          setLoading(false);
        }
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Qualquer mudança de sessão (login/logout/refresh) pode significar outro
      // usuário/loja: invalida o cache módulo-level de tenantPrefix() p/ não vazar
      // o tenant anterior nos uploads.
      clearTenantPrefixCache();
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
      } else {
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setIsTenantAdmin(false);
        setPermissions([]);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      // loading só vira false dentro do loadProfile (após perms) ou aqui quando
      // não há usuário — senão pisca "Acesso negado" antes das permissões.
      if (s?.user) loadProfile(s.user.id);
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Admin/super_admin/tenant_admin always bypass page restrictions.
  // Memoizados p/ não recriar o value do contexto a cada render (evita re-render de
  // toda a árvore autenticada que consome useAuth).
  const canView = useCallback((pagina: string) => {
    if (isSuperAdmin || isAdmin || isTenantAdmin) return true;
    return permissions.some((p) => p.pagina === pagina && p.pode_ver);
  }, [isSuperAdmin, isAdmin, isTenantAdmin, permissions]);
  const canEdit = useCallback((pagina: string) => {
    if (isSuperAdmin || isAdmin || isTenantAdmin) return true;
    return permissions.some((p) => p.pagina === pagina && p.pode_editar);
  }, [isSuperAdmin, isAdmin, isTenantAdmin, permissions]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(() => ({
    user, session,
    isAdmin, isSuperAdmin, isTenantAdmin,
    permissions, canView, canEdit,
    loading, signOut,
  }), [user, session, isAdmin, isSuperAdmin, isTenantAdmin, permissions, canView, canEdit, loading, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

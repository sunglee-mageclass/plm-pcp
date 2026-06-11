import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
      } else {
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setIsTenantAdmin(false);
        setPermissions([]);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadProfile(s.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Admin/super_admin/tenant_admin always bypass page restrictions.
  const canView = (pagina: string) => {
    if (isSuperAdmin || isAdmin || isTenantAdmin) return true;
    return permissions.some((p) => p.pagina === pagina && p.pode_ver);
  };
  const canEdit = (pagina: string) => {
    if (isSuperAdmin || isAdmin || isTenantAdmin) return true;
    return permissions.some((p) => p.pagina === pagina && p.pode_editar);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user, session,
        isAdmin, isSuperAdmin, isTenantAdmin,
        permissions, canView, canEdit,
        loading, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SystemIdentity = {
  id: string;
  nome_sistema: string;
  subtitulo: string;
  logo_url: string | null;
  favicon_url: string | null;
};

const DEFAULTS: SystemIdentity = {
  id: "",
  nome_sistema: "WISH360",
  subtitulo: "Moda & Confecção",
  logo_url: null,
  favicon_url: null,
};

// Branding é público (bucket system-identity público): URL estável, sem expirar e sem
// round-trip de assinatura. Guardamos só o path; a URL pública é montada na hora.
function publicUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from("system-identity").getPublicUrl(path).data.publicUrl ?? null;
}

export function useSystemIdentity() {
  const query = useQuery({
    queryKey: ["system_identity"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("id, nome_sistema, subtitulo, logo_url, favicon_url")
        .maybeSingle();
      const row = (data ?? DEFAULTS) as SystemIdentity;
      return {
        ...row,
        nome_sistema: row.nome_sistema || DEFAULTS.nome_sistema,
        subtitulo: row.subtitulo || DEFAULTS.subtitulo,
        logoSignedUrl: publicUrl(row.logo_url),
        faviconSignedUrl: publicUrl(row.favicon_url),
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...DEFAULTS,
    ...(query.data ?? {}),
    logoSignedUrl: query.data?.logoSignedUrl ?? null,
    faviconSignedUrl: query.data?.faviconSignedUrl ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/** Aplica title e favicon dinamicamente. Usar uma vez no shell autenticado e no /auth. */
export function useApplySystemIdentity() {
  const identity = useSystemIdentity();

  useEffect(() => {
    const title = identity.subtitulo
      ? `${identity.nome_sistema} — ${identity.subtitulo}`
      : identity.nome_sistema;
    document.title = title;
  }, [identity.nome_sistema, identity.subtitulo]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const href = identity.faviconSignedUrl;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    // Favicon removido: tira o <link> (volta ao ícone padrão do navegador) em vez de
    // deixar preso o antigo até dar reload.
    if (!href) {
      if (link) link.remove();
      return;
    }
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [identity.faviconSignedUrl]);

  return identity;
}

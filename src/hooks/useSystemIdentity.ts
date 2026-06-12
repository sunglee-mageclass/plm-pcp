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
  nome_sistema: "PLM+PCP",
  subtitulo: "Moda & Confecção",
  logo_url: null,
  favicon_url: null,
};

async function fetchSignedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  // Stored as raw object path inside the bucket
  const { data } = await supabase.storage
    .from("system-identity")
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
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
      const [logoSigned, faviconSigned] = await Promise.all([
        fetchSignedUrl(row.logo_url),
        fetchSignedUrl(row.favicon_url),
      ]);
      return {
        ...row,
        nome_sistema: row.nome_sistema || DEFAULTS.nome_sistema,
        subtitulo: row.subtitulo || DEFAULTS.subtitulo,
        logoSignedUrl: logoSigned,
        faviconSignedUrl: faviconSigned,
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
    if (!href) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [identity.faviconSignedUrl]);

  return identity;
}

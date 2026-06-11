import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "tecido-variantes";
const cache = new Map<string, { url: string; exp: number }>();

export function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    const now = Date.now();
    const cached = cache.get(path);
    if (cached && cached.exp > now + 60_000) {
      setUrl(cached.url);
      return;
    }
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data?.signedUrl) return;
        cache.set(path, { url: data.signedUrl, exp: now + 3600_000 });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  return url;
}

export const VARIANT_BUCKET = BUCKET;

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "tecido-variantes";
const cache = new Map<string, { url: string; exp: number }>();

export function useSignedUrl(path: string | null | undefined, bucket: string = BUCKET) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    const key = `${bucket}/${path}`;
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.exp > now + 60_000) {
      setUrl(cached.url);
      return;
    }
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data?.signedUrl) return;
        cache.set(key, { url: data.signedUrl, exp: now + 3600_000 });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [path, bucket]);

  return url;
}

export const VARIANT_BUCKET = BUCKET;

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function ModeloPhoto({ path, alt }: { path: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage.from("modelos").createSignedUrl(path, 3600).then(({ data }) => {
      if (alive && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return url ? (
    <img src={url} alt={alt ?? "Foto do modelo"} className="h-full w-full object-cover" />
  ) : (
    <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
  );
}

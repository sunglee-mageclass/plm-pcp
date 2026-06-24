import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { ImagePreview } from "@/components/shared/ImagePreview";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function ModeloPhoto({ path, alt, fit = "cover", expandable = false }: { path: string; alt?: string; fit?: "cover" | "contain"; expandable?: boolean }) {
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
  if (!url) return <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />;
  const img = (
    <img
      src={url}
      alt={alt ?? "Foto do modelo"}
      className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
    />
  );
  return expandable ? (
    <ImagePreview src={url} alt={alt ?? "Foto do modelo"} className="h-full w-full">
      {img}
    </ImagePreview>
  ) : (
    img
  );
}

/**
 * Foto do modelo para IMPRESSÃO: <img> que RESPEITA a proporção da imagem
 * enviada (object-contain, sem deformar/quadrar), limitada por maxH/maxW.
 * Usada nas fichas (uma por foto, lado a lado).
 */
export function ModeloPhotoPrint({ path, maxH = 240, maxW = 190 }: { path: string; maxH?: number; maxW?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage.from("modelos").createSignedUrl(path, 3600).then(({ data }) => {
      if (alive && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  if (!url) return null;
  return (
    <img
      src={url}
      alt="Foto do modelo"
      style={{ maxHeight: maxH, maxWidth: maxW, height: "auto", width: "auto", objectFit: "contain", border: "1px solid #999" }}
    />
  );
}

import { useSignedUrl } from "@/hooks/useSignedUrl";
import { ImageIcon } from "lucide-react";

/**
 * Thumbnail da foto do modelo, com a hierarquia de capa padrão
 * (Foto do Modelo → Desenho Técnico → Croqui → placeholder). Reutilizado nos
 * resumos das telas de produção (Serviços, CQ, Direcionamento). Lê do bucket
 * `modelos` via useSignedUrl; PDF cai no placeholder.
 */
export function ModeloResumoFoto({
  fontes,
  nome,
  className = "h-16 w-16",
}: {
  fontes: (string | null | undefined)[];
  nome?: string | null;
  className?: string;
}) {
  const path = fontes.find(Boolean) ?? null;
  const isPdf = /\.pdf$/i.test(path ?? "");
  const url = useSignedUrl(path, "modelos");
  return (
    <div className={`shrink-0 overflow-hidden rounded-md border bg-muted ${className}`}>
      {url && !isPdf ? (
        <img src={url} alt={nome ?? "Foto do modelo"} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

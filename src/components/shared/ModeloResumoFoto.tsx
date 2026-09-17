import { useSignedUrl } from "@/hooks/useSignedUrl";
import { ImageIcon } from "lucide-react";
import { ImagePreview } from "@/components/shared/ImagePreview";

/**
 * Thumbnail da foto do modelo, com a hierarquia de capa padrão
 * (Foto do Modelo → Desenho Técnico → Croqui → placeholder). Reutilizado nos
 * resumos das telas de produção (Serviços, CQ, Direcionamento). Lê do bucket
 * `modelos` via useSignedUrl; PDF cai no placeholder.
 * `zoom` (opt-in): clicar na imagem abre o lightbox (padrão do sistema, mesmo do ModeloThumb —
 * ImagePreview faz stopPropagation, não dispara clique ancestral). Só p/ imagem (PDF não amplia).
 */
export function ModeloResumoFoto({
  fontes,
  nome,
  className = "h-16 w-16",
  zoom = false,
}: {
  fontes: (string | null | undefined)[];
  nome?: string | null;
  className?: string;
  zoom?: boolean;
}) {
  const path = fontes.find(Boolean) ?? null;
  const isPdf = /\.pdf$/i.test(path ?? "");
  const url = useSignedUrl(path, "modelos");
  const box = `shrink-0 overflow-hidden rounded-md border bg-muted ${className}`;
  if (!url || isPdf) {
    return (
      <div className={box}>
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="h-5 w-5" />
        </div>
      </div>
    );
  }
  const img = <img src={url} alt={nome ?? "Foto do modelo"} className="h-full w-full object-cover" />;
  if (!zoom) return <div className={box}>{img}</div>;
  return <ImagePreview src={url} alt={nome ?? "Foto do modelo"} className={box}>{img}</ImagePreview>;
}

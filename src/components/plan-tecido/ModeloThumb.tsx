import { ImageIcon } from "lucide-react";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { ImagePreview } from "@/components/shared/ImagePreview";

/** Miniatura da foto do modelo (bucket "modelos"); ícone se não houver.
 *  `zoom` (item 12): clicar na foto abre o lightbox (ImagePreview faz stopPropagation, então NÃO
 *  dispara o clique do card ancestral). Mesmo padrão do CardCover do Desenvolvimento. */
export function ModeloThumb({ path, className = "h-7 w-7", zoom = false, alt = "" }: { path?: string | null; className?: string; zoom?: boolean; alt?: string }) {
  const url = useSignedUrl(path ?? null, "modelos");
  const box = `flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted ${className}`;
  if (!url) return <div className={box}><ImageIcon className="h-1/2 w-1/2 text-muted-foreground" /></div>;
  const img = <img src={url} alt={alt} draggable={false} className="h-full w-full object-cover" />;
  if (!zoom) return <div className={box}>{img}</div>;
  return (
    <ImagePreview src={url} alt={alt} className={box}>
      {img}
    </ImagePreview>
  );
}

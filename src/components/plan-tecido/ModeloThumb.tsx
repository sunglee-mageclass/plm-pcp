import { ImageIcon } from "lucide-react";
import { useSignedUrl } from "@/hooks/useSignedUrl";

/** Miniatura da foto do modelo (bucket "modelos"); ícone se não houver. */
export function ModeloThumb({ path, className = "h-7 w-7" }: { path?: string | null; className?: string }) {
  const url = useSignedUrl(path ?? null, "modelos");
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted ${className}`}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-1/2 w-1/2 text-muted-foreground" />}
    </div>
  );
}

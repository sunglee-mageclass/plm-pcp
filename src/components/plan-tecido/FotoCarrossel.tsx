import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Camera, Loader2, Trash2, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { uploadToBucket } from "@/lib/storage-tenant";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { mensagemErro } from "@/lib/erro-mensagem";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { Button } from "@/components/ui/button";
import { PEDIDO_FOTOS_BUCKET } from "./usePedidoFotos";

// Carrossel das FOTOS DO PEDIDO de um nome de tecido (Modo Plano, set/2026). Botão anexar (upload
// no bucket oc-tecido) + navegação next/prev + ZOOM ao clicar (ImagePreview/lightbox). Remover a foto
// atual. Controlado por `paths` + `onChange` (o pai persiste via `usePedidoFotos.salvar`).
export function FotoCarrossel({
  paths, onChange, readOnly = false, nomeTecido,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
  readOnly?: boolean;
  nomeTecido?: string;
}) {
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const total = paths.length;
  const clamped = total === 0 ? 0 : Math.min(idx, total - 1);
  const atual = total > 0 ? paths[clamped] : null;
  const url = useSignedUrl(atual, PEDIDO_FOTOS_BUCKET);
  const isPdf = atual ? /\.pdf$/i.test(atual) : false;

  const prev = () => setIdx((i) => (total === 0 ? 0 : (i - 1 + total) % total));
  const next = () => setIdx((i) => (total === 0 ? 0 : (i + 1) % total));

  async function anexar(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const novos: string[] = [];
      for (const f of Array.from(files)) novos.push(await uploadToBucket(PEDIDO_FOTOS_BUCKET, "pedido", f));
      onChange([...paths, ...novos]);
      setIdx(paths.length); // mostra a 1ª recém-anexada
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível anexar a foto do pedido."));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  const remover = () => {
    if (atual == null) return;
    const restantes = paths.filter((_, i) => i !== clamped);
    onChange(restantes);
    setIdx((i) => Math.max(0, Math.min(i, restantes.length - 1)));
  };

  return (
    <div className="flex flex-col">
      {!readOnly && (
        <>
          <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
            onChange={(e) => anexar(e.target.files)} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className="flex items-center justify-center gap-1.5 border-b p-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Anexar foto do pedido
          </button>
        </>
      )}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-muted" style={{ aspectRatio: "4 / 5" }}>
        {atual == null ? (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
            <span className="text-[10px]">Sem foto do pedido</span>
          </div>
        ) : isPdf ? (
          <ImagePreview src={url ?? ""} alt={`Pedido ${nomeTecido ?? ""}`} className="h-full w-full">
            <iframe src={url ? `${url}#toolbar=0&navpanes=0` : undefined} title="Pedido (PDF)" className="pointer-events-none h-full w-full" />
          </ImagePreview>
        ) : (
          <ImagePreview src={url ?? ""} alt={`Pedido ${nomeTecido ?? ""}`} className="h-full w-full">
            <img src={url ?? undefined} alt="" className="h-full w-full object-cover" />
          </ImagePreview>
        )}

        {total > 1 && (
          <>
            <button type="button" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Foto anterior"
              className="absolute left-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border bg-background/85 shadow-sm hover:bg-background">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Próxima foto"
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border bg-background/85 shadow-sm hover:bg-background">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
        {total > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
            Pedido {clamped + 1}/{total}
          </span>
        )}
        {total > 0 && !readOnly && (
          <Button type="button" variant="secondary" size="iconSm" aria-label="Remover foto"
            className="absolute right-1.5 top-1.5 h-6 w-6 bg-background/85"
            onClick={(e) => { e.stopPropagation(); remover(); }}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
        {total > 1 && (
          <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
            {paths.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === clamped ? "bg-white" : "bg-white/50"}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

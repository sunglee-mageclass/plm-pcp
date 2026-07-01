import { useEffect, useState } from "react";
import { FileText, ImageIcon, Loader2, Trash2, Upload, ZoomIn } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Field } from "./shared";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET } from "./types";

function isImagePath(path: string) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(path);
}

function isPdfPath(path: string) {
  return /\.pdf$/i.test(path);
}

export function ModeloAnexosSection({
  fichaMedidaUrl,
  desenhoTecnicoUrl,
  uploading,
  onUploadFicha,
  onUploadDesenho,
  observacoesGerais,
  onChangeObservacoes,
  fotosModelo,
  fotosReferencia,
  onChangeFotosModelo,
  onChangeFotosReferencia,
}: {
  fichaMedidaUrl: string | null | undefined;
  desenhoTecnicoUrl: string | null | undefined;
  uploading: boolean;
  onUploadFicha: (file: File) => void;
  onUploadDesenho: (file: File) => void;
  observacoesGerais: string;
  onChangeObservacoes: (v: string) => void;
  fotosModelo: string[];
  fotosReferencia: string[];
  onChangeFotosModelo: (paths: string[]) => void;
  onChangeFotosReferencia: (paths: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Desenho Técnico</Label>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar arquivo
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onUploadDesenho(e.target.files[0])} />
          </label>
          {desenhoTecnicoUrl && <AnexoPreview path={desenhoTecnicoUrl} title="Desenho Técnico" />}
        </div>
      </div>
      <PhotoList
        label="Foto do Modelo"
        paths={fotosModelo}
        prefix="fotos_modelo"
        onChange={onChangeFotosModelo}
      />
      <PhotoList
        label="Foto de Referência"
        paths={fotosReferencia}
        prefix="fotos_referencia"
        onChange={onChangeFotosReferencia}
      />
      <div className="grid gap-2">
        <Label>Ficha de Medida</Label>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar arquivo
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onUploadFicha(e.target.files[0])} />
          </label>
          {fichaMedidaUrl && <AnexoPreview path={fichaMedidaUrl} title="Ficha de Medida" />}
        </div>
      </div>
      <Field label="Observações Gerais" full>
        <Textarea rows={4} value={observacoesGerais} onChange={(e) => onChangeObservacoes(e.target.value)} />
      </Field>
    </div>
  );
}

function PhotoList({
  label, paths, prefix, onChange,
}: {
  label: string; paths: string[]; prefix: string; onChange: (paths: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const handleAdd = async (file: File) => {
    setBusy(true);
    try {
      const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      onChange([...paths, path]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {paths.map((p, i) => (
          <PhotoThumb key={p} path={p} onRemove={() => onChange(paths.filter((_, j) => j !== i))} />
        ))}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Adicionar
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleAdd(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}

function PhotoThumb({ path, onRemove }: { path: string; onRemove: () => void }) {
  // Usa o hook com cache (Map + TTL) em vez de recriar a signed URL a cada montagem.
  const url = useSignedUrl(path, BUCKET);
  return (
    <div className="relative h-20 w-20 rounded border overflow-hidden bg-muted group">
      {url ? (
        <>
          <img src={url} className="h-full w-full object-cover" alt="" />
          <ImagePreview src={url} alt="">
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors">
              <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
            </div>
          </ImagePreview>
        </>
      ) : (
        <ImageIcon className="m-auto h-8 w-8 text-muted-foreground" />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 bg-background/80 rounded p-0.5 opacity-0 group-hover:opacity-100"
        aria-label="Remover foto"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function AnexoPreview({ path, title = "Anexo" }: { path: string; title?: string }) {
  const url = useSignedUrl(path, BUCKET);
  const [open, setOpen] = useState(false);
  const name = path.split("/").pop() ?? "";

  if (!url) {
    return <span className="text-xs text-muted-foreground truncate">{name}</span>;
  }

  if (isImagePath(path)) {
    return (
      <ImagePreview src={url} alt={name}>
        <Badge variant="secondary" className="truncate max-w-[260px] cursor-pointer hover:bg-accent">
          <ZoomIn className="h-3 w-3 mr-1" />
          {name}
        </Badge>
      </ImagePreview>
    );
  }

  if (isPdfPath(path)) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          <Badge variant="secondary" className="truncate max-w-[260px] cursor-pointer hover:bg-accent">
            <FileText className="h-3 w-3 mr-1" />
            {name}
          </Badge>
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-4xl p-0 border-none bg-white shadow-none h-[85vh] [&>button]:!text-black [&>button]:top-2 [&>button]:right-2">
            <iframe src={url} className="w-full h-full rounded-md" title={title} />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer">
      <Badge variant="secondary" className="truncate max-w-[260px]">{name}</Badge>
    </a>
  );
}

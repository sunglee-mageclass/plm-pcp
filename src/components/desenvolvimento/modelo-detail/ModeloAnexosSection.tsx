import { useState } from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Field } from "./shared";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET } from "./types";

// Aceita imagem OU PDF (igual ao Planejamento).
const FILE_ACCEPT = "image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf";

export function ModeloAnexosSection({
  fichaMedidaUrl,
  desenhoTecnicoUrl,
  croquiUrl,
  uploading,
  onUploadFicha,
  onUploadDesenho,
  onUploadCroqui,
  onRemoveFicha,
  onRemoveDesenho,
  onRemoveCroqui,
  observacoesGerais,
  onChangeObservacoes,
  fotosModelo,
  fotosReferencia,
  onChangeFotosModelo,
  onChangeFotosReferencia,
}: {
  fichaMedidaUrl: string | null | undefined;
  desenhoTecnicoUrl: string | null | undefined;
  croquiUrl: string | null | undefined;
  uploading: boolean;
  onUploadFicha: (file: File) => void;
  onUploadDesenho: (file: File) => void;
  onUploadCroqui: (file: File) => void;
  onRemoveFicha: () => void;
  onRemoveDesenho: () => void;
  onRemoveCroqui: () => void;
  observacoesGerais: string;
  onChangeObservacoes: (v: string) => void;
  fotosModelo: string[];
  fotosReferencia: string[];
  onChangeFotosModelo: (paths: string[]) => void;
  onChangeFotosReferencia: (paths: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <SingleFileField label="Foto do Croqui" path={croquiUrl ?? ""} uploading={uploading} onUpload={onUploadCroqui} onRemove={onRemoveCroqui} />
      <SingleFileField label="Desenho Técnico" path={desenhoTecnicoUrl ?? ""} uploading={uploading} onUpload={onUploadDesenho} onRemove={onRemoveDesenho} />
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
      <SingleFileField label="Ficha de Medida" path={fichaMedidaUrl ?? ""} uploading={uploading} onUpload={onUploadFicha} onRemove={onRemoveFicha} />
      <Field label="Observações Gerais" full>
        <Textarea rows={4} value={observacoesGerais} onChange={(e) => onChangeObservacoes(e.target.value)} />
      </Field>
    </div>
  );
}

/* Anexo único (imagem ou PDF) com miniatura + zoom ao clicar — Croqui / Desenho Técnico / Ficha. */
function SingleFileField({ label, path, uploading, onUpload, onRemove }: {
  label: string; path: string; uploading: boolean; onUpload: (f: File) => void; onRemove: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {path && <FileThumb path={path} onRemove={onRemove} />}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {path ? "Trocar arquivo" : "Enviar arquivo"}
          <input type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      </div>
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
          <FileThumb key={p} path={p} onRemove={() => onChange(paths.filter((_, j) => j !== i))} />
        ))}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Adicionar
          <input
            type="file"
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleAdd(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}

/* Miniatura de anexo (imagem OU PDF) com preview + zoom ao clicar (abre grande). */
function FileThumb({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const isPdf = /\.pdf$/i.test(path);
  // Hook com cache (Map + TTL) — não recria a signed URL a cada montagem.
  const url = useSignedUrl(path, BUCKET);
  const [zoom, setZoom] = useState(false);
  return (
    <div className="relative h-20 w-20 rounded border overflow-hidden bg-muted group">
      <div
        role="button"
        tabIndex={0}
        onClick={() => url && setZoom(true)}
        onKeyDown={(e) => { if (url && (e.key === "Enter" || e.key === " ")) setZoom(true); }}
        className="h-full w-full cursor-zoom-in flex items-center justify-center"
        title="Abrir"
      >
        {!url ? (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        ) : isPdf ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="PDF" className="h-full w-full pointer-events-none" />
        ) : (
          <img src={url} className="h-full w-full object-cover" alt="" />
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-0.5 right-0.5 bg-background/80 rounded p-0.5 opacity-0 group-hover:opacity-100 z-10"
          aria-label="Remover"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-5xl p-1 border-none bg-transparent shadow-none [&>button]:!text-white [&>button]:top-2 [&>button]:right-2">
          {isPdf ? (
            <iframe src={url ?? ""} title="PDF" className="w-full h-[85vh] rounded-md bg-white" />
          ) : (
            <img src={url ?? ""} alt="" className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

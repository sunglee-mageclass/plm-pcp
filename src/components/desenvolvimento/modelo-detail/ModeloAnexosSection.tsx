import { useEffect, useState } from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./shared";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET } from "./types";

export function ModeloAnexosSection({
  fichaMedidaUrl,
  uploading,
  onUploadFicha,
  observacoesGerais,
  onChangeObservacoes,
  fotosModelo,
  fotosReferencia,
  onChangeFotosModelo,
  onChangeFotosReferencia,
}: {
  fichaMedidaUrl: string | null | undefined;
  uploading: boolean;
  onUploadFicha: (file: File) => void;
  observacoesGerais: string;
  onChangeObservacoes: (v: string) => void;
  fotosModelo: string[];
  fotosReferencia: string[];
  onChangeFotosModelo: (paths: string[]) => void;
  onChangeFotosReferencia: (paths: string[]) => void;
}) {
  return (
    <div className="space-y-4">
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
          {fichaMedidaUrl && (
            <span className="text-xs text-muted-foreground truncate">{fichaMedidaUrl.split("/").pop()}</span>
          )}
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
      const { tenantPrefix } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${file.name}`;
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
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (alive) setUrl(data?.signedUrl ?? null);
    });
    return () => { alive = false; };
  }, [path]);
  return (
    <div className="relative h-20 w-20 rounded border overflow-hidden bg-muted group">
      {url ? <img src={url} className="h-full w-full object-cover" alt="" />
           : <ImageIcon className="m-auto h-8 w-8 text-muted-foreground" />}
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

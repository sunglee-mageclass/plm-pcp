import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { mensagemErro } from "@/lib/erro-mensagem";
import { FileField } from "./FileField";

export type NfItem = { url: string; data?: string };

const fmtD = (d?: string) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "");

// Lista de Notas Fiscais de uma OC (várias NFs coexistem). Opera sobre o draft (a OC é
// salva junto). Anexar adiciona à lista; cada NF tem seu remover. Usada em OC Tecido e
// OC Aviamento (o bucket/uploader vem da tela).
export function NfList({ value, onChange, uploadFn, bucket = "oc-tecido", readOnly = false }: {
  value: NfItem[];
  onChange: (nfs: NfItem[]) => void;
  uploadFn: (file: File) => Promise<string>;
  bucket?: string;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const nfs = value ?? [];

  const add = async (file: File) => {
    setBusy(true);
    try {
      const url = await uploadFn(file);
      onChange([...nfs, { url, data: new Date().toISOString().slice(0, 10) }]);
    } catch (e: any) {
      toast.error(mensagemErro(e, "Erro no upload"));
    } finally {
      setBusy(false);
    }
  };
  const remove = (i: number) => onChange(nfs.filter((_, j) => j !== i));

  return (
    <div className="grid gap-2">
      <Label>Notas Fiscais{nfs.length > 0 ? ` (${nfs.length})` : ""}</Label>
      {nfs.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma NF anexada.</p>}
      {nfs.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {nfs.map((nf, i) => (
            <FileField
              key={i}
              label={nf.data ? `NF de ${fmtD(nf.data)}` : `NF ${i + 1}`}
              path={nf.url}
              bucket={bucket}
              onChange={() => {}}
              onClear={() => remove(i)}
              disabled={readOnly}
            />
          ))}
        </div>
      )}
      {!readOnly && (
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> {busy ? "Enviando…" : "Adicionar NF"}
          <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && add(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}

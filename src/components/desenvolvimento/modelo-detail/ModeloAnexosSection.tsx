import { Loader2, Upload } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./shared";

export function ModeloAnexosSection({
  fichaMedidaUrl,
  uploading,
  onUploadFicha,
  observacoesGerais,
  onChangeObservacoes,
}: {
  fichaMedidaUrl: string | null | undefined;
  uploading: boolean;
  onUploadFicha: (file: File) => void;
  observacoesGerais: string;
  onChangeObservacoes: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
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

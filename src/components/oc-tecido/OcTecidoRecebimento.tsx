import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { FileField } from "./FileField";
import { OcTecidoCalculos } from "./OcTecidoCalculos";
import type { Artigo, Draft, ItemDraft, Variante } from "./shared";

export function OcTecidoRecebimento({
  draft, setDraft, handleSingleUpload, handleEtiquetaUpload,
  items, artigoMap, varianteMap, setQtd, totalPrevisto, totalReal,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  handleSingleUpload: (file: File, key: keyof Draft) => void;
  handleEtiquetaUpload: (file: File) => void;
  items: ItemDraft[];
  artigoMap: Record<string, Artigo>;
  varianteMap: Record<string, Variante>;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number) => void;
  totalPrevisto: number;
  totalReal: number;
}) {
  return (
    <>
      <Separator />
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Recebimento</h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid gap-1">
            <Label>Data da Entrega</Label>
            <Input type="date" value={draft.data_entrega} onChange={(e) => setDraft((d) => ({ ...d, data_entrega: e.target.value }))} />
          </div>
          <FileField label="Nota Fiscal" path={draft.nf_url}
            onChange={(f) => handleSingleUpload(f, "nf_url")}
            onClear={() => setDraft((d) => ({ ...d, nf_url: null }))} />
        </div>

        <div className="grid gap-2">
          <Label>Etiquetas de Lavagem (até 2)</Label>
          <div className="flex flex-wrap gap-2">
            {draft.etiqueta_lavagem_urls.map((p, i) => (
              <Badge key={i} variant="secondary" className="gap-2">
                {p.split("/").pop()}
                <button onClick={() => setDraft((d) => ({ ...d, etiqueta_lavagem_urls: d.etiqueta_lavagem_urls.filter((_, j) => j !== i) }))}>
                  ×
                </button>
              </Badge>
            ))}
            {draft.etiqueta_lavagem_urls.length < 2 && (
              <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent">
                <Upload className="h-4 w-4" /> Adicionar
                <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleEtiquetaUpload(e.target.files[0])} />
              </label>
            )}
          </div>
        </div>

        <div className="grid gap-1">
          <Label>Observações sobre Defeitos</Label>
          <Textarea value={draft.observacoes_defeitos} onChange={(e) => setDraft((d) => ({ ...d, observacoes_defeitos: e.target.value }))} />
        </div>

        <OcTecidoCalculos
          items={items}
          artigoMap={artigoMap}
          varianteMap={varianteMap}
          setQtd={setQtd}
          totalPrevisto={totalPrevisto}
          totalReal={totalReal}
          dataPrevista={draft.data_prevista_entrega}
          dataEntrega={draft.data_entrega}
        />
      </div>
    </>
  );
}

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { FileField } from "./FileField";
import { OcTecidoCalculos } from "./OcTecidoCalculos";
import type { Artigo, Draft, ItemDraft, Variante } from "./shared";

export function OcTecidoRecebimento({
  draft, setDraft, handleSingleUpload,
  items, artigoMap, varianteMap, setQtd, totalPrevisto, totalReal,
  tecido2Aberto,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  handleSingleUpload: (file: File, key: keyof Draft) => void;
  items: ItemDraft[];
  artigoMap: Record<string, Artigo>;
  varianteMap: Record<string, Variante>;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number) => void;
  totalPrevisto: number;
  totalReal: number;
  tecido2Aberto: boolean;
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

        <div className="grid sm:grid-cols-2 gap-4">
          <FileField
            label="Etiqueta de Lavagem — Tecido 1"
            path={draft.etiqueta_lavagem_url_1}
            onChange={(f) => handleSingleUpload(f, "etiqueta_lavagem_url_1")}
            onClear={() => setDraft((d) => ({ ...d, etiqueta_lavagem_url_1: null }))}
          />
          {tecido2Aberto && (
            <FileField
              label="Etiqueta de Lavagem — Tecido 2"
              path={draft.etiqueta_lavagem_url_2}
              onChange={(f) => handleSingleUpload(f, "etiqueta_lavagem_url_2")}
              onClear={() => setDraft((d) => ({ ...d, etiqueta_lavagem_url_2: null }))}
            />
          )}
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

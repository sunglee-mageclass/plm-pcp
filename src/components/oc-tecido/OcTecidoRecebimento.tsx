import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { FileField } from "./FileField";
import { OcTecidoCalculos } from "./OcTecidoCalculos";
import { EtiquetaLavagemArtigoEditor } from "@/components/shared/EtiquetaLavagemArtigo";
import type { Artigo, Draft, ItemDraft, Variante } from "./shared";

export function OcTecidoRecebimento({
  draft, setDraft, handleSingleUpload,
  items, artigoMap, varianteMap, setQtd, totalPrevisto, totalReal,
  tecido2Aberto, artigoId1, artigoId2, readOnly = false,
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
  artigoId1: string | null;
  artigoId2: string | null;
  readOnly?: boolean;
}) {
  return (
    <>
      <Separator />
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Recebimento</h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid gap-1">
            <Label>Data da Entrega</Label>
            <Input
              type="date"
              value={draft.data_entrega}
              onChange={(e) => setDraft((d) => ({ ...d, data_entrega: e.target.value }))}
              disabled={readOnly}
            />
          </div>
          <FileField
            label="Nota Fiscal"
            path={draft.nf_url}
            onChange={(f) => handleSingleUpload(f, "nf_url")}
            onClear={() => setDraft((d) => ({ ...d, nf_url: null }))}
            disabled={readOnly}
          />
        </div>

        <div className="rounded-md border p-3 space-y-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            A etiqueta de lavagem fica vinculada ao artigo (tecido) e acompanha todo o processo.
            Subir aqui salva diretamente no cadastro do artigo.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <EtiquetaLavagemArtigoEditor
              artigoId={artigoId1}
              label="Etiqueta de Lavagem — Tecido 1"
            />
            {tecido2Aberto && (
              <EtiquetaLavagemArtigoEditor
                artigoId={artigoId2}
                label="Etiqueta de Lavagem — Tecido 2"
              />
            )}
          </div>
        </div>

        <div className="grid gap-1">
          <Label>Observações sobre Defeitos</Label>
          <Textarea
            value={draft.observacoes_defeitos}
            onChange={(e) => setDraft((d) => ({ ...d, observacoes_defeitos: e.target.value }))}
            disabled={readOnly}
          />
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
          readOnly={readOnly}
        />
      </div>
    </>
  );
}

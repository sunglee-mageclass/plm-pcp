import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FileField } from "./FileField";
import { OcTecidoCalculos } from "./OcTecidoCalculos";
import { EtiquetaLavagemArtigoEditor } from "@/components/shared/EtiquetaLavagemArtigo";
import type { Artigo, Draft, ItemDraft, ParcelaRecebimento, Variante } from "./shared";

export function OcTecidoRecebimento({
  draft, setDraft, handleSingleUpload,
  items, artigoMap, varianteMap, setQtd, totalPrevisto, totalReal,
  tecido2Aberto, artigoId1, artigoId2, readOnly = false,
  toggleCancelado, canCancel,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  handleSingleUpload: (file: File, key: keyof Draft) => void;
  items: ItemDraft[];
  artigoMap: Record<string, Artigo>;
  varianteMap: Record<string, Variante>;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => void;
  totalPrevisto: number;
  totalReal: number;
  tecido2Aberto: boolean;
  artigoId1: string | null;
  artigoId2: string | null;
  readOnly?: boolean;
  toggleCancelado?: (tempId: string, value: boolean) => void;
  canCancel?: boolean;
}) {
  return (
    <>
      <Separator />
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Recebimento</h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid gap-1">
            <Label>Qtd. Parcelas de Recebimento</Label>
            <NumberInput
              type="number"
              min={1}
              max={24}
              value={draft.parcelas_recebimento?.length || 1}
              onChange={(e) => {
                const n = Math.max(1, Math.min(24, Number(e.target.value) || 1));
                setDraft((d) => {
                  const prev: ParcelaRecebimento[] = d.parcelas_recebimento ?? [];
                  const next: ParcelaRecebimento[] = Array.from({ length: n }, (_, i) =>
                    prev[i] ?? { data: "", recebido: false },
                  );
                  return { ...d, parcelas_recebimento: next };
                });
              }}
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

        <div className="rounded-md border p-3 space-y-2">
          <Label className="text-sm">Parcelas de Recebimento</Label>
          {(draft.parcelas_recebimento?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              Defina a quantidade de parcelas acima.
            </p>
          ) : (
            <div className="space-y-2">
              {(draft.parcelas_recebimento ?? []).map((p, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[40px_1fr_auto] items-center gap-3"
                >
                  <span className="text-sm text-muted-foreground">#{idx + 1}</span>
                  <Input
                    type="date"
                    value={p.data}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft((d) => {
                        const arr = [...(d.parcelas_recebimento ?? [])];
                        arr[idx] = { ...arr[idx], data: v };
                        return { ...d, parcelas_recebimento: arr };
                      });
                    }}
                    disabled={readOnly}
                  />
                  <label className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.recebido}
                      onCheckedChange={(v) => {
                        const checked = v === true;
                        setDraft((d) => {
                          const arr = [...(d.parcelas_recebimento ?? [])];
                          arr[idx] = { ...arr[idx], recebido: checked };
                          return { ...d, parcelas_recebimento: arr };
                        });
                      }}
                      disabled={readOnly}
                    />
                    Recebida
                  </label>
                </div>
              ))}
            </div>
          )}
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
          toggleCancelado={toggleCancelado}
          canCancel={canCancel}
        />
      </div>
    </>
  );
}

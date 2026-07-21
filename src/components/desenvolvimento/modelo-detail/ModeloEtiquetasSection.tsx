import { Plus, X } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Field, FieldSelectOpt } from "./shared";
import { coresDaEtiqueta, type EtiquetaInfo, type ModeloEtiquetaRow, type Opt } from "./types";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

// Etiquetas do modelo (BOM): escolhe a etiqueta + a COR; o tamanho explode pela grade no
// CAD (não se escolhe aqui). Espelha o padrão dos Aviamentos.
export function ModeloEtiquetasSection({
  rows,
  etiquetas,
  etiquetaMap,
  onChangeRow,
  onAdd,
  onRemove,
  camposCopiados = new Set(),
  onCampoEditado,
}: {
  rows: ModeloEtiquetaRow[];
  etiquetas: Opt[];
  etiquetaMap: Record<string, EtiquetaInfo>;
  onChangeRow: (idx: number, patch: Partial<ModeloEtiquetaRow>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  camposCopiados?: Set<string>;
  onCampoEditado?: (k: string) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const etq = r.etiqueta_id ? etiquetaMap[r.etiqueta_id] : undefined;
        const cores = coresDaEtiqueta(etq);
        const semTamanho = etq?.formato_tamanho === "nenhum";
        return (
          <Card key={i} className={`p-3 space-y-2 ${classeCopiado(camposCopiados, "etiquetas")}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Etiqueta {i + 1}</span>
              <Button variant="ghost" size="sm" onClick={() => { onRemove(i); onCampoEditado?.("etiquetas"); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <FieldSelectOpt
                label="Etiqueta"
                value={r.etiqueta_id}
                onChange={(v) => { onChangeRow(i, { etiqueta_id: v, cor_id: null }); onCampoEditado?.("etiquetas"); }}
                options={etiquetas}
              />
              <FieldSelectOpt
                label={cores.length > 0 ? "Cor" : "Cor (sem variantes)"}
                value={r.cor_id}
                onChange={(v) => { onChangeRow(i, { cor_id: v }); onCampoEditado?.("etiquetas"); }}
                options={cores}
              />
              <Field label="Consumo">
                <NumberInput type="number" step="0.001" placeholder="0,000" value={r.consumo || ""} onChange={(e) => { onChangeRow(i, { consumo: Number(e.target.value) || 0 }); onCampoEditado?.("etiquetas"); }} />
              </Field>
              <Field label="% Loss">
                <NumberInput type="number" step="0.01" placeholder="0,00" value={r.loss_percent || ""} onChange={(e) => { onChangeRow(i, { loss_percent: Number(e.target.value) || 0 }); onCampoEditado?.("etiquetas"); }} />
              </Field>
              <Field label="Custo Previsto">
                <Input readOnly placeholder="0,00" value={r.custo_previsto ? fmtNum(r.custo_previsto) : ""} />
              </Field>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {semTamanho
                ? "Sem tamanho — 1 linha por peça (qtd = grade total × consumo)."
                : "O tamanho explode pela grade no CAD (qtd por tamanho × cor)."}
            </p>
          </Card>
        );
      })}
      {rows.length < 20 && (
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar Etiqueta
        </Button>
      )}
    </div>
  );
}

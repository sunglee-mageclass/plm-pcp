import { Plus, X } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Field, FieldSelectOpt } from "./shared";
import type { AviamentoRow } from "./types";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

type AviamentoOpt = { id: string; codigo_nome: string };

export function ModeloAviamentosSection({
  rows,
  aviamentos,
  onChangeRow,
  onAdd,
  onRemove,
  camposCopiados = new Set(),
  onCampoEditado,
}: {
  rows: AviamentoRow[];
  aviamentos: AviamentoOpt[];
  onChangeRow: (idx: number, patch: Partial<AviamentoRow>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  camposCopiados?: Set<string>;
  onCampoEditado?: (k: string) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <Card key={i} className={`p-3 space-y-2 ${classeCopiado(camposCopiados, "aviamentos")}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Aviamento {i + 1}</span>
            <Button variant="ghost" size="sm" onClick={() => { onRemove(i); onCampoEditado?.("aviamentos"); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <FieldSelectOpt
              label="Aviamento"
              value={r.aviamento_id}
              onChange={(v) => { onChangeRow(i, { aviamento_id: v }); onCampoEditado?.("aviamentos"); }}
              options={aviamentos.map((a) => ({ id: a.id, nome: a.codigo_nome }))}
            />
            <Field label="Custo Previsto">
              <Input readOnly placeholder="0,00" value={r.custo_previsto ? fmtNum(r.custo_previsto) : ""} />
            </Field>
            <Field label="Consumo">
              <NumberInput type="number" step="0.001" placeholder="0,000" value={r.consumo || ""} onChange={(e) => { onChangeRow(i, { consumo: Number(e.target.value) || 0 }); onCampoEditado?.("aviamentos"); }} />
            </Field>
            <Field label="% Loss">
              <NumberInput type="number" step="0.01" placeholder="0,00" value={r.loss_percent || ""} onChange={(e) => { onChangeRow(i, { loss_percent: Number(e.target.value) || 0 }); onCampoEditado?.("aviamentos"); }} />
            </Field>
          </div>
        </Card>
      ))}
      {rows.length < 20 && (
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar Aviamento
        </Button>
      )}
    </div>
  );
}

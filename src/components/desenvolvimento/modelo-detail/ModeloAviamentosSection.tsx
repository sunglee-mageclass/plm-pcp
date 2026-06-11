import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldSelectOpt } from "./shared";
import type { AviamentoRow } from "./types";

type AviamentoOpt = { id: string; codigo_nome: string };

export function ModeloAviamentosSection({
  rows,
  aviamentos,
  onChangeRow,
  onAdd,
  onRemove,
}: {
  rows: AviamentoRow[];
  aviamentos: AviamentoOpt[];
  onChangeRow: (idx: number, patch: Partial<AviamentoRow>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <Card key={i} className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Aviamento {i + 1}</span>
            <Button variant="ghost" size="sm" onClick={() => onRemove(i)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <FieldSelectOpt
              label="Aviamento"
              value={r.aviamento_id}
              onChange={(v) => onChangeRow(i, { aviamento_id: v })}
              options={aviamentos.map((a) => ({ id: a.id, nome: a.codigo_nome }))}
            />
            <Field label="Custo Previsto">
              <Input readOnly value={r.custo_previsto.toFixed(2)} />
            </Field>
            <Field label="Consumo">
              <Input type="number" step="0.001" value={r.consumo} onChange={(e) => onChangeRow(i, { consumo: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="% Loss">
              <Input type="number" step="0.01" value={r.loss_percent} onChange={(e) => onChangeRow(i, { loss_percent: Number(e.target.value) || 0 })} />
            </Field>
          </div>
        </Card>
      ))}
      {rows.length < 10 && (
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar Aviamento
        </Button>
      )}
    </div>
  );
}

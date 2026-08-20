import { Plus, X } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { labelVarianteRow } from "@/lib/variante";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Field, FieldSelectOpt } from "./shared";
import type { AviamentoRow } from "./types";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

/** Variante embedada de um aviamento (cor base + apelido). */
export type AviamentoVarOpt = {
  id: string;
  nome_variante?: string | null;
  codigo_variante?: string | null;
  cor?: { nome: string | null } | null;
  apelido?: { nome: string | null } | null;
};
type AviamentoOpt = { id: string; codigo_nome: string; variantes?: AviamentoVarOpt[] };

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
      {rows.length === 0 ? (
        // Empty-state acionável (mockup): a dica + a ação, em vez do botão solto.
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhum aviamento.{" "}
          <button type="button" onClick={onAdd} className="font-medium text-primary hover:underline">+ Adicionar aviamento</button>
        </div>
      ) : (
        rows.map((r, i) => {
          const avi = aviamentos.find((a) => a.id === r.aviamento_id);
          const variantes = avi?.variantes ?? [];
          return (
          <Card key={i} className={`p-3 space-y-2 ${classeCopiado(camposCopiados, "aviamentos")}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Aviamento {i + 1}</span>
              <Button variant="ghost" size="sm" onClick={() => { onRemove(i); onCampoEditado?.("aviamentos"); }} aria-label="Remover aviamento">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Ordem do mockup: material → variante (cor) → consumo → loss → CUSTO (à direita). */}
            <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr] gap-2">
              <FieldSelectOpt
                label="Aviamento"
                value={r.aviamento_id}
                // Ao trocar de aviamento a variante escolhida deixa de fazer sentido (é de outro
                // aviamento) — limpa junto. A guarda do _core rejeitaria membership inválido.
                onChange={(v) => { onChangeRow(i, { aviamento_id: v, variante_aviamento_id: null }); onCampoEditado?.("aviamentos"); }}
                options={aviamentos.map((a) => ({ id: a.id, nome: a.codigo_nome }))}
              />
              {variantes.length > 0 ? (
                <FieldSelectOpt
                  label="Cor/Variante"
                  value={r.variante_aviamento_id ?? null}
                  onChange={(v) => { onChangeRow(i, { variante_aviamento_id: v }); onCampoEditado?.("aviamentos"); }}
                  options={variantes.map((v) => ({ id: v.id, nome: labelVarianteRow(v) }))}
                />
              ) : (
                <Field label="Cor/Variante">
                  <Input readOnly className="bg-muted/50 cursor-default text-muted-foreground" placeholder="—" value={r.aviamento_id ? "Sem variantes" : ""} />
                </Field>
              )}
              <Field label="Consumo">
                <NumberInput type="number" step="0.001" placeholder="0,000" value={r.consumo || ""} onChange={(e) => { onChangeRow(i, { consumo: Number(e.target.value) || 0 }); onCampoEditado?.("aviamentos"); }} />
              </Field>
              <Field label="% Loss">
                <NumberInput type="number" step="0.01" placeholder="0,00" value={r.loss_percent || ""} onChange={(e) => { onChangeRow(i, { loss_percent: Number(e.target.value) || 0 }); onCampoEditado?.("aviamentos"); }} />
              </Field>
              <Field label="Custo Previsto">
                <Input readOnly className="bg-muted/50 text-right tabular-nums cursor-default" placeholder="R$ —" value={r.custo_previsto ? `R$ ${fmtNum(r.custo_previsto)}` : ""} />
              </Field>
            </div>
          </Card>
          );
        })
      )}
      {rows.length > 0 && rows.length < 20 && (
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar Aviamento
        </Button>
      )}
    </div>
  );
}

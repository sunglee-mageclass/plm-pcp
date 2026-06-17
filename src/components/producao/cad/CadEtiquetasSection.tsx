import { Tag, Trash2 } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/shared/NumberInput";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { EtiquetaRow } from "./types";

type Opt = { id: string; nome: string; tamanho: string | null };

type Props = {
  etiquetas: EtiquetaRow[];
  disponiveis: Opt[];
  gradeSumByTamanho: (tamanho: string) => number;
  gradeTotalGeral: number;
  onUpdate: (i: number, patch: Partial<EtiquetaRow>) => void;
  onAdd: (etiquetaId: string) => void;
  onRemove: (i: number) => void;
};

// "38|P" -> "P · 38"
const fmtTamanho = (t: string | null) => {
  if (!t) return "—";
  const [num, sig] = t.split("|");
  return sig ? `${sig} · ${num}` : t;
};

export function CadEtiquetasSection({ etiquetas, disponiveis, gradeSumByTamanho, gradeTotalGeral, onUpdate, onAdd, onRemove }: Props) {
  const available = disponiveis.filter((d) => !etiquetas.some((e) => e.etiqueta_id === d.id));

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Tag className="h-4 w-4" /> TAG/Etiquetas
        </h2>
        <Select value="" onValueChange={(v) => v && onAdd(v)}>
          <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Adicionar etiqueta…" /></SelectTrigger>
          <SelectContent>
            {available.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground">
                {disponiveis.length === 0 ? "Cadastre em Cadastro > TAG/Etiquetas." : "Todas já adicionadas."}
              </div>
            ) : (
              available.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}{d.tamanho ? ` (${fmtTamanho(d.tamanho)})` : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {etiquetas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma etiqueta adicionada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-1 text-left">Etiqueta</th>
                <th className="px-2 py-1">Tamanho</th>
                <th className="px-2 py-1">Consumo</th>
                <th className="px-2 py-1">Grade (base)</th>
                <th className="px-2 py-1">Qtd Planejada</th>
                <th className="px-2 py-1">Qtd a Enviar</th>
                <th className="px-2 py-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {etiquetas.map((e, i) => {
                const temTamanho = !!e.tamanho;
                // Base da grade: tamanho atrelado usa a grade daquele tamanho;
                // sem tamanho, usa a grade total geral.
                const base = temTamanho ? gradeSumByTamanho(e.tamanho as string) : gradeTotalGeral;
                const planejada = Number((e.consumo * base).toFixed(2));
                return (
                  <tr key={`${e.etiqueta_id}-${i}`} className="border-t">
                    <td className="px-2 py-1">{e.etiqueta_nome}</td>
                    <td className="px-2 py-1 text-center">{temTamanho ? fmtTamanho(e.tamanho) : "Geral"}</td>
                    <td className="px-2 py-1">
                      <NumberInput
                        type="number"
                        step="0.0001"
                        value={e.consumo}
                        onChange={(ev) => onUpdate(i, { consumo: Number(ev.target.value) })}
                      />
                    </td>
                    <td className="px-2 py-1 text-center font-medium">{base}</td>
                    <td className="px-2 py-1 text-center font-medium">{fmtNum(planejada)}</td>
                    <td className="px-2 py-1">
                      <NumberInput
                        type="number"
                        step="0.01"
                        value={e.quantidade_enviar}
                        onChange={(ev) => onUpdate(i, { quantidade_enviar: Number(ev.target.value) })}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Button type="button" size="icon" variant="ghost" onClick={() => onRemove(i)} aria-label="Remover">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

import { Package } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { NumberInput } from "@/components/shared/NumberInput";
import type { AviamentoRow } from "./types";

type Props = {
  aviamentos: AviamentoRow[];
  gradeTotalGeral: number;
  updateAvi: (i: number, patch: Partial<AviamentoRow>) => void;
};

export function CadExplosaoSection({ aviamentos, gradeTotalGeral, updateAvi }: Props) {
  return (
    <Card className="p-5 max-md:p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Package className="h-4 w-4" /> Explosão de Aviamentos
        </h2>
        <span className="text-xs text-muted-foreground">Grade total geral: <b>{gradeTotalGeral}</b></span>
      </div>
      {aviamentos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum aviamento neste modelo.</p>
      )}
      {aviamentos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border card-table">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-1 text-left">Aviamento</th>
                <th className="px-2 py-1">Consumo</th>
                <th className="px-2 py-1">Preço (R$)</th>
                <th className="px-2 py-1">Custo CAD (R$)</th>
                <th className="px-2 py-1">Grade Total</th>
                <th className="px-2 py-1">Qtd Planejada</th>
                <th className="px-2 py-1">Qtd a Enviar</th>
              </tr>
            </thead>
            <tbody>
              {aviamentos.map((a, i) => (
                <tr key={`${a.aviamento_id}-${i}`} className="border-t">
                  <td className="px-2 py-1">{a.aviamento_nome ?? "—"}</td>
                  <td className="px-2 py-1" data-label="Consumo">
                    <NumberInput type="number" step="0.0001" className="max-md:w-28" value={a.consumo}
                      onChange={(e) => { const c = Math.max(0, Number(e.target.value)); updateAvi(i, { consumo: c, quantidade_enviar: Number((c * gradeTotalGeral).toFixed(4)) }); }} />
                  </td>
                  <td className="px-2 py-1 text-center text-muted-foreground" data-label="Preço (R$)">{fmtNum(a.preco)}</td>
                  <td className="px-2 py-1 text-center font-medium" data-label="Custo CAD (R$)">{fmtNum(a.custo_cad)}</td>
                  <td className="px-2 py-1 text-center font-medium" data-label="Grade Total">{gradeTotalGeral}</td>
                  <td className="px-2 py-1 text-center font-medium" data-label="Qtd Planejada">{fmtNum(a.quantidade_enviar)}</td>
                  <td className="px-2 py-1" data-label="Qtd a Enviar">
                    <NumberInput type="number" step="0.01" className="max-md:w-28" value={a.quantidade_separar}
                      onChange={(e) => updateAvi(i, { quantidade_separar: Math.max(0, Number(e.target.value)) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

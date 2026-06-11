import { Package } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AviamentoRow } from "./types";

type Props = {
  aviamentos: AviamentoRow[];
  gradeTotalGeral: number;
  updateAvi: (i: number, patch: Partial<AviamentoRow>) => void;
};

export function CadExplosaoSection({ aviamentos, gradeTotalGeral, updateAvi }: Props) {
  return (
    <Card className="p-5 space-y-3">
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
          <table className="w-full text-xs border">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-1 text-left">Aviamento</th>
                <th className="px-2 py-1">Consumo</th>
                <th className="px-2 py-1">Grade Total</th>
                <th className="px-2 py-1">Qtd a Enviar</th>
                <th className="px-2 py-1">Qtd a Separar</th>
              </tr>
            </thead>
            <tbody>
              {aviamentos.map((a, i) => (
                <tr key={`${a.aviamento_id}-${i}`} className="border-t">
                  <td className="px-2 py-1">{a.aviamento_nome ?? "—"}</td>
                  <td className="px-2 py-1">
                    <Input type="number" step="0.0001" value={a.consumo}
                      onChange={(e) => updateAvi(i, { consumo: Number(e.target.value), quantidade_enviar: Number((Number(e.target.value) * gradeTotalGeral).toFixed(4)) })} />
                  </td>
                  <td className="px-2 py-1 text-center font-medium">{gradeTotalGeral}</td>
                  <td className="px-2 py-1 text-center font-medium">{a.quantidade_enviar.toFixed(2)}</td>
                  <td className="px-2 py-1">
                    <Input type="number" step="0.01" value={a.quantidade_separar}
                      onChange={(e) => updateAvi(i, { quantidade_separar: Number(e.target.value) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Ao salvar, as quantidades são registradas em <code>cad_aviamentos</code> para baixa futura no estoque (Módulo 2B).
      </p>
    </Card>
  );
}

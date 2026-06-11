import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field } from "./shared";
import type { TecidoRow, VarianteRow } from "./types";

type Props = {
  tecidos: TecidoRow[];
  updateTec: (i: number, patch: Partial<TecidoRow>) => void;
  updateVar: (i: number, j: number, patch: Partial<VarianteRow>) => void;
};

export function CadTecidosSection({ tecidos, updateTec, updateVar }: Props) {
  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-semibold">Tecidos / Forros / Entretelas</h2>
      {tecidos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum tecido planejado neste modelo.</p>
      )}
      {tecidos.map((t, i) => (
        <Card key={`${t.tipo}-${t.numero}-${i}`} className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">{t.tipo} {t.numero}</Badge>
            <span className="text-sm font-medium">{t.artigo_nome ?? "Sem artigo"}</span>
            <span className="text-xs text-muted-foreground">(preço: R$ {t.preco.toFixed(2)}/m)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Consumo CAD (m)">
              <Input type="number" step="0.01" value={t.consumo_cad}
                onChange={(e) => updateTec(i, { consumo_cad: Number(e.target.value) })} />
            </Field>
            <Field label="% Loss CAD">
              <Input type="number" step="0.01" value={t.loss_percent_cad}
                onChange={(e) => updateTec(i, { loss_percent_cad: Number(e.target.value) })} />
            </Field>
            <Field label="Custo CAD (R$)">
              <Input value={t.custo_cad.toFixed(2)} readOnly className="bg-muted" />
            </Field>
            <Field label="Tamanho da folha (m)">
              <Input type="number" step="0.01" value={t.tamanho_folha}
                onChange={(e) => updateTec(i, { tamanho_folha: Number(e.target.value) })} />
            </Field>
          </div>
          {t.variantes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1 text-left">Variante</th>
                    <th className="px-2 py-1">Qtd Folhas</th>
                    <th className="px-2 py-1">Metr. Planejada</th>
                    <th className="px-2 py-1">Metr. Enviada</th>
                  </tr>
                </thead>
                <tbody>
                  {t.variantes.map((v, j) => (
                    <tr key={`${v.variante_tecido_id}-${j}`} className="border-t">
                      <td className="px-2 py-1">{v.variante_nome ?? "—"}</td>
                      <td className="px-2 py-1">
                        <Input type="number" value={v.quantidade_folhas}
                          onChange={(e) => updateVar(i, j, { quantidade_folhas: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" step="0.01" value={v.metragem_planejada}
                          onChange={(e) => updateVar(i, j, { metragem_planejada: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" step="0.01" value={v.metragem_enviada}
                          onChange={(e) => updateVar(i, j, { metragem_enviada: Number(e.target.value) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </Card>
  );
}

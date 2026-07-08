import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Badge } from "@/components/ui/badge";
import { Field } from "./shared";
import { EtiquetaLavagemArtigoView } from "@/components/shared/EtiquetaLavagemArtigo";
import { fmtNum } from "@/lib/format";
import { varianteLabel } from "@/lib/variante";
import type { TecidoRow, VarianteRow } from "./types";

type Props = {
  tecidos: TecidoRow[];
  updateTec: (i: number, patch: Partial<TecidoRow>) => void;
  updateVar: (i: number, j: number, patch: Partial<VarianteRow>) => void;
  autoFolhas?: boolean;
  onToggleAutoFolhas?: (v: boolean) => void;
};

export function CadTecidosSection({ tecidos, updateTec, updateVar, autoFolhas, onToggleAutoFolhas }: Props) {
  const ro = !!autoFolhas;
  return (
    <Card className="p-5 max-md:p-3 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Tecidos / Forros / Entretelas</h2>
        {onToggleAutoFolhas && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={ro}
              onChange={(e) => onToggleAutoFolhas(e.target.checked)}
            />
            Calcular folhas / metragem automaticamente
          </label>
        )}
      </div>
      {ro && (
        <p className="text-[11px] text-muted-foreground">
          Tamanho da folha, qtd. de folhas e metragem planejada são calculados a partir do
          consumo, da grade, da proporção e da largura.
        </p>
      )}
      {tecidos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum tecido planejado neste modelo.</p>
      )}
      {tecidos.map((t, i) => {
        const compl = !(t.tipo === "tecido" && t.numero === 1);
        return (
        <Card key={`${t.tipo}-${t.numero}-${i}`} className="p-4 max-md:p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="capitalize">{t.tipo} {t.numero}</Badge>
            <span className="text-sm font-medium">{t.artigo_nome ?? "Sem artigo"}</span>
            <span className="text-xs text-muted-foreground">(preço: R$ {fmtNum(t.preco)}/m</span>
            {Number(t.largura ?? 0) > 0 ? (
              <span className="text-xs text-muted-foreground">· largura: {fmtNum(t.largura)} m)</span>
            ) : (
              <span className="text-xs text-destructive font-medium inline-flex items-center gap-1">
                · <AlertTriangle className="h-3 w-3" /> largura não definida)
              </span>
            )}
          </div>
          {t.artigo_id && <EtiquetaLavagemArtigoView artigoId={t.artigo_id} size="sm" />}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Consumo CAD (m)">
              <NumberInput type="number" step="0.01" value={t.consumo_cad}
                onChange={(e) => updateTec(i, { consumo_cad: Math.max(0, Number(e.target.value)) })} />
            </Field>
            <Field label="% Loss CAD">
              <NumberInput type="number" step="0.01" value={t.loss_percent_cad}
                onChange={(e) => updateTec(i, { loss_percent_cad: Math.max(0, Number(e.target.value)) })} />
            </Field>
            <Field label="Custo CAD (R$)">
              <Input value={fmtNum(t.custo_cad)} readOnly className="bg-muted" />
            </Field>
            <Field label="Tamanho da folha (m)">
              {ro ? (
                <Input readOnly className="bg-muted" value={fmtNum(t.tamanho_folha)} />
              ) : (
                <NumberInput type="number" step="0.01" value={t.tamanho_folha}
                  onChange={(e) => updateTec(i, { tamanho_folha: Math.max(0, Number(e.target.value)) })} />
              )}
            </Field>
          </div>
          {t.variantes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border card-table">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1 text-left">Variante</th>
                    {compl && <th className="px-2 py-1">× grade</th>}
                    <th className="px-2 py-1">Qtd Folhas</th>
                    <th className="px-2 py-1">Metr. Planejada</th>
                    <th className="px-2 py-1">Metr. a Separar/Enviar</th>
                  </tr>
                </thead>
                <tbody>
                  {t.variantes.map((v, j) => (
                    <tr key={`${v.variante_tecido_id}-${j}`} className="border-t">
                      <td className="px-2 py-1">{varianteLabel({ nome: v.variante_nome, cor: v.variante_cor, apelido: v.variante_apelido })}</td>
                      {compl && (
                        <td className="px-2 py-1" data-label="× grade">
                          <NumberInput type="number" step="0.01" min={0} className="w-16 max-md:w-24"
                            value={Number(v.multiplicador ?? 1)}
                            onChange={(e) => updateVar(i, j, { multiplicador: Math.max(0, Number(e.target.value)) || 1 })} />
                        </td>
                      )}
                      <td className="px-2 py-1" data-label="Qtd Folhas">
                        {ro ? (
                          <Input readOnly className="bg-muted max-md:w-24" value={fmtNum(v.quantidade_folhas)} />
                        ) : (
                          <NumberInput type="number" className="max-md:w-24" value={v.quantidade_folhas}
                            onChange={(e) => updateVar(i, j, { quantidade_folhas: Math.max(0, Number(e.target.value)) })} />
                        )}
                      </td>
                      <td className="px-2 py-1" data-label="Metr. Planejada">
                        {ro ? (
                          <Input readOnly className="bg-muted max-md:w-24" value={fmtNum(v.metragem_planejada)} />
                        ) : (
                          <NumberInput type="number" step="0.01" className="max-md:w-24" value={v.metragem_planejada}
                            onChange={(e) => updateVar(i, j, { metragem_planejada: Math.max(0, Number(e.target.value)) })} />
                        )}
                      </td>
                      <td className="px-2 py-1" data-label="Metr. a Separar/Enviar">
                        <NumberInput type="number" step="0.01" className="max-md:w-24" value={v.metragem_enviada}
                          onChange={(e) => updateVar(i, j, { metragem_enviada: Math.max(0, Number(e.target.value)) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        );
      })}
    </Card>
  );
}

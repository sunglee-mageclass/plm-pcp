import { Badge } from "@/components/ui/badge";
import { fmtNum } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { artigoLabel, unidadeSufixo } from "@/lib/artigo-label";
import { cn } from "@/lib/utils";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { fmtMoney, type Artigo, type ItemDraft, type Variante } from "./shared";

export function OcTecidoCalculos({
  items, artigoMap, varianteMap, setQtd,
  totalPrevisto, totalReal, dataPrevista, dataEntrega, status, readOnly = false,
  toggleCancelado, canCancel,
}: {
  items: ItemDraft[];
  artigoMap: Record<string, Artigo>;
  varianteMap: Record<string, Variante>;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => void;
  totalPrevisto: number;
  totalReal: number;
  dataPrevista: string;
  dataEntrega: string;
  status?: string | null;
  readOnly?: boolean;
  toggleCancelado?: (tempId: string, value: boolean) => void;
  canCancel?: boolean;
}) {
  // Rendimento da OC (item) tem prioridade sobre o do cadastro do artigo.
  const rendimentoDe = (it: ItemDraft, a: Artigo) => Number(it.rendimento ?? a.rendimento ?? 0);
  const metragemPedida = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    if (!a) return 0;
    return a.unidade_medida === "kg" ? it.quantidade_pedida * rendimentoDe(it, a) : it.quantidade_pedida;
  };
  const metragemRecebida = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    if (!a || it.quantidade_recebida == null) return 0;
    return a.unidade_medida === "kg" ? it.quantidade_recebida * rendimentoDe(it, a) : it.quantidade_recebida;
  };
  const valorPrev = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * it.quantidade_pedida;
  };
  const valorReal = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * (it.quantidade_recebida ?? 0);
  };
  const hasKg = items.some((it) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return a?.unidade_medida === "kg";
  });

  return (
    <Card className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tecido / Variante</TableHead>
            <TableHead>Qtd Pedida</TableHead>
            {hasKg && <TableHead>Metr. Pedida</TableHead>}
            <TableHead>Qtd Recebida</TableHead>
            {hasKg && <TableHead>Metr. Recebida</TableHead>}
            <TableHead>Valor Prev.</TableHead>
            <TableHead>Valor Real</TableHead>
            {canCancel && <TableHead className="w-24">Cancelar</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.filter((i) => i.variante_tecido_id).map((i) => {
            const a = i.artigo_id ? artigoMap[i.artigo_id] : null;
            const v = varianteMap[i.variante_tecido_id];
            const sufixo = unidadeSufixo(a?.unidade_medida);
            return (
              <TableRow key={i.tempId} className={cn(i.cancelado && "opacity-50")}>
                <TableCell>
                  <div className={cn("text-sm", i.cancelado && "line-through")}>{artigoLabel(a)}</div>
                  <div className={cn("text-xs text-muted-foreground", i.cancelado && "line-through")}>{v?.nome_variante ?? v?.codigo_variante ?? "—"}</div>
                </TableCell>
                <TableCell className={cn(i.cancelado && "line-through")}>{i.quantidade_pedida}{sufixo ? ` ${sufixo}` : ""}</TableCell>
                {hasKg && <TableCell className={cn(i.cancelado && "line-through")}>{fmtNum(metragemPedida(i))} m</TableCell>}
                <TableCell>
                  {i.cancelado ? (
                    <span className="text-sm line-through">
                      {i.quantidade_recebida ?? 0}{sufixo ? ` ${sufixo}` : ""}
                    </span>
                  ) : (
                    <div className="relative w-24">
                      <NumberInput type="number" step="0.01" className={sufixo ? "pr-10" : ""}
                        value={i.quantidade_recebida ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.replace(",", ".");
                          setQtd(i.tempId, "quantidade_recebida", raw === "" ? null : Number(raw));
                        }} />
                      {sufixo && (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          {sufixo}
                        </span>
                      )}
                    </div>
                  )}
                </TableCell>
                {hasKg && <TableCell className={cn(i.cancelado && "line-through")}>{fmtNum(metragemRecebida(i))} m</TableCell>}
                <TableCell className={cn(i.cancelado && "line-through")}>{fmtMoney(valorPrev(i))}</TableCell>
                <TableCell className={cn(i.cancelado && "line-through")}>{fmtMoney(valorReal(i))}</TableCell>
                {canCancel && (
                  <TableCell>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={i.cancelado}
                        onCheckedChange={(c) => toggleCancelado?.(i.tempId, !!c)}
                        disabled={readOnly}
                      />
                      <span className="text-xs">Cancelar</span>
                    </label>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex gap-6 justify-end mt-3 text-sm">
        <div>Total Previsto: <b>{fmtMoney(totalPrevisto)}</b></div>
        <div>Total Real: <b>{fmtMoney(totalReal)}</b></div>
        <OcPrazoBadge dataPrevista={dataPrevista} dataEntrega={dataEntrega} status={status} />
      </div>
    </Card>
  );
}

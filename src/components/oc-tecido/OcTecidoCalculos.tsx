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
import { fmtMoney, type Artigo, type ItemDraft, type RoloEntry, type Variante } from "./shared";

export function OcTecidoCalculos({
  items, artigoMap, varianteMap, setQtd,
  totalPrevisto, totalReal, dataPrevista, dataEntrega, status, readOnly = false,
  toggleCancelado, canCancel,
  modoRolo = false, rolos = {}, setRolos,
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
  // Modo só-rolo: a Qtd Recebida é destrinchada em rolos (a soma = recebido).
  modoRolo?: boolean;
  rolos?: Record<string, RoloEntry[]>;
  setRolos?: React.Dispatch<React.SetStateAction<Record<string, RoloEntry[]>>>;
}) {
  // Atualiza os rolos de um item e reflete a SOMA no quantidade_recebida.
  const aplicarRolos = (tempId: string, novos: RoloEntry[]) => {
    setRolos?.((prev) => ({ ...prev, [tempId]: novos }));
    const soma = novos.reduce((s, e) => s + (Number(String(e.qtd).replace(",", ".")) || 0), 0);
    setQtd(tempId, "quantidade_recebida", soma > 0 ? Math.round(soma * 100) / 100 : null);
  };
  const rolosDe = (tempId: string): RoloEntry[] => rolos[tempId] ?? [{ qtd: "" }];
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
      <Table className="card-table">
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
                <TableCell data-label="Qtd Pedida" className={cn(i.cancelado && "line-through")}>{i.quantidade_pedida}{sufixo ? ` ${sufixo}` : ""}</TableCell>
                {hasKg && <TableCell data-label="Metr. Pedida" className={cn(i.cancelado && "line-through")}>{fmtNum(metragemPedida(i))} m</TableCell>}
                <TableCell data-label="Qtd Recebida">
                  {i.cancelado ? (
                    <span className="text-sm line-through">
                      {i.quantidade_recebida ?? 0}{sufixo ? ` ${sufixo}` : ""}
                    </span>
                  ) : modoRolo ? (
                    <div className="space-y-1.5 min-w-[11rem]">
                      {rolosDe(i.tempId).map((entry, ri) => (
                        <div key={entry.roloId ?? ri} className="flex items-center gap-1.5">
                          <span
                            className="w-16 shrink-0 truncate text-[11px] font-medium text-muted-foreground"
                            title={entry.codigo ?? undefined}
                          >
                            {entry.codigo ?? `#${ri + 1}`}
                          </span>
                          <NumberInput type="number" step="0.01" className="h-9 w-24"
                            value={entry.qtd}
                            disabled={!!entry.roloId || readOnly}
                            onChange={(e) => { const arr = [...rolosDe(i.tempId)]; arr[ri] = { ...arr[ri], qtd: e.target.value }; aplicarRolos(i.tempId, arr); }} />
                          {sufixo && <span className="text-[10px] text-muted-foreground">{sufixo}</span>}
                          {!entry.roloId && !readOnly && rolosDe(i.tempId).length > 1 && (
                            <button type="button" aria-label="Remover rolo" className="text-muted-foreground hover:text-destructive leading-none px-1.5 text-lg"
                              onClick={() => { const arr = rolosDe(i.tempId).filter((_, k) => k !== ri); aplicarRolos(i.tempId, arr.length ? arr : [{ qtd: "" }]); }}>×</button>
                          )}
                        </div>
                      ))}
                      {!readOnly && (
                        <button type="button" className="text-sm text-primary hover:underline" onClick={() => aplicarRolos(i.tempId, [...rolosDe(i.tempId), { qtd: "" }])}>+ rolo</button>
                      )}
                      <div className="text-[11px] text-muted-foreground">Total: <b className="text-foreground">{fmtNum(i.quantidade_recebida ?? 0)}{sufixo ? ` ${sufixo}` : ""}</b> · {rolosDe(i.tempId).filter((e) => Number(String(e.qtd).replace(",", ".")) > 0).length} rolo(s)</div>
                    </div>
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
                {hasKg && <TableCell data-label="Metr. Recebida" className={cn(i.cancelado && "line-through")}>{fmtNum(metragemRecebida(i))} m</TableCell>}
                <TableCell data-label="Valor Prev." className={cn(i.cancelado && "line-through")}>{fmtMoney(valorPrev(i))}</TableCell>
                <TableCell data-label="Valor Real" className={cn(i.cancelado && "line-through")}>{fmtMoney(valorReal(i))}</TableCell>
                {canCancel && (
                  <TableCell data-label="Cancelar">
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
      <div className="flex flex-wrap gap-x-6 gap-y-2 justify-end mt-3 text-sm">
        <div>Total Previsto: <b>{fmtMoney(totalPrevisto)}</b></div>
        <div>Total Real: <b>{fmtMoney(totalReal)}</b></div>
        <OcPrazoBadge dataPrevista={dataPrevista} dataEntrega={dataEntrega} status={status} />
      </div>
    </Card>
  );
}

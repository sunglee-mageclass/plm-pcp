import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fmtNum } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { artigoLabel, unidadeSufixo } from "@/lib/artigo-label";
import { cn } from "@/lib/utils";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { fmtMoney, type Artigo, type ItemDraft, type RoloEntry, type Variante } from "./shared";

// Quantidade EDITÁVEL de um rolo já criado: controlado (mostra o valor salvo) e só
// dispara o ajuste (RPC) no blur se mudou.
function RoloQtyInput({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (nq: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <NumberInput type="number" step="0.01" className="h-9 w-24"
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const nq = Number(String(v).replace(",", "."));
        const orig = Number(String(value).replace(",", "."));
        if (nq > 0 && nq !== orig) onCommit(nq);
        else setV(value);
      }} />
  );
}

export function OcTecidoCalculos({
  items, artigoMap, varianteMap, setQtd,
  totalPrevisto, totalReal, dataPrevista, dataEntrega, status, readOnly = false,
  toggleCancelado, canCancel,
  modoRolo = false, rolos = {}, setRolos, onRoloCq, onRoloCancelar, onRoloAjuste,
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
  onRoloCq?: (roloItemId: string, patch: { cq_ok?: boolean; cq_alerta?: boolean; obs?: string }) => void;
  onRoloCancelar?: (roloId: string, cancel: boolean) => void;
  onRoloAjuste?: (roloId: string, novaQtd: number) => void;
}) {
  // Atualiza os rolos de um item e reflete a SOMA no quantidade_recebida.
  const aplicarRolos = (tempId: string, novos: RoloEntry[]) => {
    setRolos?.((prev) => ({ ...prev, [tempId]: novos }));
    const soma = novos.reduce((s, e) => s + (Number(String(e.qtd).replace(",", ".")) || 0), 0);
    setQtd(tempId, "quantidade_recebida", soma > 0 ? Math.round(soma * 100) / 100 : null);
  };
  const rolosDe = (tempId: string): RoloEntry[] => rolos[tempId] ?? [{ qtd: "" }];
  // Observação/CQ por rolo: se o rolo JÁ existe (recebido, tem roloItemId), grava no
  // item do rolo via onRoloCq; se é PLANEJADO (encomendado), só atualiza o estado local
  // (vai pro rolos_planejados ao salvar e é aplicado ao rolo quando recebido).
  const setEntryCq = (tempId: string, ri: number, patch: { obs?: string; cq_ok?: boolean; cq_alerta?: boolean }) => {
    const entry = rolosDe(tempId)[ri];
    if (entry?.roloItemId && onRoloCq) {
      onRoloCq(entry.roloItemId, patch);
    } else {
      const arr = [...rolosDe(tempId)];
      arr[ri] = { ...arr[ri], ...patch };
      setRolos?.((prev) => ({ ...prev, [tempId]: arr }));
    }
  };
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
                    <div className="space-y-2 min-w-[12rem] max-w-[22rem]">
                      {rolosDe(i.tempId).map((entry, ri) => (
                        <div key={entry.roloId ?? ri} className="rounded-md border p-2 space-y-2">
                          <div className="flex items-center gap-2">
                            {entry.codigo
                              ? <Badge variant="outline" className="shrink-0 font-mono text-[11px]">{entry.codigo}</Badge>
                              : <span className="w-8 shrink-0 text-xs text-muted-foreground">#{ri + 1}</span>}
                            {entry.cqStatus === "alertado" && <Badge className="shrink-0 bg-amber-500 hover:bg-amber-500 text-[10px]">Alerta</Badge>}
                            {entry.cqStatus === "cancelado" && <Badge className="shrink-0 bg-zinc-500 hover:bg-zinc-500 text-[10px]">Cancelado</Badge>}
                            {entry.cqStatus === "trocado" && <Badge className="shrink-0 bg-blue-600 hover:bg-blue-600 text-[10px]">Trocado</Badge>}
                            {entry.roloId && onRoloAjuste ? (
                              // Rolo já criado: quantidade EDITÁVEL — ajusta via RPC no blur (recalcula a OC).
                              <RoloQtyInput
                                key={`q-${entry.roloId}`}
                                value={entry.qtd}
                                disabled={!!entry.cancelado}
                                onCommit={(nq) => onRoloAjuste(entry.roloId!, nq)} />
                            ) : (
                              <NumberInput type="number" step="0.01" className="h-9 w-24"
                                value={entry.qtd}
                                disabled={readOnly}
                                onChange={(e) => { const arr = [...rolosDe(i.tempId)]; arr[ri] = { ...arr[ri], qtd: e.target.value }; aplicarRolos(i.tempId, arr); }} />
                            )}
                            {sufixo && <span className="text-xs text-muted-foreground">{sufixo}</span>}
                            {!entry.roloId && !readOnly && rolosDe(i.tempId).length > 1 && (
                              <button type="button" aria-label="Remover rolo" className="ml-auto px-1.5 text-lg leading-none text-muted-foreground hover:text-destructive"
                                onClick={() => { const arr = rolosDe(i.tempId).filter((_, k) => k !== ri); aplicarRolos(i.tempId, arr.length ? arr : [{ qtd: "" }]); }}>×</button>
                            )}
                          </div>
                          {/* Observação + CQ por rolo: PLANEJADO no encomendado (vai p/ o
                              rolos_planejados e é aplicado ao receber), REAL no recebido. */}
                          <div className="space-y-2">
                            <Input
                              key={entry.roloItemId ?? `plan-${ri}`}
                              defaultValue={entry.obs ?? ""}
                              placeholder="Observação do rolo (defeito, tonalidade…)"
                              className="h-8 text-xs"
                              onBlur={(e) => { if ((e.target.value || "") !== (entry.obs ?? "")) setEntryCq(i.tempId, ri, { obs: e.target.value }); }}
                            />
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                <Switch checked={!!entry.cq_ok} onCheckedChange={(v) => setEntryCq(i.tempId, ri, { cq_ok: v })} />
                                CQ ok
                              </label>
                              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                <Switch checked={!!entry.cq_alerta} onCheckedChange={(v) => setEntryCq(i.tempId, ri, { cq_alerta: v })} />
                                Alertar estilo
                              </label>
                              {entry.roloId && onRoloCancelar && (
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                  <Checkbox checked={!!entry.cancelado} onCheckedChange={(v) => onRoloCancelar(entry.roloId!, v === true)} />
                                  Cancelar rolo
                                </label>
                              )}
                            </div>
                          </div>
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

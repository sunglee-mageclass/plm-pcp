import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CQ_ALERTA_TONE } from "./CqTecido";
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
import { EnderecoPopover, RoloEnderecoPopover } from "@/components/tecido/EnderecoEditor";
import { useReadOnly } from "@/components/RequirePermission";
import { fmtMoney, labelVariante, metragemPedidaItem, precoItem, type Artigo, type ItemDraft, type RoloEntry, type Variante } from "./shared";

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
  // Endereçar é uma ação SEMPRE permitida (gate só de permissão da página), independente do
  // travamento pós-recebimento (readOnly/isReadOnlyRecebimento, que trava só a qtd recebida).
  const enderecoReadOnly = useReadOnly();

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
  // Metragem pedida: conta única em shared (mesma do box "TOTAL PREVISTO").
  const metragemPedida = (it: ItemDraft) => metragemPedidaItem(it, artigoMap);
  const metragemRecebida = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    if (!a || it.quantidade_recebida == null) return 0;
    return a.unidade_medida === "kg" ? it.quantidade_recebida * rendimentoDe(it, a) : it.quantidade_recebida;
  };
  // Valor por linha usa o preço do ITEM desta compra (fallback p/ o preço do artigo do
  // cadastro) — conta única em shared.
  const precoDe = (it: ItemDraft) => precoItem(it, artigoMap);
  const valorPrev = (it: ItemDraft) => precoDe(it) * it.quantidade_pedida;
  const valorReal = (it: ItemDraft) => precoDe(it) * (it.quantidade_recebida ?? 0);
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
            <TableHead className="sm:text-right">Valor Prev.</TableHead>
            <TableHead className="sm:text-right">Valor Real</TableHead>
            {canCancel && <TableHead className="w-24">Cancelar</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items
            .filter((i) => i.variante_tecido_id)
            // Mantém Tecido 1 antes do 2 e, dentro de cada, ordena por COR BASE e depois COR APELIDO.
            .sort((x, y) => {
              if (x.artigo_numero !== y.artigo_numero) return x.artigo_numero - y.artigo_numero;
              const vx = varianteMap[x.variante_tecido_id], vy = varianteMap[y.variante_tecido_id];
              const base = (vx?.cor?.nome ?? "").localeCompare(vy?.cor?.nome ?? "", "pt-BR", { numeric: true });
              return base !== 0 ? base : (vx?.apelido?.nome ?? "").localeCompare(vy?.apelido?.nome ?? "", "pt-BR", { numeric: true });
            })
            .map((i) => {
            const a = i.artigo_id ? artigoMap[i.artigo_id] : null;
            const v = varianteMap[i.variante_tecido_id];
            const sufixo = unidadeSufixo(a?.unidade_medida);
            return (
              <TableRow key={i.tempId} className={cn(i.cancelado && "opacity-50")}>
                <TableCell>
                  <div className={cn("text-sm", i.cancelado && "line-through")}>{artigoLabel(a)}</div>
                  <div className={cn("text-xs text-muted-foreground", i.cancelado && "line-through")}>{labelVariante(v)}</div>
                </TableCell>
                <TableCell data-label="Qtd Pedida" className={cn("text-muted-foreground", i.cancelado && "line-through")}>{i.quantidade_pedida}{sufixo ? ` ${sufixo}` : ""}</TableCell>
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
                            {entry.cqStatus === "alertado" && <StatusBadge tone={CQ_ALERTA_TONE.alertado} className="shrink-0">Alerta</StatusBadge>}
                            {entry.cqStatus === "cancelado" && <StatusBadge tone={CQ_ALERTA_TONE.cancelado} className="shrink-0">Cancelado</StatusBadge>}
                            {entry.cqStatus === "trocado" && <StatusBadge tone={CQ_ALERTA_TONE.trocado} className="shrink-0">Trocado</StatusBadge>}
                            {entry.usado && <StatusBadge tone="neutral" className="shrink-0" title="Rolo já consumido — não pode editar/cancelar/trocar">Em uso</StatusBadge>}
                            {entry.roloId && onRoloAjuste ? (
                              // Rolo já criado: quantidade EDITÁVEL — ajusta via RPC no blur (recalcula a OC).
                              // Rolo USADO (consumido) trava: não pode mudar/cancelar/trocar.
                              <RoloQtyInput
                                key={`q-${entry.roloId}`}
                                value={entry.qtd}
                                disabled={!!entry.cancelado || !!entry.usado}
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
                              disabled={!!entry.usado}
                              onBlur={(e) => { if ((e.target.value || "") !== (entry.obs ?? "")) setEntryCq(i.tempId, ri, { obs: e.target.value }); }}
                            />
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                <Switch checked={!!entry.cq_ok} disabled={!!entry.usado} onCheckedChange={(v) => setEntryCq(i.tempId, ri, { cq_ok: v })} />
                                CQ ok
                              </label>
                              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                <Switch checked={!!entry.cq_alerta} disabled={!!entry.usado} onCheckedChange={(v) => setEntryCq(i.tempId, ri, { cq_alerta: v })} />
                                Alertar estilo
                              </label>
                              {entry.roloId && onRoloCancelar && (
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                  <Checkbox checked={!!entry.cancelado} disabled={!!entry.usado} onCheckedChange={(v) => onRoloCancelar(entry.roloId!, v === true)} />
                                  Cancelar rolo
                                </label>
                              )}
                              {/* Endereço do rolo (colunas rolo_*) — só depois de criado (roloId). */}
                              {entry.roloId && (
                                <RoloEnderecoPopover roloId={entry.roloId} readOnly={enderecoReadOnly} />
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
                      {/* Input DESTACADO: é o campo de trabalho do recebimento. */}
                      <NumberInput type="number" step="0.01" className={cn("border-primary/60 font-semibold", sufixo && "pr-10")}
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
                  {/* Endereçamento por LOTE (item de OC recebido): só faz sentido quando o
                      item existe fisicamente (OC recebida + id persistido do ocs_tecido_itens).
                      No modo rolo o endereço é por ROLO (colunas rolo_*) — ver o 📍 por rolo acima.
                      Usa enderecoReadOnly (permissão), não readOnly (que trava a qtd no recebido). */}
                  {status === "recebido" && !modoRolo && !i.cancelado && i.id && i.variante_tecido_id && (
                    <div className="mt-1.5">
                      <EnderecoPopover varianteId={i.variante_tecido_id} ocItemId={i.id} readOnly={enderecoReadOnly} />
                    </div>
                  )}
                </TableCell>
                {hasKg && <TableCell data-label="Metr. Recebida" className={cn(i.cancelado && "line-through")}>{fmtNum(metragemRecebida(i))} m</TableCell>}
                <TableCell data-label="Valor Prev." className={cn("tabular-nums whitespace-nowrap sm:text-right", i.cancelado && "line-through")}>{fmtMoney(valorPrev(i))}</TableCell>
                <TableCell data-label="Valor Real" className={cn("tabular-nums whitespace-nowrap sm:text-right", i.cancelado && "line-through")}>{fmtMoney(valorReal(i))}</TableCell>
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
        <div>Total Previsto: <b className="tabular-nums whitespace-nowrap">{fmtMoney(totalPrevisto)}</b></div>
        <div>Total Real: <b className="tabular-nums whitespace-nowrap">{fmtMoney(totalReal)}</b></div>
        <OcPrazoBadge dataPrevista={dataPrevista} dataEntrega={dataEntrega} status={status} />
      </div>
    </Card>
  );
}

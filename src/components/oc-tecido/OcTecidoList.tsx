import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AtrasadasBadge } from "@/components/shared/AtrasadasBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { SortHead, useSort } from "@/components/shared/sort";
import { fmtDate, fmtMoney, type OC, type OcTecidoTab } from "./shared";
import { EstoqueTecidosTable, type useEstoqueTecidos } from "./EstoqueTecidosTab";

export function OcTecidoList({
  tab, setTab,
  ocs, empresaMap, onRowClick, onDelete,
  qtdRecebidaByOc, tecidosByOc, alertaBadgeByOc, estoque,
  tabCounts, rolosSlot,
}: {
  tab: OcTecidoTab;
  setTab: (t: OcTecidoTab) => void;
  ocs: OC[];
  empresaMap: Record<string, string>;
  onRowClick: (id: string) => void;
  onDelete?: (oc: OC) => void;
  qtdRecebidaByOc?: Record<string, string>;
  tecidosByOc?: Record<string, string>;
  alertaBadgeByOc?: Record<string, { label: string; cls: string } | null>;
  // Estado da aba Estoque (consulta + filtros) vive na PÁGINA — os controles ficam no header.
  estoque: ReturnType<typeof useEstoqueTecidos>;
  tabCounts?: { encomendado: number; recebido: number; rolos: number };
  // Conteúdo da aba Rolos (RolosList + AjustesList) — vem da página (nav de 1 nível).
  rolosSlot?: ReactNode;
}) {
  // Filtros vivem no header da PÁGINA (FilterButton); este componente é só as abas + tabelas.
  // Accessors p/ ordenar por valor CRU mesmo quando a célula exibe valor formatado.
  const fornecedorAcc = (o: OC) => (o.empresa_id ? empresaMap[o.empresa_id] ?? "" : "");
  // Ordena pela string exibida na célula (nomes de artigo concatenados) — alfabético via localeCompare do useSort.
  const tecidosAcc = (o: OC) => tecidosByOc?.[o.id] ?? "";
  const qtdRecAcc = (o: OC) => {
    // fmtNum() formata pt-BR ("1.500,00 m"): tira tudo que não é dígito/separador,
    // remove TODOS os pontos de milhar e troca a vírgula decimal por ponto.
    const n = parseFloat(
      String(qtdRecebidaByOc?.[o.id] ?? "")
        .replace(/[^\d.,-]/g, "")
        .replace(/\./g, "")
        .replace(",", "."),
    );
    return Number.isNaN(n) ? null : n;
  };

  // Encomendados: nº pedido, fornecedor, data prevista, valor previsto.
  const enc = useSort(ocs, {
    accessors: {
      numero_pedido: (o: OC) => o.numero_pedido,
      fornecedor: fornecedorAcc,
      tecidos: tecidosAcc,
      data_prevista_entrega: (o: OC) => o.data_prevista_entrega,
      valor_previsto_total: (o: OC) => o.valor_previsto_total ?? 0,
    },
  });

  // Recebidos: nº pedido, fornecedor, data entrega, qtd recebida, valor real.
  const rec = useSort(ocs, {
    accessors: {
      numero_pedido: (o: OC) => o.numero_pedido,
      fornecedor: fornecedorAcc,
      tecidos: tecidosAcc,
      data_entrega: (o: OC) => o.data_entrega,
      qtd_recebida: qtdRecAcc,
      valor_real_total: (o: OC) => o.valor_real_total ?? 0,
    },
  });

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as OcTecidoTab)}>
      {/* Ordem = FLUXO (encomendar → receber → estoque → rolos); contagem viva por aba. */}
      <TabsList>
        <TabsTrigger value="encomendado" className="relative">
          Encomendadas{tabCounts ? ` ${tabCounts.encomendado}` : ""}<AtrasadasBadge chave="oc_tecido_atrasada" />
        </TabsTrigger>
        <TabsTrigger value="recebido">Recebidas{tabCounts ? ` ${tabCounts.recebido}` : ""}</TabsTrigger>
        <TabsTrigger value="estoque">Estoque</TabsTrigger>
        <TabsTrigger value="rolos">Rolos{tabCounts ? ` ${tabCounts.rolos}` : ""}</TabsTrigger>
      </TabsList>

      <TabsContent value="encomendado" className="mt-4">
        {/* Mobile: lista de cards */}
        <div className="space-y-2 sm:hidden">
          {ocs.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Ordenar por</Label>
              <Select value={enc.sortKey ?? ""} onValueChange={(v) => enc.toggle(v)}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="numero_pedido">Nº Pedido</SelectItem>
                  <SelectItem value="fornecedor">Fornecedor</SelectItem>
                  <SelectItem value="tecidos">Tecido(s)</SelectItem>
                  <SelectItem value="data_prevista_entrega">Data Prevista</SelectItem>
                  <SelectItem value="valor_previsto_total">Valor Previsto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {ocs.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma OC encomendada.</Card>
          )}
          {enc.sorted.map((o) => (
            <Card
              key={o.id}
              className="p-3 cursor-pointer active:bg-muted/50"
              onClick={() => onRowClick(o.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{o.numero_pedido ?? "—"}</span>
                    <OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="encomendado" />
                  </div>
                  <div className="text-sm text-muted-foreground truncate mt-0.5">
                    {o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}
                  </div>
                  {tecidosByOc?.[o.id] && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{tecidosByOc[o.id]}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    Prev. {fmtDate(o.data_prevista_entrega)} · {fmtMoney(o.valor_previsto_total ?? 0)}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Desktop: tabela */}
        <Card className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Prazo mora JUNTO do nº (era a coluna "Mensagem" no meio dos números — laudo). */}
                <SortHead label="Nº Pedido / Prazo" sortKey="numero_pedido" sortState={enc} />
                <SortHead label="Fornecedor" sortKey="fornecedor" sortState={enc} />
                <SortHead label="Tecido(s)" sortKey="tecidos" sortState={enc} />
                <SortHead label="Data Prevista" sortKey="data_prevista_entrega" sortState={enc} />
                <SortHead label="Valor Previsto" sortKey="valor_previsto_total" sortState={enc} align="right" className="text-right" />
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma OC encomendada.</TableCell></TableRow>
              )}
              {enc.sorted.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onRowClick(o.id)}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col items-start gap-0.5">
                      {o.numero_pedido ?? "—"}
                      <OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="encomendado" />
                    </div>
                  </TableCell>
                  <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={tecidosByOc?.[o.id] ?? ""}>{tecidosByOc?.[o.id] ?? "—"}</TableCell>
                  <TableCell>{fmtDate(o.data_prevista_entrega)}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtMoney(o.valor_previsto_total ?? 0)}</TableCell>
                  <TableCell className="w-10 py-0 text-right">
                    {onDelete && (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); onDelete(o); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>

      <TabsContent value="recebido" className="mt-4">
        {/* Mobile: lista de cards */}
        <div className="space-y-2 sm:hidden">
          {ocs.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Ordenar por</Label>
              <Select value={rec.sortKey ?? ""} onValueChange={(v) => rec.toggle(v)}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="numero_pedido">Nº Pedido</SelectItem>
                  <SelectItem value="fornecedor">Fornecedor</SelectItem>
                  <SelectItem value="tecidos">Tecido(s)</SelectItem>
                  <SelectItem value="data_entrega">Data Entrega</SelectItem>
                  <SelectItem value="qtd_recebida">Qtd Recebida</SelectItem>
                  <SelectItem value="valor_real_total">Valor Real</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {ocs.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma OC recebida.</Card>
          )}
          {rec.sorted.map((o) => {
            const ab = alertaBadgeByOc?.[o.id];
            return (
              <Card
                key={o.id}
                className="p-3 cursor-pointer active:bg-muted/50"
                onClick={() => onRowClick(o.id)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{o.numero_pedido ?? "—"}</span>
                    {ab && <Badge className={ab.cls}>{ab.label}</Badge>}
                    <OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="recebido" />
                  </div>
                  <div className="text-sm text-muted-foreground truncate mt-0.5">
                    {o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}
                  </div>
                  {tecidosByOc?.[o.id] && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{tecidosByOc[o.id]}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    Entrega {fmtDate(o.data_entrega)} · {fmtMoney(o.valor_real_total)}
                    {qtdRecebidaByOc?.[o.id] ? ` · ${qtdRecebidaByOc[o.id]}` : ""}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Desktop: tabela */}
        <Card className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Nº Pedido / Prazo" sortKey="numero_pedido" sortState={rec} />
                <SortHead label="Fornecedor" sortKey="fornecedor" sortState={rec} />
                <SortHead label="Tecido(s)" sortKey="tecidos" sortState={rec} />
                <SortHead label="Data Entrega" sortKey="data_entrega" sortState={rec} />
                <SortHead label="Qtd Recebida" sortKey="qtd_recebida" sortState={rec} align="right" className="text-right" />
                <SortHead label="Valor Real" sortKey="valor_real_total" sortState={rec} align="right" className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma OC recebida.</TableCell></TableRow>
              )}
              {rec.sorted.map((o) => {
                const ab = alertaBadgeByOc?.[o.id];
                return (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onRowClick(o.id)}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="inline-flex items-center gap-2">
                        {o.numero_pedido ?? "—"}
                        {ab && <Badge className={ab.cls}>{ab.label}</Badge>}
                      </span>
                      <OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="recebido" />
                    </div>
                  </TableCell>
                  <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={tecidosByOc?.[o.id] ?? ""}>{tecidosByOc?.[o.id] ?? "—"}</TableCell>
                  <TableCell>{fmtDate(o.data_entrega)}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{qtdRecebidaByOc?.[o.id] ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtMoney(o.valor_real_total)}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>

      <TabsContent value="estoque" className="mt-4">
        <EstoqueTecidosTable state={estoque} />
      </TabsContent>

      <TabsContent value="rolos" className="mt-4">
        {rolosSlot}
      </TabsContent>
    </Tabs>
  );
}

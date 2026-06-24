import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { fmtDate, fmtMoney, type Colab, type Empresa, type OC, type OCStatus } from "./shared";

export function OcTecidoList({
  tab, setTab,
  filterEmpresa, setFilterEmpresa,
  filterResp, setFilterResp,
  empresas, estilistas, ocs, empresaMap, onRowClick, onDelete,
  qtdRecebidaByOc, alertaBadgeByOc,
}: {
  tab: OCStatus;
  setTab: (t: OCStatus) => void;
  filterEmpresa: string;
  setFilterEmpresa: (v: string) => void;
  filterResp: string;
  setFilterResp: (v: string) => void;
  empresas: Empresa[];
  estilistas: Colab[];
  ocs: OC[];
  empresaMap: Record<string, string>;
  onRowClick: (id: string) => void;
  onDelete?: (oc: OC) => void;
  qtdRecebidaByOc?: Record<string, string>;
  alertaBadgeByOc?: Record<string, { label: string; cls: string } | null>;
}) {
  // Filters now live in the page header via FilterButton; this component renders just tabs + table.
  void filterEmpresa; void setFilterEmpresa; void filterResp; void setFilterResp; void empresas; void estilistas;
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as OCStatus)}>
      <TabsList>
        <TabsTrigger value="encomendado">Encomendados</TabsTrigger>
        <TabsTrigger value="recebido">Recebidos</TabsTrigger>
      </TabsList>

      <TabsContent value="encomendado" className="mt-4">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº Pedido</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead><span className="sm:hidden">Data Prev.</span><span className="hidden sm:inline">Data Prevista</span></TableHead>
                <TableHead><span className="sm:hidden">Valor Prev.</span><span className="hidden sm:inline">Valor Previsto</span></TableHead>
                <TableHead>Mensagem</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma OC encomendada.</TableCell></TableRow>
              )}
              {ocs.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onRowClick(o.id)}>
                  <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                  <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                  <TableCell>{fmtDate(o.data_prevista_entrega)}</TableCell>
                  <TableCell>{fmtMoney(o.valor_previsto_total ?? 0)}</TableCell>
                  <TableCell><OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="encomendado" /></TableCell>
                  <TableCell>
                    {onDelete && (
                      <Button
                        size="icon"
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
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº Pedido</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Data Entrega</TableHead>
                <TableHead>Mensagem</TableHead>
                <TableHead>Qtd Recebida</TableHead>
                <TableHead>Valor Real</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma OC recebida.</TableCell></TableRow>
              )}
              {ocs.map((o) => {
                const ab = alertaBadgeByOc?.[o.id];
                return (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onRowClick(o.id)}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {o.numero_pedido ?? "—"}
                      {ab && <Badge className={ab.cls}>{ab.label}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                  <TableCell>{fmtDate(o.data_entrega)}</TableCell>
                  <TableCell><OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="recebido" /></TableCell>
                  <TableCell>{qtdRecebidaByOc?.[o.id] ?? "—"}</TableCell>
                  <TableCell>{fmtMoney(o.valor_real_total)}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

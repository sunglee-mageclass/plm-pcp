import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney, type Colab, type Empresa, type OC, type OCStatus } from "./shared";

export function OcTecidoList({
  tab, setTab,
  filterEmpresa, setFilterEmpresa,
  filterResp, setFilterResp,
  empresas, estilistas, ocs, empresaMap, onRowClick,
  qtdRecebidaByOc,
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
  qtdRecebidaByOc?: Record<string, string>;
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as OCStatus)}>
      <TabsList>
        <TabsTrigger value="encomendado">Encomendados</TabsTrigger>
        <TabsTrigger value="recebido">Recebidos</TabsTrigger>
      </TabsList>

      <Card className="p-3 mt-4 flex flex-wrap gap-3 items-end">
        <div className="grid gap-1">
          <Label className="text-xs">Fornecedor</Label>
          <Select value={filterEmpresa} onValueChange={setFilterEmpresa}>
            <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome_fantasia}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {tab === "encomendado" && (
          <div className="grid gap-1">
            <Label className="text-xs">Responsável</Label>
            <Select value={filterResp} onValueChange={setFilterResp}>
              <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {estilistas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>

      <TabsContent value="encomendado" className="mt-4">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº Pedido</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Data Prevista</TableHead>
                <TableHead>Valor Previsto</TableHead>
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
                  <TableCell><Badge variant="outline">Aguardando</Badge></TableCell>
                  <TableCell></TableCell>
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
                <TableHead>Qtd Recebida</TableHead>
                <TableHead>Valor Real</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocs.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhuma OC recebida.</TableCell></TableRow>
              )}
              {ocs.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onRowClick(o.id)}>
                  <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                  <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                  <TableCell>{fmtDate(o.data_entrega)}</TableCell>
                  <TableCell>{qtdRecebidaByOc?.[o.id] ?? "—"}</TableCell>
                  <TableCell>{fmtMoney(o.valor_real_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

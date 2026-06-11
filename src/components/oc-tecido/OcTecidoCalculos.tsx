import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney, mensagemEntrega, type Artigo, type ItemDraft, type Variante } from "./shared";

export function OcTecidoCalculos({
  items, artigoMap, varianteMap, setQtd,
  totalPrevisto, totalReal, dataPrevista, dataEntrega,
}: {
  items: ItemDraft[];
  artigoMap: Record<string, Artigo>;
  varianteMap: Record<string, Variante>;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number) => void;
  totalPrevisto: number;
  totalReal: number;
  dataPrevista: string;
  dataEntrega: string;
}) {
  const metragemPedida = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    if (!a) return 0;
    return a.unidade_medida === "kg" ? it.quantidade_pedida * Number(a.rendimento ?? 0) : it.quantidade_pedida;
  };
  const metragemRecebida = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    if (!a || it.quantidade_recebida == null) return 0;
    return a.unidade_medida === "kg" ? it.quantidade_recebida * Number(a.rendimento ?? 0) : it.quantidade_recebida;
  };
  const valorPrev = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * it.quantidade_pedida;
  };
  const valorReal = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * (it.quantidade_recebida ?? 0);
  };

  return (
    <Card className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tecido / Variante</TableHead>
            <TableHead>Qtd Pedida</TableHead>
            <TableHead>Qtd Recebida</TableHead>
            <TableHead>Metr. Pedida</TableHead>
            <TableHead>Metr. Recebida</TableHead>
            <TableHead>Valor Prev.</TableHead>
            <TableHead>Valor Real</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.filter((i) => i.variante_tecido_id).map((i) => {
            const a = i.artigo_id ? artigoMap[i.artigo_id] : null;
            const v = varianteMap[i.variante_tecido_id];
            return (
              <TableRow key={i.tempId}>
                <TableCell>
                  <div className="text-sm">{a?.nome ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{v?.nome_variante ?? v?.codigo_variante ?? "—"}</div>
                </TableCell>
                <TableCell>{i.quantidade_pedida}</TableCell>
                <TableCell>
                  <Input type="number" step="0.01" className="w-24"
                    value={i.quantidade_recebida ?? ""}
                    onChange={(e) => setQtd(i.tempId, "quantidade_recebida", Number(e.target.value))} />
                </TableCell>
                <TableCell>{metragemPedida(i).toFixed(2)}</TableCell>
                <TableCell>{metragemRecebida(i).toFixed(2)}</TableCell>
                <TableCell>{fmtMoney(valorPrev(i))}</TableCell>
                <TableCell>{fmtMoney(valorReal(i))}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex gap-6 justify-end mt-3 text-sm">
        <div>Total Previsto: <b>{fmtMoney(totalPrevisto)}</b></div>
        <div>Total Real: <b>{fmtMoney(totalReal)}</b></div>
        {(() => {
          const m = mensagemEntrega(dataPrevista, dataEntrega);
          const cls =
            m.tone === "atrasado" ? "bg-destructive text-destructive-foreground border-transparent" :
            m.tone === "adiantado" ? "bg-green-600 text-white border-transparent" :
            m.tone === "no_prazo" ? "bg-blue-600 text-white border-transparent" :
            "";
          return <div>Mensagem: <Badge variant="outline" className={cls}>{m.text}</Badge></div>;
        })()}
      </div>
    </Card>
  );
}

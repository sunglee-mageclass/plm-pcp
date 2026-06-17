import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes, Search, Loader2 } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/consumo-oc")({
  component: () => (
    <RequirePermission page="producao_consumo_oc">
      <ConsumoOcPage />
    </RequirePermission>
  ),
});

type Modelo = { modelo_id: string; ref: string | null; nome: string | null; origem: "planejado" | "baixado"; consumo_m: number | null };
type Item = {
  oc_tecido_item_id: string;
  artigo_nome: string | null;
  unidade: string | null;
  variante: string | null;
  pedido_m: number | null;
  recebido_m: number | null;
  baixado_m: number | null;
  modelos: Modelo[];
};
type OC = {
  oc_id: string;
  numero_pedido: string | null;
  status: string | null;
  data_entrega: string | null;
  fornecedor: string | null;
  itens: Item[];
};

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const fmtDate = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "—");

function ConsumoOcPage() {
  const [search, setSearch] = useState("");

  const { data: ocs = [], isLoading } = useQuery({
    queryKey: ["consumo-por-oc"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consumo_por_oc" as any);
      if (error) throw error;
      return ((data ?? []) as unknown) as OC[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return ocs;
    return ocs.filter((oc) =>
      (oc.numero_pedido ?? "").toLowerCase().includes(s) ||
      (oc.fornecedor ?? "").toLowerCase().includes(s) ||
      oc.itens.some((it) => (it.artigo_nome ?? "").toLowerCase().includes(s)),
    );
  }, [ocs, search]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-start gap-3">
        <Boxes className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Consumo por OC</h1>
          <p className="text-sm text-muted-foreground">
            Quanto cada modelo consome da OC e quanto sobra. Consumo = consumo × (grade + 1 piloto), sem perda. Não baixa estoque — é conferência.
          </p>
        </div>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar OC, fornecedor, tecido…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Nenhuma OC encontrada.</div>
      ) : (
        <div className="space-y-4">
          {filtered.map((oc) => (
            <Card key={oc.oc_id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base">
                    OC {oc.numero_pedido ?? "—"}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">{oc.fornecedor ?? ""}</span>
                  </CardTitle>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{fmtDate(oc.data_entrega)}</span>
                    {oc.status === "recebido"
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Recebida</Badge>
                      : <Badge variant="secondary">Encomendada</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {oc.itens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem itens.</p>
                ) : (
                  oc.itens.map((it) => {
                    const total = it.modelos.reduce((s, m) => s + num(m.consumo_m), 0);
                    const base = oc.status === "recebido" ? num(it.recebido_m) : num(it.pedido_m);
                    const sobra = base - total;
                    const sobraClass = sobra < 0 ? "text-destructive" : sobra <= base * 0.05 ? "text-emerald-600" : "text-foreground";
                    return (
                      <div key={it.oc_tecido_item_id} className="rounded-md border">
                        <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-muted/40 rounded-t-md">
                          <div className="font-medium text-sm">
                            {it.artigo_nome ?? "—"} <span className="text-muted-foreground">· {it.variante ?? "—"}</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm tabular-nums">
                            <span className="text-muted-foreground">{oc.status === "recebido" ? "Recebido" : "Pedido"}: <strong className="text-foreground">{fmt(base)} m</strong></span>
                            <span className="text-muted-foreground">Consumido: <strong className="text-foreground">{fmt(total)} m</strong></span>
                            <span className="text-muted-foreground">Sobra: <strong className={sobraClass}>{fmt(sobra)} m</strong></span>
                          </div>
                        </div>
                        {it.modelos.length === 0 ? (
                          <p className="text-sm text-muted-foreground px-3 py-2">Nenhum modelo consome desta OC ainda.</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Modelo</TableHead>
                                <TableHead>Origem</TableHead>
                                <TableHead className="text-right">Consumo (m)</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {it.modelos.map((m, i) => (
                                <TableRow key={`${m.modelo_id}-${m.origem}-${i}`}>
                                  <TableCell>{[m.ref, m.nome].filter(Boolean).join(" · ") || "—"}</TableCell>
                                  <TableCell>
                                    {m.origem === "baixado"
                                      ? <Badge variant="outline" className="border-emerald-500 text-emerald-600">Baixado</Badge>
                                      : <Badge variant="outline">Planejado</Badge>}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{fmt(num(m.consumo_m))}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DollarSign, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, isSameMonth, isSameDay, parseISO, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: FinanceiroPage,
});

type Parcela = {
  id: string;
  tipo_oc: string;
  oc_tecido_id: string | null;
  oc_aviamento_id: string | null;
  empresa_id: string | null;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string | null;
  comprovante_url: string | null;
  empresas?: { nome: string } | null;
  ocs_tecido?: { numero_pedido: string | null } | null;
  ocs_aviamento?: { numero_pedido: string | null } | null;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function effectiveStatus(p: Parcela): "pago" | "vencido" | "a_pagar" {
  if (p.status === "pago" || p.data_pagamento) return "pago";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (parseISO(p.data_vencimento) < today) return "vencido";
  return "a_pagar";
}

function FinanceiroPage() {
  const { data: parcelas = [], isLoading } = useQuery({
    queryKey: ["parcelas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parcelas")
        .select("*, empresas(nome), ocs_tecido(numero_pedido), ocs_aviamento(numero_pedido)")
        .order("data_vencimento", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Parcela[];
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <DollarSign className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Financeiro</h1>
          <p className="text-sm text-muted-foreground">Parcelas, calendário e resumo financeiro.</p>
        </div>
      </header>

      <Tabs defaultValue="calendario">
        <TabsList>
          <TabsTrigger value="calendario">Calendário</TabsTrigger>
          <TabsTrigger value="lista">Lista de Parcelas</TabsTrigger>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
        </TabsList>
        <TabsContent value="calendario" className="mt-4">
          <CalendarioView parcelas={parcelas} loading={isLoading} />
        </TabsContent>
        <TabsContent value="lista" className="mt-4">
          <ListaView parcelas={parcelas} loading={isLoading} />
        </TabsContent>
        <TabsContent value="resumo" className="mt-4">
          <ResumoView parcelas={parcelas} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ CALENDÁRIO ============================ */

function CalendarioView({ parcelas, loading }: { parcelas: Parcela[]; loading: boolean }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const byDay = useMemo(() => {
    const m = new Map<string, Parcela[]>();
    for (const p of parcelas) {
      const k = p.data_vencimento;
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  }, [parcelas]);

  const today = new Date();

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="font-semibold text-lg w-44 text-center">
            {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
          <Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>Hoje</Button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border text-xs">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <div key={d} className="bg-muted text-muted-foreground py-2 text-center font-medium">{d}</div>
        ))}
        {days.map((day) => {
          const k = format(day, "yyyy-MM-dd");
          const items = byDay.get(k) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={k}
              className={cn(
                "bg-background min-h-[90px] p-1.5 text-xs",
                !inMonth && "opacity-40",
                isToday && "ring-1 ring-primary",
              )}
            >
              <div className="text-right text-[11px] text-muted-foreground mb-1">{format(day, "d")}</div>
              <div className="space-y-1">
                {items.slice(0, 3).map((p) => {
                  const st = effectiveStatus(p);
                  const venc = parseISO(p.data_vencimento);
                  const diff = differenceInCalendarDays(venc, today);
                  let color = "bg-muted text-muted-foreground";
                  if (st === "pago") color = "bg-green-500/20 text-green-700 dark:text-green-300";
                  else if (st === "vencido") color = "bg-destructive/20 text-destructive";
                  else if (diff <= 3) color = "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300";
                  return (
                    <div key={p.id} className={cn("px-1.5 py-0.5 rounded truncate", color)}>
                      {p.empresas?.nome ?? "—"} · {brl(Number(p.valor))}
                    </div>
                  );
                })}
                {items.length > 3 && <div className="text-[10px] text-muted-foreground">+{items.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 mt-4 text-xs">
        <Legend2 color="bg-green-500/30" label="Pago" />
        <Legend2 color="bg-yellow-500/30" label="Vence em ≤ 3 dias" />
        <Legend2 color="bg-destructive/30" label="Vencido" />
        <Legend2 color="bg-muted" label="Futuro" />
      </div>

      {loading && <p className="text-sm text-muted-foreground mt-2">Carregando…</p>}
    </Card>
  );
}

function Legend2({ color, label }: { color: string; label: string }) {
  return <div className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-3 rounded", color)} />{label}</div>;
}

/* ============================== LISTA ============================== */

function ListaView({ parcelas, loading }: { parcelas: Parcela[]; loading: boolean }) {
  const [fornecedor, setFornecedor] = useState("all");
  const [status, setStatus] = useState("all");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [pagandoId, setPagandoId] = useState<string | null>(null);

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of parcelas) if (p.empresa_id) m.set(p.empresa_id, p.empresas?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [parcelas]);

  const filtered = useMemo(() => {
    return parcelas.filter((p) => {
      if (fornecedor !== "all" && p.empresa_id !== fornecedor) return false;
      if (status !== "all" && effectiveStatus(p) !== status) return false;
      if (dataIni && p.data_vencimento < dataIni) return false;
      if (dataFim && p.data_vencimento > dataFim) return false;
      return true;
    });
  }, [parcelas, fornecedor, status, dataIni, dataFim]);

  const ocNumero = (p: Parcela) => p.ocs_tecido?.numero_pedido ?? p.ocs_aviamento?.numero_pedido ?? "—";

  return (
    <div className="space-y-4">
      <Card className="p-4 grid gap-3 sm:grid-cols-4">
        <div>
          <Label>Fornecedor</Label>
          <Select value={fornecedor} onValueChange={setFornecedor}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="a_pagar">A pagar</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
              <SelectItem value="vencido">Vencido</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>De</Label>
          <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
        </div>
      </Card>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Fornecedor</th>
                <th className="py-2 pr-3">Nº Pedido</th>
                <th className="py-2 pr-3">Parcela</th>
                <th className="py-2 pr-3 text-right">Valor</th>
                <th className="py-2 pr-3">Vencimento</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Pagamento</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const st = effectiveStatus(p);
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{p.empresas?.nome ?? "—"}</td>
                    <td className="py-2 pr-3">{ocNumero(p)}</td>
                    <td className="py-2 pr-3">{p.numero_parcela}</td>
                    <td className="py-2 pr-3 text-right">{brl(Number(p.valor))}</td>
                    <td className="py-2 pr-3">{format(parseISO(p.data_vencimento), "dd/MM/yyyy")}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={st === "pago" ? "default" : st === "vencido" ? "destructive" : "secondary"}>
                        {st === "a_pagar" ? "A pagar" : st === "pago" ? "Pago" : "Vencido"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{p.data_pagamento ? format(parseISO(p.data_pagamento), "dd/MM/yyyy") : "—"}</td>
                    <td className="py-2 pr-3">
                      {st !== "pago" && (
                        <Button size="sm" variant="outline" onClick={() => setPagandoId(p.id)}>Marcar pago</Button>
                      )}
                      {p.comprovante_url && (
                        <a href={p.comprovante_url} target="_blank" rel="noreferrer" className="text-xs text-primary ml-2">comprovante</a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">Nenhuma parcela.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <PagarDialog parcelaId={pagandoId} onClose={() => setPagandoId(null)} />
    </div>
  );
}

function PagarDialog({ parcelaId, onClose }: { parcelaId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [dataPag, setDataPag] = useState(format(new Date(), "yyyy-MM-dd"));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const mut = useMutation({
    mutationFn: async () => {
      if (!parcelaId) return;
      setUploading(true);
      let url: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${parcelaId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("comprovantes").upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: signed } = await supabase.storage.from("comprovantes").createSignedUrl(path, 60 * 60 * 24 * 365);
        url = signed?.signedUrl ?? null;
      }
      const { error } = await supabase
        .from("parcelas")
        .update({ status: "pago", data_pagamento: dataPag, ...(url ? { comprovante_url: url } : {}) })
        .eq("id", parcelaId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela marcada como paga");
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      setFile(null);
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
    onSettled: () => setUploading(false),
  });

  return (
    <Dialog open={!!parcelaId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Marcar como pago</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Data do pagamento</Label>
            <Input type="date" value={dataPag} onChange={(e) => setDataPag(e.target.value)} />
          </div>
          <div>
            <Label>Comprovante (opcional)</Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="text-xs text-muted-foreground mt-1"><Upload className="inline h-3 w-3 mr-1" />{file.name}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={uploading || mut.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== RESUMO ============================== */

function ResumoView({ parcelas }: { parcelas: Parcela[] }) {
  const today = new Date();
  const ms = startOfMonth(today);
  const me = endOfMonth(today);

  const totalPagarMes = parcelas
    .filter((p) => effectiveStatus(p) !== "pago" && parseISO(p.data_vencimento) >= ms && parseISO(p.data_vencimento) <= me)
    .reduce((s, p) => s + Number(p.valor), 0);

  const totalPagoMes = parcelas
    .filter((p) => p.data_pagamento && parseISO(p.data_pagamento) >= ms && parseISO(p.data_pagamento) <= me)
    .reduce((s, p) => s + Number(p.valor), 0);

  const totalVencido = parcelas
    .filter((p) => effectiveStatus(p) === "vencido")
    .reduce((s, p) => s + Number(p.valor), 0);

  const chartData = useMemo(() => {
    const m = new Map<string, { mes: string; pago: number; a_pagar: number }>();
    const base = addMonths(startOfMonth(today), -5);
    for (let i = 0; i < 12; i++) {
      const d = addMonths(base, i);
      const k = format(d, "yyyy-MM");
      m.set(k, { mes: format(d, "MMM/yy", { locale: ptBR }), pago: 0, a_pagar: 0 });
    }
    for (const p of parcelas) {
      const k = p.data_vencimento.slice(0, 7);
      const row = m.get(k);
      if (!row) continue;
      const st = effectiveStatus(p);
      if (st === "pago") row.pago += Number(p.valor);
      else row.a_pagar += Number(p.valor);
    }
    return Array.from(m.values());
  }, [parcelas]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard title="Total a pagar (mês)" value={brl(totalPagarMes)} accent="text-yellow-600 dark:text-yellow-400" />
        <SummaryCard title="Total pago (mês)" value={brl(totalPagoMes)} accent="text-green-600 dark:text-green-400" />
        <SummaryCard title="Total vencido" value={brl(totalVencido)} accent="text-destructive" />
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Evolução mensal</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => v.toLocaleString("pt-BR")} />
              <Tooltip formatter={(v: any) => brl(Number(v))} />
              <Legend />
              <Bar dataKey="pago" name="Pago" fill="hsl(142 71% 45%)" />
              <Bar dataKey="a_pagar" name="A pagar" fill="hsl(45 93% 47%)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className={cn("text-2xl font-bold mt-1", accent)}>{value}</p>
    </Card>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useAuth } from "@/hooks/useAuth";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/financeiro")({
  component: () => (
    <RequirePermission anyOf={["financeiro_parcelas","financeiro_calendario"]}>
      <FinanceiroPage />
    </RequirePermission>
  ),
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
      const { data: rows, error } = await supabase
        .from("parcelas")
        .select("*")
        .order("data_vencimento", { ascending: true });
      if (error) throw error;
      const list = (rows ?? []) as unknown as Parcela[];

      const empresaIds = Array.from(new Set(list.map((p) => p.empresa_id).filter(Boolean))) as string[];
      const tecidoIds = Array.from(new Set(list.map((p) => p.oc_tecido_id).filter(Boolean))) as string[];
      const aviamentoIds = Array.from(new Set(list.map((p) => p.oc_aviamento_id).filter(Boolean))) as string[];

      const [empresasRes, tecidoRes, aviamentoRes] = await Promise.all([
        empresaIds.length
          ? supabase.from("empresas").select("id,nome_fantasia").in("id", empresaIds)
          : Promise.resolve({ data: [], error: null } as const),

        tecidoIds.length
          ? supabase.from("ocs_tecido").select("id,numero_pedido").in("id", tecidoIds)
          : Promise.resolve({ data: [], error: null } as const),
        aviamentoIds.length
          ? supabase.from("ocs_aviamento").select("id,numero_pedido").in("id", aviamentoIds)
          : Promise.resolve({ data: [], error: null } as const),
      ]);
      if (empresasRes.error) throw empresasRes.error;
      if (tecidoRes.error) throw tecidoRes.error;
      if (aviamentoRes.error) throw aviamentoRes.error;

      const empMap = new Map((empresasRes.data ?? []).map((e: any) => [e.id, e.nome_fantasia as string]));
      const tecMap = new Map((tecidoRes.data ?? []).map((o: any) => [o.id, o.numero_pedido as string | null]));
      const aviMap = new Map((aviamentoRes.data ?? []).map((o: any) => [o.id, o.numero_pedido as string | null]));

      return list.map((p) => ({
        ...p,
        empresas: p.empresa_id ? { nome: empMap.get(p.empresa_id) ?? "—" } : null,
        ocs_tecido: p.oc_tecido_id ? { numero_pedido: tecMap.get(p.oc_tecido_id) ?? null } : null,
        ocs_aviamento: p.oc_aviamento_id ? { numero_pedido: aviMap.get(p.oc_aviamento_id) ?? null } : null,
      }));
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
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const autoJumped = useRef(false);

  // Quando as parcelas chegarem, se o mês atual estiver vazio, salta para o mês da próxima parcela
  useEffect(() => {
    if (autoJumped.current || parcelas.length === 0) return;
    const now = startOfMonth(new Date());
    const hasCurrent = parcelas.some((p) => isSameMonth(parseISO(p.data_vencimento), now));
    if (hasCurrent) { autoJumped.current = true; return; }
    const future = parcelas
      .map((p) => parseISO(p.data_vencimento))
      .filter((d) => d >= now)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (future) setCursor(startOfMonth(future));
    autoJumped.current = true;
  }, [parcelas]);


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
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDetalheId(p.id)}
                      className={cn("w-full text-left px-1.5 py-0.5 rounded truncate hover:ring-1 hover:ring-primary", color)}
                    >
                      {p.empresas?.nome ?? "—"} · {brl(Number(p.valor))}
                    </button>
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

      <ParcelaDetailDialog
        parcela={detalheId ? parcelas.find((p) => p.id === detalheId) ?? null : null}
        onClose={() => setDetalheId(null)}
        onMarkPaid={(id) => { setDetalheId(null); setPagandoId(id); }}
      />
      <PagarDialog parcelaId={pagandoId} onClose={() => setPagandoId(null)} />
    </Card>
  );
}

function ParcelaDetailDialog({
  parcela, onClose, onMarkPaid,
}: {
  parcela: Parcela | null;
  onClose: () => void;
  onMarkPaid: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { isAdmin, isSuperAdmin, isTenantAdmin } = useAuth();
  const canRecalc = isAdmin || isSuperAdmin || isTenantAdmin;

  const recalcMut = useMutation({
    mutationFn: async () => {
      if (!parcela) return;
      const ocId = parcela.oc_tecido_id ?? parcela.oc_aviamento_id;
      if (!ocId) throw new Error("Parcela sem OC vinculada");
      const { data, error } = await supabase.rpc("recalcular_parcelas" as any, {
        _oc_id: ocId,
        _tipo: parcela.tipo_oc,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      toast.success(
        `Parcelas recalculadas: ${data?.criadas ?? 0} criadas, ${data?.deletadas ?? 0} removidas, ${data?.preservadas_pagas ?? 0} pagas preservadas.`,
      );
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao recalcular"),
  });

  if (!parcela) return null;
  const st = effectiveStatus(parcela);
  const ocNumero = parcela.ocs_tecido?.numero_pedido ?? parcela.ocs_aviamento?.numero_pedido ?? "—";
  const tipoLabel = parcela.tipo_oc === "tecido" ? "OC de Tecido" : parcela.tipo_oc === "aviamento" ? "OC de Aviamento" : parcela.tipo_oc;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Detalhes da Parcela</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Fornecedor:</span> <b>{parcela.empresas?.nome ?? "—"}</b></div>
          <div><span className="text-muted-foreground">Origem:</span> {tipoLabel} · Nº {ocNumero}</div>
          <div><span className="text-muted-foreground">Parcela:</span> {parcela.numero_parcela}</div>
          <div><span className="text-muted-foreground">Valor:</span> <b>{brl(Number(parcela.valor))}</b></div>
          <div><span className="text-muted-foreground">Vencimento:</span> {format(parseISO(parcela.data_vencimento), "dd/MM/yyyy")}</div>
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            <Badge variant={st === "pago" ? "default" : st === "vencido" ? "destructive" : "secondary"}>
              {st === "a_pagar" ? "A pagar" : st === "pago" ? "Pago" : "Vencido"}
            </Badge>
          </div>
          {parcela.data_pagamento && (
            <div><span className="text-muted-foreground">Pago em:</span> {format(parseISO(parcela.data_pagamento), "dd/MM/yyyy")}</div>
          )}
          {parcela.comprovante_url && (
            <div><ComprovanteLink value={parcela.comprovante_url} label="Ver comprovante" className="text-primary" /></div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {canRecalc && (
            <Button
              variant="outline"
              onClick={() => {
                if (confirm("Recalcular parcelas desta OC? Parcelas pagas serão preservadas; as demais serão regeradas com os valores atuais.")) {
                  recalcMut.mutate();
                }
              }}
              disabled={recalcMut.isPending}
            >
              Recalcular Parcelas
            </Button>
          )}
          {st !== "pago" && (
            <Button onClick={() => onMarkPaid(parcela.id)}>Marcar pago</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComprovanteLink({ value, label, className }: { value: string; label: string; className?: string }) {
  // Compat: registros antigos guardavam a signed URL inteira; novos guardam o path do bucket.
  const isPath = !value.startsWith("http");
  const signedUrl = useSignedUrl(isPath ? value : null, "comprovantes");
  const href = isPath ? signedUrl : value;
  if (!href) return null;
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{label}</a>;
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
                        <ComprovanteLink value={p.comprovante_url} label="comprovante" className="text-xs text-primary ml-2" />
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
      let path: string | null = null;
      if (file) {
        const { tenantPrefix } = await import("@/lib/storage-tenant");
        const tenant = await tenantPrefix();
        const ext = file.name.split(".").pop() ?? "bin";
        path = `${tenant}/${parcelaId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("comprovantes").upload(path, file, { upsert: true });
        if (upErr) throw upErr;
      }
      const { error } = await supabase
        .from("parcelas")
        .update({ status: "pago", data_pagamento: dataPag, ...(path ? { comprovante_url: path } : {}) })
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

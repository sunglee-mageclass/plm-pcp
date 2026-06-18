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
import { ModuleGuard } from "@/components/ModuleGuard";
import { FilterButton } from "@/components/shared/filters";
export const Route = createFileRoute("/_authenticated/financeiro")({
  component: () => (
    <ModuleGuard module="financeiro">
      <RequirePermission anyOf={["financeiro_parcelas","financeiro_calendario","financeiro_resumo"]}>
        <FinanceiroPage />
      </RequirePermission>
    </ModuleGuard>
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

// Data de hoje no fuso local como "yyyy-MM-dd" (sem hora, sem UTC).
function todayLocalISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// Parse de "yyyy-MM-dd" como data LOCAL (parseISO trata date-only como UTC → shift de dia em BRT).
function parseLocalDate(s: string | null | undefined): Date {
  const [y, m, d] = (s ?? "").slice(0, 10).split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function effectiveStatus(p: Parcela): "pago" | "vencido" | "a_pagar" {
  if (p.status === "pago" || p.data_pagamento) return "pago";
  // Comparação de strings "yyyy-MM-dd" (lexicográfica = cronológica) — robusta,
  // sem depender de parseISO/fuso. Vencimento ANTES de hoje = vencido.
  const venc = (p.data_vencimento ?? "").slice(0, 10);
  if (venc && venc < todayLocalISO()) return "vencido";
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
  const [ocView, setOcView] = useState<{ tipo: string; id: string } | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const autoJumped = useRef(false);

  // Quando as parcelas chegarem, se o mês atual estiver vazio, salta para o mês da próxima parcela
  useEffect(() => {
    if (autoJumped.current || parcelas.length === 0) return;
    const now = startOfMonth(new Date());
    const hasCurrent = parcelas.some((p) => isSameMonth(parseLocalDate(p.data_vencimento), now));
    if (hasCurrent) { autoJumped.current = true; return; }
    const future = parcelas
      .map((p) => parseLocalDate(p.data_vencimento))
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
                  const venc = parseLocalDate(p.data_vencimento);
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
        onOpenOc={(tipo, id) => { setDetalheId(null); setOcView({ tipo, id }); }}
        onVencimentoSaved={(d) => { autoJumped.current = true; setCursor(startOfMonth(parseLocalDate(d))); }}
      />
      <PagarDialog parcelaId={pagandoId} onClose={() => setPagandoId(null)} />
      <OcViewDialog view={ocView} onClose={() => setOcView(null)} />
    </Card>
  );
}

function ParcelaDetailDialog({
  parcela, onClose, onMarkPaid, onOpenOc, onVencimentoSaved,
}: {
  parcela: Parcela | null;
  onClose: () => void;
  onMarkPaid: (id: string) => void;
  onOpenOc: (tipo: string, ocId: string) => void;
  onVencimentoSaved?: (date: string) => void;
}) {
  const qc = useQueryClient();
  const { isAdmin, isSuperAdmin, isTenantAdmin } = useAuth();
  const canRecalc = isAdmin || isSuperAdmin || isTenantAdmin;

  const desmarcarPagoMut = useMutation({
    mutationFn: async () => {
      if (!parcela) return;
      const { error } = await supabase.from("parcelas")
        .update({ status: "a_pagar", data_pagamento: null }).eq("id", parcela.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento desmarcado");
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao desmarcar"),
  });

  const [vencimento, setVencimento] = useState(parcela?.data_vencimento ?? "");
  useEffect(() => {
    setVencimento(parcela?.data_vencimento ?? "");
  }, [parcela?.id, parcela?.data_vencimento]);

  const updateVencimentoMut = useMutation({
    mutationFn: async () => {
      if (!parcela) return;
      const { error } = await supabase.from("parcelas").update({ data_vencimento: vencimento } as any).eq("id", parcela.id);
      if (error) throw error;
    },
    onMutate: async () => {
      if (!parcela) return {};
      await qc.cancelQueries({ queryKey: ["parcelas"] });
      const prev = qc.getQueryData<any[]>(["parcelas"]);
      qc.setQueryData<any[]>(["parcelas"], (old) => (old ?? []).map((p) =>
        p.id === parcela.id ? { ...p, data_vencimento: vencimento } : p));
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["parcelas"], ctx.prev);
      toast.error(e.message ?? "Erro ao atualizar vencimento");
    },
    onSuccess: () => {
      toast.success("Vencimento atualizado");
      // Mantém a parcela editada VISÍVEL: salta o calendário para o mês da nova
      // data (senão o chip re-chaveia para um mês fora da vista e parece sumir).
      // O badge já está vermelho aqui — a lógica de status NÃO muda.
      onVencimentoSaved?.(vencimento);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["parcelas"] }),
  });

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
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Vencimento:</span>
            <Input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              className="h-7 w-auto"
            />
            {vencimento !== parcela.data_vencimento && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateVencimentoMut.mutate()}
                disabled={updateVencimentoMut.isPending}
              >
                Salvar
              </Button>
            )}
          </div>
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
        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Fechar</Button>
          {(parcela.oc_tecido_id || parcela.oc_aviamento_id) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenOc(parcela.tipo_oc, (parcela.oc_tecido_id ?? parcela.oc_aviamento_id)!)}
            >
              Abrir OC
            </Button>
          )}
          {canRecalc && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm("Recalcular parcelas desta OC? Parcelas pagas serão preservadas; as demais serão regeradas com os valores atuais.")) {
                  recalcMut.mutate();
                }
              }}
              disabled={recalcMut.isPending}
            >
              Recalcular
            </Button>
          )}
          {st === "pago" ? (
            <Button size="sm" variant="destructive" onClick={() => desmarcarPagoMut.mutate()} disabled={desmarcarPagoMut.isPending}>
              Desmarcar pago
            </Button>
          ) : (
            <Button size="sm" onClick={() => onMarkPaid(parcela.id)}>Marcar pago</Button>
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

// Célula de vencimento com estado local: salva no BLUR (não a cada tecla) e mostra
// o que o usuário escolheu enquanto edita.
function VencimentoCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <Input
      type="date"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v && v !== value) onSave(v); }}
      className="h-7 w-auto"
    />
  );
}

function ListaView({ parcelas, loading }: { parcelas: Parcela[]; loading: boolean }) {
  const qc = useQueryClient();
  const [fornecedor, setFornecedor] = useState("all");
  const [status, setStatus] = useState("all");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const [ocView, setOcView] = useState<{ tipo: string; id: string } | null>(null);
  // Realce transitório da linha recém-editada: como a lista é ordenada por
  // data_vencimento, mudar a data faz a linha SALTAR de posição no re-sort —
  // o realce ajuda o usuário a seguir para onde ela foi (e ver o novo status).
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const desmarcarMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("parcelas")
        .update({ status: "a_pagar", data_pagamento: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento desmarcado");
      qc.invalidateQueries({ queryKey: ["parcelas"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao desmarcar"),
  });

  const updateVencimentoMut = useMutation({
    // Só grava a DATA. O status "Vencido/A pagar" é DERIVADO da data (effectiveStatus),
    // então não precisa (e não deve) ser persistido aqui — evita falha de update.
    mutationFn: async ({ id, data }: { id: string; data: string }) => {
      const { error } = await supabase.from("parcelas").update({ data_vencimento: data } as any).eq("id", id);
      if (error) throw error;
    },
    // Atualização otimista: a badge recalcula na hora pela nova data.
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["parcelas"] });
      const prev = qc.getQueryData<any[]>(["parcelas"]);
      qc.setQueryData<any[]>(["parcelas"], (old) => (old ?? []).map((p) =>
        p.id === id ? { ...p, data_vencimento: data } : p));
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["parcelas"], ctx.prev);
      toast.error(e.message ?? "Erro ao atualizar vencimento");
    },
    onSuccess: (_data, vars) => {
      toast.success("Vencimento atualizado");
      setHighlightId(vars.id);
      setTimeout(() => setHighlightId((cur) => (cur === vars.id ? null : cur)), 2500);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["parcelas"] }),
  });

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
                  <tr
                    key={p.id}
                    className={`border-b last:border-0 transition-colors ${p.id === highlightId ? "bg-primary/10" : ""}`}
                  >
                    <td className="py-2 pr-3">{p.empresas?.nome ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {(p.oc_tecido_id || p.oc_aviamento_id) ? (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => setOcView({ tipo: p.tipo_oc, id: (p.oc_tecido_id ?? p.oc_aviamento_id)! })}
                        >
                          {ocNumero(p)}
                        </button>
                      ) : ocNumero(p)}
                    </td>
                    <td className="py-2 pr-3">{p.numero_parcela}</td>
                    <td className="py-2 pr-3 text-right">{brl(Number(p.valor))}</td>
                    <td className="py-2 pr-3">
                      <VencimentoCell
                        value={p.data_vencimento}
                        onSave={(v) => updateVencimentoMut.mutate({ id: p.id, data: v })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={st === "pago" ? "default" : st === "vencido" ? "destructive" : "secondary"}>
                        {st === "a_pagar" ? "A pagar" : st === "pago" ? "Pago" : "Vencido"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{p.data_pagamento ? format(parseISO(p.data_pagamento), "dd/MM/yyyy") : "—"}</td>
                    <td className="py-2 pr-3">
                      {st !== "pago" ? (
                        <Button size="sm" variant="outline" onClick={() => setPagandoId(p.id)}>Marcar pago</Button>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => desmarcarMut.mutate(p.id)} disabled={desmarcarMut.isPending}>Desmarcar</Button>
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
      <OcViewDialog view={ocView} onClose={() => setOcView(null)} />
    </div>
  );
}

/* ===== Janela read-only da OC (acessível pelas parcelas) ===== */

function OcViewDialog({ view, onClose }: { view: { tipo: string; id: string } | null; onClose: () => void }) {
  const { data: oc, isLoading } = useQuery({
    queryKey: ["oc-view", view?.tipo, view?.id],
    enabled: !!view?.id,
    queryFn: async () => {
      if (view!.tipo === "tecido") {
        const { data } = await supabase
          .from("ocs_tecido")
          .select("*, empresas:empresa_id(nome_fantasia), ocs_tecido_itens(quantidade_pedida, quantidade_recebida, artigos:artigo_id(nome), variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome)))")
          .eq("id", view!.id)
          .maybeSingle();
        return data as any;
      }
      const { data } = await supabase
        .from("ocs_aviamento")
        .select("*, empresas:empresa_id(nome_fantasia), ocs_aviamento_itens(quantidade_pedida, quantidade_recebida, aviamentos:aviamento_id(codigo_nome))")
        .eq("id", view!.id)
        .maybeSingle();
      return data as any;
    },
  });

  const itens: any[] = view?.tipo === "tecido" ? (oc?.ocs_tecido_itens ?? []) : (oc?.ocs_aviamento_itens ?? []);
  const fmtD = (d: string | null) => (d ? format(parseISO(d), "dd/MM/yyyy") : "—");

  return (
    <Dialog open={!!view} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            OC {view?.tipo === "tecido" ? "de Tecido" : "de Aviamento"} {oc?.numero_pedido ? `· Nº ${oc.numero_pedido}` : ""}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && oc && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Fornecedor:</span> <b>{oc.empresas?.nome_fantasia ?? "—"}</b></div>
              <div><span className="text-muted-foreground">Status:</span> {oc.status ?? "—"}</div>
              <div><span className="text-muted-foreground">Data do Pedido:</span> {fmtD(oc.data_pedido)}</div>
              <div><span className="text-muted-foreground">Prevista:</span> {fmtD(oc.data_prevista_entrega)}</div>
              <div><span className="text-muted-foreground">Entrega:</span> {fmtD(oc.data_entrega)}</div>
              <div><span className="text-muted-foreground">Prazo de Pagamento:</span> {oc.prazo_pagamento ?? "—"}</div>
            </div>
            <div className="border-t pt-2">
              <p className="font-medium mb-1">Itens</p>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-2">Item</th>
                      <th className="py-1 pr-2 text-right">Pedida</th>
                      <th className="py-1 pr-2 text-right">Recebida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.length === 0 && (
                      <tr><td colSpan={3} className="py-2 text-muted-foreground">Sem itens.</td></tr>
                    )}
                    {itens.map((it, i) => {
                      const nome = view?.tipo === "tecido"
                        ? `${it.artigos?.nome ?? "—"}${it.variantes_tecido?.cor?.nome ? ` · ${it.variantes_tecido.cor.nome}` : it.variantes_tecido?.nome_variante ? ` · ${it.variantes_tecido.nome_variante}` : ""}`
                        : (it.aviamentos?.codigo_nome ?? "—");
                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 pr-2">{nome}</td>
                          <td className="py-1 pr-2 text-right">{Number(it.quantidade_pedida ?? 0)}</td>
                          <td className="py-1 pr-2 text-right">{Number(it.quantidade_recebida ?? 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {!isLoading && !oc && <p className="text-sm text-muted-foreground">OC não encontrada.</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

type StatusSel = "a_pagar" | "pago" | "vencido";

function ResumoView({ parcelas }: { parcelas: Parcela[] }) {
  const [fFornecedor, setFFornecedor] = useState("all");
  const [fMes, setFMes] = useState("");   // yyyy-MM
  const [fDe, setFDe] = useState("");
  const [fAte, setFAte] = useState("");
  const [selected, setSelected] = useState<StatusSel | null>(null);

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of parcelas) if (p.empresa_id) m.set(p.empresa_id, p.empresas?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [parcelas]);

  // Conjunto-base após os filtros (fornecedor, mês, intervalo de datas).
  const base = useMemo(() => parcelas.filter((p) => {
    if (fFornecedor !== "all" && p.empresa_id !== fFornecedor) return false;
    if (fMes && p.data_vencimento.slice(0, 7) !== fMes) return false;
    if (fDe && p.data_vencimento < fDe) return false;
    if (fAte && p.data_vencimento > fAte) return false;
    return true;
  }), [parcelas, fFornecedor, fMes, fDe, fAte]);

  const sumBy = (st: StatusSel) => base.filter((p) => effectiveStatus(p) === st).reduce((s, p) => s + Number(p.valor), 0);
  const totalAPagar = sumBy("a_pagar");
  const totalPago = sumBy("pago");
  const totalVencido = sumBy("vencido");

  const chartData = useMemo(() => {
    const m = new Map<string, { mes: string; ord: string; pago: number; a_pagar: number; vencido: number }>();
    for (const p of base) {
      const k = p.data_vencimento.slice(0, 7);
      let row = m.get(k);
      if (!row) {
        row = { mes: format(parseLocalDate(p.data_vencimento), "MMM/yy", { locale: ptBR }), ord: k, pago: 0, a_pagar: 0, vencido: 0 };
        m.set(k, row);
      }
      row[effectiveStatus(p)] += Number(p.valor);
    }
    return Array.from(m.values()).sort((a, b) => a.ord.localeCompare(b.ord));
  }, [base]);

  const activeCount = (fFornecedor !== "all" ? 1 : 0) + (fMes ? 1 : 0) + (fDe ? 1 : 0) + (fAte ? 1 : 0);
  const clearFilters = () => { setFFornecedor("all"); setFMes(""); setFDe(""); setFAte(""); };
  const toggle = (s: StatusSel) => setSelected((cur) => (cur === s ? null : s));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <FilterButton activeCount={activeCount} onClear={clearFilters}>
          <div className="grid gap-1">
            <Label className="text-xs">Fornecedor</Label>
            <Select value={fFornecedor} onValueChange={setFFornecedor}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Mês</Label>
            <Input type="month" className="h-8 text-sm" value={fMes} onChange={(e) => setFMes(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">De</Label>
            <Input type="date" className="h-8 text-sm" value={fDe} onChange={(e) => setFDe(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" className="h-8 text-sm" value={fAte} onChange={(e) => setFAte(e.target.value)} />
          </div>
        </FilterButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard title="Total a pagar" value={brl(totalAPagar)} accent="text-yellow-600 dark:text-yellow-400"
          active={selected === "a_pagar"} onClick={() => toggle("a_pagar")} />
        <SummaryCard title="Total pago" value={brl(totalPago)} accent="text-green-600 dark:text-green-400"
          active={selected === "pago"} onClick={() => toggle("pago")} />
        <SummaryCard title="Total vencido" value={brl(totalVencido)} accent="text-destructive"
          active={selected === "vencido"} onClick={() => toggle("vencido")} />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Evolução mensal</h3>
          {selected && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelected(null)}>
              Mostrar todos
            </button>
          )}
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => v.toLocaleString("pt-BR")} />
              <Tooltip formatter={(v: any) => brl(Number(v))} />
              <Legend />
              {(!selected || selected === "pago") && <Bar dataKey="pago" name="Pago" fill="hsl(142 71% 45%)" />}
              {(!selected || selected === "a_pagar") && <Bar dataKey="a_pagar" name="A pagar" fill="hsl(45 93% 47%)" />}
              {(!selected || selected === "vencido") && <Bar dataKey="vencido" name="Vencido" fill="hsl(0 72% 51%)" />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({ title, value, accent, active, onClick }: { title: string; value: string; accent: string; active?: boolean; onClick?: () => void }) {
  return (
    <Card
      className={cn("p-5", onClick && "cursor-pointer transition-shadow hover:shadow-md", active && "ring-2 ring-primary")}
      onClick={onClick}
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className={cn("text-2xl font-bold mt-1", accent)}>{value}</p>
    </Card>
  );
}

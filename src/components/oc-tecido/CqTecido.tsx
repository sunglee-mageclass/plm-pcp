import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Ban, RotateCcw, Repeat } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type CqStatus = "sem_alerta" | "alertado" | "troca_pendente" | "trocado" | "estilo_ok" | "cancelado" | "devolucao";

type CqItem = {
  id: string;
  oc_id: string | null;
  oc_numero: string | null;
  artigo: string;
  variante: string;
  cq_observacao: string | null;
  cq_ok: boolean;
  cq_alerta_status: CqStatus;
};

const PENDENTES: CqStatus[] = ["alertado", "troca_pendente"];
const RESOLVIDOS: CqStatus[] = ["estilo_ok", "trocado", "cancelado", "devolucao"];

const STATUS_BADGE: Record<CqStatus, { label: string; cls: string } | null> = {
  sem_alerta: null,
  alertado: { label: "Alerta estilo", cls: "bg-amber-500 hover:bg-amber-500" },
  troca_pendente: { label: "Troca pendente", cls: "bg-orange-500 hover:bg-orange-500" },
  trocado: { label: "Trocado", cls: "bg-blue-500 hover:bg-blue-500" },
  estilo_ok: { label: "Estilo OK", cls: "bg-emerald-500 hover:bg-emerald-500" },
  cancelado: { label: "Cancelado", cls: "bg-zinc-500 hover:bg-zinc-500" },
  devolucao: { label: "Devolução", cls: "bg-red-500 hover:bg-red-500" },
};

const SELECT_COLS =
  "id, cancelado, variante_tecido_id, cq_observacao, cq_ok, cq_alerta_status, artigos(nome), variantes_tecido(nome_variante, codigo_variante)";

const vName = (v?: { nome_variante: string | null; codigo_variante: string | null } | null) =>
  v ? v.nome_variante || v.codigo_variante || "—" : "—";

const toCqItem = (it: any, ocId: string | null, ocNumero: string | null): CqItem => ({
  id: it.id,
  oc_id: ocId,
  oc_numero: ocNumero,
  artigo: it.artigos?.nome ?? "—",
  variante: vName(it.variantes_tecido),
  cq_observacao: it.cq_observacao,
  cq_ok: !!it.cq_ok,
  cq_alerta_status: (it.cq_alerta_status ?? "sem_alerta") as CqStatus,
});

function useFlatCqItems() {
  const { data: ocs = [], isLoading } = useQuery({
    queryKey: ["cq-tecido"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido")
        .select(`id, numero_pedido, ocs_tecido_itens!oc_tecido_id(${SELECT_COLS})`)
        .eq("status", "recebido")
        .eq("is_rolo", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const items = useMemo<CqItem[]>(() => {
    const out: CqItem[] = [];
    for (const oc of ocs) {
      for (const it of oc.ocs_tecido_itens ?? []) {
        if (it.cancelado && it.cq_alerta_status === "sem_alerta") continue; // cancelado de pedido (não-CQ)
        out.push(toCqItem(it, oc.id, oc.numero_pedido));
      }
    }
    return out;
  }, [ocs]);
  return { items, isLoading };
}

function useCqUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any> }) => {
      const { error } = await supabase.from("ocs_tecido_itens").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      ["cq-tecido", "cq-oc", "alertas-tecido", "estoque-tecidos", "dash-estoque", "consumo-por-oc", "ocs_tecido"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar CQ"),
  });
}

// Resolução de alerta via RPC (recalcula valor + parcelas).
function useResolucao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      item_id: string; acao: "cancelar" | "estilo_ok" | "reabrir" | "troca";
      rep_artigo_id?: string; rep_variante_id?: string; rep_metragem?: number;
    }) => {
      const { error } = await supabase.rpc("aplicar_resolucao_alerta_tecido" as any, {
        _item_id: args.item_id, _acao: args.acao,
        _rep_artigo_id: args.rep_artigo_id ?? null,
        _rep_variante_id: args.rep_variante_id ?? null,
        _rep_metragem: args.rep_metragem ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ["cq-tecido", "cq-oc", "alertas-tecido", "estoque-tecidos", "dash-estoque",
        "consumo-por-oc", "ocs_tecido", "parcelas", "dash-financeiro"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao aplicar resolução"),
  });
}

// ───────────────────────── CQ de Tecido (dentro da OC) ─────────────────────────
function CqItemCard({ item, showOc = true }: { item: CqItem; showOc?: boolean }) {
  const update = useCqUpdate();
  const [obs, setObs] = useState(item.cq_observacao ?? "");
  const badge = STATUS_BADGE[item.cq_alerta_status];
  const alertado = item.cq_alerta_status !== "sem_alerta";

  const saveObs = () => {
    if ((obs || "") !== (item.cq_observacao ?? "")) {
      update.mutate({ id: item.id, patch: { cq_observacao: obs || null } });
    }
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span className="font-medium">{item.artigo}</span>
          <span className="text-muted-foreground"> · {item.variante}</span>
        </div>
        <div className="flex items-center gap-2">
          {badge && <Badge className={badge.cls}>{badge.label}</Badge>}
          {showOc && <Badge variant="outline">OC {item.oc_numero ?? "—"}</Badge>}
        </div>
      </div>

      <Textarea
        value={obs}
        onChange={(e) => setObs(e.target.value)}
        onBlur={saveObs}
        placeholder="Observação do CQ (defeitos, encolhimento, tonalidade…)"
        className="min-h-[60px] text-sm"
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Switch checked={item.cq_ok} onCheckedChange={(v) => update.mutate({ id: item.id, patch: { cq_ok: v } })} />
          CQ ok
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Switch
            checked={alertado}
            onCheckedChange={(v) => update.mutate({ id: item.id, patch: { cq_alerta_status: v ? "alertado" : "sem_alerta" } })}
          />
          Alertar estilo
        </label>
        {alertado && (
          <span className="text-xs text-muted-foreground">Resolução (Estilo OK / troca / devolução / cancelar) na página Alertas.</span>
        )}
      </div>
    </Card>
  );
}

// Seção de CQ dentro da OC (Encomendado/Recebido).
export function OcCqSection({ ocId }: { ocId: string }) {
  const { data: items = [] } = useQuery({
    queryKey: ["cq-oc", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido_itens")
        .select(SELECT_COLS)
        .eq("oc_tecido_id", ocId);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((it) => !(it.cancelado && it.cq_alerta_status === "sem_alerta") && it.variante_tecido_id)
        .map((it) => toCqItem(it, ocId, null));
    },
  });

  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">CQ de Tecido</h3>
      {items.map((it) => (
        <CqItemCard key={it.id} item={it} showOc={false} />
      ))}
    </div>
  );
}

// ───────────────────────── Alertas (página do estilo) ─────────────────────────
export function AlertasList() {
  const { items, isLoading } = useFlatCqItems();
  const update = useCqUpdate();   // observação
  const resol = useResolucao();   // ações (recalculam valor + parcelas)
  const [aba, setAba] = useState<"pendentes" | "resolvidos">("pendentes");
  const [confirmCancel, setConfirmCancel] = useState<CqItem | null>(null);
  const [troca, setTroca] = useState<CqItem | null>(null);

  const lista = items.filter((i) =>
    aba === "pendentes" ? PENDENTES.includes(i.cq_alerta_status) : RESOLVIDOS.includes(i.cq_alerta_status),
  );

  if (isLoading) return <p className="text-sm text-muted-foreground py-12 text-center">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex rounded-md border p-0.5 w-fit">
        <Button size="sm" variant={aba === "pendentes" ? "secondary" : "ghost"} onClick={() => setAba("pendentes")}>Pendentes</Button>
        <Button size="sm" variant={aba === "resolvidos" ? "secondary" : "ghost"} onClick={() => setAba("resolvidos")}>Resolvidos</Button>
      </div>

      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {aba === "pendentes" ? "Nenhum alerta de estilo pendente." : "Nenhum alerta resolvido."}
        </p>
      ) : (
        lista.map((it) => {
          const badge = STATUS_BADGE[it.cq_alerta_status];
          const resolvido = RESOLVIDOS.includes(it.cq_alerta_status);
          return (
            <Card key={it.id} className="p-3 border-amber-500/40 bg-amber-500/5 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{it.artigo}</span>
                    <span className="text-muted-foreground">· {it.variante}</span>
                    <Badge variant="outline">OC {it.oc_numero ?? "—"}</Badge>
                    {badge && <Badge className={badge.cls}>{badge.label}</Badge>}
                  </div>
                  <ObsField item={it} update={update} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-6">
                {resolvido ? (
                  <Button size="sm" variant="outline" onClick={() => resol.mutate({ item_id: it.id, acao: "reabrir" })}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Reabrir
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => resol.mutate({ item_id: it.id, acao: "estilo_ok" })}>
                      <Check className="h-4 w-4 mr-1" /> Estilo OK
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTroca(it)}>
                      <Repeat className="h-4 w-4 mr-1" /> Troca
                    </Button>
                    <Button size="sm" variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      onClick={() => setConfirmCancel(it)}>
                      <Ban className="h-4 w-4 mr-1" /> Cancelar variante
                    </Button>
                  </>
                )}
              </div>
            </Card>
          );
        })
      )}

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta variante?</AlertDialogTitle>
            <AlertDialogDescription>
              A variante "{confirmCancel?.variante}" da OC {confirmCancel?.oc_numero ?? "—"} sai do estoque,
              consumo e prévia, e o valor/parcelas da OC são recalculados. Pode ser revertida em Resolvidos
              (Reabrir).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmCancel) resol.mutate({ item_id: confirmCancel.id, acao: "cancelar" }); setConfirmCancel(null); }}>
              Cancelar variante
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {troca && <TrocaDialog original={troca} resol={resol} onClose={() => setTroca(null)} />}
    </div>
  );
}

// ───────────────────────── Troca: seleciona o tecido/variante substituto ─────────────────────────
function TrocaDialog({ original, resol, onClose }: { original: CqItem; resol: ReturnType<typeof useResolucao>; onClose: () => void }) {
  const [artigoId, setArtigoId] = useState("");
  const [varId, setVarId] = useState("");
  const [metragem, setMetragem] = useState("");

  const { data: artigos = [] } = useQuery({
    queryKey: ["troca-artigos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("artigos").select("id, nome, unidade_medida").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; unidade_medida: string | null }[];
    },
  });
  const { data: variantes = [] } = useQuery({
    queryKey: ["troca-variantes", artigoId],
    enabled: !!artigoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido").select("id, nome_variante, codigo_variante").eq("artigo_id", artigoId);
      if (error) throw error;
      return (data ?? []) as { id: string; nome_variante: string | null; codigo_variante: string | null }[];
    },
  });

  const confirmar = () => {
    if (!artigoId || !varId) { toast.error("Selecione o tecido e a variante substitutos."); return; }
    const m = Number(metragem);
    if (!(m > 0)) { toast.error("Informe a metragem esperada."); return; }
    resol.mutate(
      { item_id: original.id, acao: "troca", rep_artigo_id: artigoId, rep_variante_id: varId, rep_metragem: m },
      { onSuccess: () => { toast.success("Troca registrada — substituto a receber"); onClose(); } },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Trocar variante</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Substituindo <b>{original.artigo} · {original.variante}</b> (OC {original.oc_numero ?? "—"}). O original
            sai do estoque/consumo e o substituto entra como <b>a receber</b>.
          </p>
          <div className="space-y-1.5">
            <Label>Tecido substituto</Label>
            <Select value={artigoId} onValueChange={(v) => { setArtigoId(v); setVarId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione o tecido" /></SelectTrigger>
              <SelectContent>
                {artigos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {artigoId && (
            <div className="space-y-1.5">
              <Label>Variante</Label>
              <Select value={varId} onValueChange={setVarId}>
                <SelectTrigger><SelectValue placeholder="Selecione a variante" /></SelectTrigger>
                <SelectContent>
                  {variantes.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.nome_variante || v.codigo_variante || "—"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Metragem esperada (m)</Label>
            <Input type="number" value={metragem} onChange={(e) => setMetragem(e.target.value)} placeholder="metros" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={resol.isPending}>Confirmar troca</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Observação editável (compartilhada com o CQ da OC).
function ObsField({ item, update }: { item: CqItem; update: ReturnType<typeof useCqUpdate> }) {
  const [obs, setObs] = useState(item.cq_observacao ?? "");
  return (
    <Textarea
      value={obs}
      onChange={(e) => setObs(e.target.value)}
      onBlur={() => { if ((obs || "") !== (item.cq_observacao ?? "")) update.mutate({ id: item.id, patch: { cq_observacao: obs || null } }); }}
      placeholder="Observação (compartilhada com o CQ da OC)…"
      className="min-h-[48px] text-sm mt-1"
    />
  );
}

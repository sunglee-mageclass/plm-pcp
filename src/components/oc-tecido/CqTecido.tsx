import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { AlertTriangle, Check, Ban, RotateCcw, Repeat } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
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
  is_rolo?: boolean; // alerta vindo de um rolo: oc_numero = rolo_codigo
  usado?: boolean;   // rolo já consumido (corte) OU selecionado em Desenvolvimento → não troca/cancela
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
// Para rolos, também trazemos consumo (baixa) e vínculo de Dev p/ saber se está "em uso".
const ROLO_SELECT_COLS = `${SELECT_COLS}, estoque_tecido_baixas(id), modelo_tecido_oc_links(id)`;

// Badge-resumo do alerta de uma OC (prioridade: pendente > troca > trocado > cancelado > ok).
export function alertaBadge(statuses: string[]): { label: string; cls: string } | null {
  if (statuses.includes("alertado")) return { label: "Alerta", cls: "bg-amber-500 hover:bg-amber-500" };
  if (statuses.includes("troca_pendente")) return { label: "Troca", cls: "bg-orange-500 hover:bg-orange-500" };
  if (statuses.includes("trocado")) return { label: "Trocado", cls: "bg-blue-600 hover:bg-blue-600" };
  if (statuses.some((s) => s === "cancelado" || s === "devolucao")) return { label: "Cancelado", cls: "bg-zinc-500 hover:bg-zinc-500" };
  if (statuses.includes("estilo_ok")) return { label: "Estilo OK", cls: "bg-emerald-500 hover:bg-emerald-500" };
  return null;
}

const vName = (v?: { nome_variante: string | null; codigo_variante: string | null } | null) =>
  v ? v.nome_variante || v.codigo_variante || "—" : "—";

const toCqItem = (it: any, ocId: string | null, ocNumero: string | null, isRolo = false): CqItem => ({
  id: it.id,
  oc_id: ocId,
  oc_numero: ocNumero,
  artigo: it.artigos?.nome ?? "—",
  variante: vName(it.variantes_tecido),
  cq_observacao: it.cq_observacao,
  cq_ok: !!it.cq_ok,
  cq_alerta_status: (it.cq_alerta_status ?? "sem_alerta") as CqStatus,
  is_rolo: isRolo,
});

function useFlatCqItems() {
  const { data, isLoading } = useQuery({
    queryKey: ["cq-tecido"],
    queryFn: async () => {
      const [ocsRes, rolosRes] = await Promise.all([
        supabase
          .from("ocs_tecido")
          .select(`id, numero_pedido, ocs_tecido_itens!oc_tecido_id(${SELECT_COLS})`)
          .eq("status", "recebido")
          .eq("is_rolo" as never, false as never)
          .order("created_at", { ascending: false }),
        // Rolos: o item do rolo carrega o CQ do rolo (oc_numero = rolo_codigo).
        supabase
          .from("ocs_tecido")
          .select(`id, rolo_codigo, ocs_tecido_itens!oc_tecido_id(${ROLO_SELECT_COLS})`)
          .eq("is_rolo" as never, true as never)
          .order("created_at", { ascending: false }),
      ]);
      if (ocsRes.error) throw ocsRes.error;
      if (rolosRes.error) throw rolosRes.error;
      return { ocs: (ocsRes.data ?? []) as any[], rolos: (rolosRes.data ?? []) as any[] };
    },
  });
  const items = useMemo<CqItem[]>(() => {
    const out: CqItem[] = [];
    for (const oc of data?.ocs ?? []) {
      for (const it of oc.ocs_tecido_itens ?? []) {
        if (it.cancelado && it.cq_alerta_status === "sem_alerta") continue; // cancelado de pedido (não-CQ)
        out.push(toCqItem(it, oc.id, oc.numero_pedido, false));
      }
    }
    for (const r of data?.rolos ?? []) {
      for (const it of r.ocs_tecido_itens ?? []) {
        if (it.cancelado && it.cq_alerta_status === "sem_alerta") continue;
        const usado =
          (it.estoque_tecido_baixas ?? []).length > 0 ||
          (it.modelo_tecido_oc_links ?? []).length > 0;
        out.push({ ...toCqItem(it, r.id, r.rolo_codigo, true), usado });
      }
    }
    return out;
  }, [data]);
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar CQ")),
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao aplicar resolução")),
  });
}

// Receber a reposição de uma troca (marca recebido + data, vira 'trocado').
function useReceberReposicao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { item_id: string; data: string; metragem: number }) => {
      const { error } = await supabase.rpc("receber_reposicao_troca" as any, {
        _original_item_id: args.item_id, _data: args.data, _metragem: args.metragem,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ["cq-tecido", "cq-oc", "alertas-tecido", "estoque-tecidos", "dash-estoque",
        "consumo-por-oc", "ocs_tecido", "parcelas", "dash-financeiro"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao receber reposição")),
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
  const qc = useQueryClient();
  const { items, isLoading } = useFlatCqItems();
  const update = useCqUpdate();   // observação
  const resol = useResolucao();   // ações (recalculam valor + parcelas) — só p/ OC
  const reposicao = useReceberReposicao();
  // Resolução de ROLO: update direto do status, SEM recalcular valor/parcelas (rolo
  // não tem financeiro — usar a RPC criaria parcelas espúrias).
  const resolRolo = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "estilo_ok" | "alertado" }) => {
      const { error } = await supabase
        .from("ocs_tecido_itens")
        .update({ cq_alerta_status: status, cancelado: false } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq-tecido"] }),
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao resolver alerta do rolo")),
  });
  // Troca/cancela de rolo afeta estoque, consumo, listas de OC/rolo e os alertas —
  // invalida tudo para os valores atualizarem em todas as telas.
  const invalidarRolo = () => qc.invalidateQueries();
  // Cancelar SÓ aquele rolo: marca o item do rolo como cancelado (sai do estoque),
  // sem recalcular financeiro (rolo não tem parcela).
  const cancelRoloMut = useMutation({
    mutationFn: async (roloId: string) => {
      const { error } = await supabase.rpc("cancelar_rolo" as any, { _rolo_id: roloId });
      if (error) throw error;
    },
    onSuccess: () => { invalidarRolo(); toast.success("Rolo cancelado."); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao cancelar rolo")),
  });
  const reabrirRoloMut = useMutation({
    mutationFn: async (roloId: string) => {
      const { error } = await supabase.rpc("reabrir_rolo" as any, { _rolo_id: roloId });
      if (error) throw error;
    },
    onSuccess: () => invalidarRolo(),
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao reabrir rolo")),
  });
  // Trocar o rolo defeituoso: reverte a separação, marca 'trocado' e gera a reposição.
  const trocaRoloMut = useMutation({
    mutationFn: async ({ rolo_id, metragem }: { rolo_id: string; metragem: number | null }) => {
      const { error } = await supabase.rpc("trocar_rolo" as any, { _rolo_id: rolo_id, _nova_metragem: metragem });
      if (error) throw error;
    },
    onSuccess: () => { invalidarRolo(); toast.success("Rolo trocado — reposição gerada."); setTrocaRolo(null); setTrocaMetragem(""); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao trocar rolo")),
  });
  const [aba, setAba] = useState<"pendentes" | "resolvidos">("pendentes");
  const [confirmCancel, setConfirmCancel] = useState<CqItem | null>(null);
  const [troca, setTroca] = useState<CqItem | null>(null);
  const [receber, setReceber] = useState<CqItem | null>(null);
  const [trocaRolo, setTrocaRolo] = useState<CqItem | null>(null);
  const [trocaMetragem, setTrocaMetragem] = useState("");

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
                    <Badge variant="outline">{it.is_rolo ? "Rolo" : "OC"} {it.oc_numero ?? "—"}</Badge>
                    {badge && <Badge className={badge.cls}>{badge.label}</Badge>}
                  </div>
                  <ObsField item={it} update={update} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-6">
                {resolvido ? (
                  <Button size="sm" variant="outline" onClick={() => it.is_rolo ? reabrirRoloMut.mutate(it.oc_id!) : resol.mutate({ item_id: it.id, acao: "reabrir" })}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Reabrir
                  </Button>
                ) : it.cq_alerta_status === "troca_pendente" ? (
                  <>
                    <Button size="sm" onClick={() => setReceber(it)}>
                      <Check className="h-4 w-4 mr-1" /> Receber reposição
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resol.mutate({ item_id: it.id, acao: "reabrir" })}>
                      <RotateCcw className="h-4 w-4 mr-1" /> Desfazer troca
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => it.is_rolo ? resolRolo.mutate({ id: it.id, status: "estilo_ok" }) : resol.mutate({ item_id: it.id, acao: "estilo_ok" })}>
                      <Check className="h-4 w-4 mr-1" /> Estilo OK
                    </Button>
                    {/* Rolo: troca/cancelar próprios (sem financeiro). OC: fluxo normal.
                        Rolo já em uso (consumido ou selecionado no Dev) não troca/cancela. */}
                    <Button size="sm" variant="outline"
                      disabled={!!it.is_rolo && !!it.usado}
                      title={it.is_rolo && it.usado ? "Rolo em uso (consumido ou selecionado em Desenvolvimento) — não pode ser trocado." : undefined}
                      onClick={() => it.is_rolo ? setTrocaRolo(it) : setTroca(it)}>
                      <Repeat className="h-4 w-4 mr-1" /> Troca
                    </Button>
                    <Button size="sm" variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={!!it.is_rolo && !!it.usado}
                      title={it.is_rolo && it.usado ? "Rolo em uso (consumido ou selecionado em Desenvolvimento) — não pode ser cancelado." : undefined}
                      onClick={() => setConfirmCancel(it)}>
                      <Ban className="h-4 w-4 mr-1" /> {it.is_rolo ? "Cancelar rolo" : "Cancelar variante"}
                    </Button>
                    {it.is_rolo && it.usado && (
                      <span className="text-xs text-muted-foreground">Rolo em uso — bloqueado.</span>
                    )}
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
            <AlertDialogTitle>{confirmCancel?.is_rolo ? "Cancelar este rolo?" : "Cancelar esta variante?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCancel?.is_rolo
                ? <>O rolo <strong>{confirmCancel?.oc_numero ?? "—"}</strong> ({confirmCancel?.variante}) sai do estoque e do consumo. Pode ser revertido em Resolvidos (Reabrir).</>
                : <>A variante "{confirmCancel?.variante}" da OC {confirmCancel?.oc_numero ?? "—"} sai do estoque, consumo e prévia, e o valor/parcelas da OC são recalculados. Pode ser revertida em Resolvidos (Reabrir).</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmCancel) { confirmCancel.is_rolo ? cancelRoloMut.mutate(confirmCancel.oc_id!) : resol.mutate({ item_id: confirmCancel.id, acao: "cancelar" }); } setConfirmCancel(null); }}>
              {confirmCancel?.is_rolo ? "Cancelar rolo" : "Cancelar variante"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {troca && <TrocaDialog original={troca} resol={resol} onClose={() => setTroca(null)} />}
      {receber && <ReceberReposicaoDialog original={receber} reposicao={reposicao} onClose={() => setReceber(null)} />}

      {trocaRolo && (
        <Dialog open onOpenChange={(o) => { if (!o) { setTrocaRolo(null); setTrocaMetragem(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Trocar rolo {trocaRolo.oc_numero ?? ""}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                O rolo defeituoso é <b>substituído</b> (removido) e um rolo de reposição é gerado
                (novo código) com a metragem abaixo — pode ser <b>maior ou menor</b>. (Rolo não mexe
                em financeiro.)
              </p>
              <div className="space-y-1.5">
                <Label>Metragem da reposição (m)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={trocaMetragem}
                  onChange={(e) => setTrocaMetragem(e.target.value)}
                  placeholder="Vazio = mesma metragem do rolo trocado"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setTrocaRolo(null); setTrocaMetragem(""); }}>Cancelar</Button>
              <Button
                onClick={() => trocaRoloMut.mutate({
                  rolo_id: trocaRolo.oc_id!,
                  metragem: trocaMetragem.trim() ? Number(trocaMetragem.replace(",", ".")) : null,
                })}
                disabled={trocaRoloMut.isPending}
              >
                Trocar rolo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Receber a reposição da troca: data + metragem recebida → original vira 'trocado'.
function ReceberReposicaoDialog({ original, reposicao, onClose }: { original: CqItem; reposicao: ReturnType<typeof useReceberReposicao>; onClose: () => void }) {
  const [data, setData] = useState("");
  const [metragem, setMetragem] = useState("");
  const confirmar = () => {
    if (!data) { toast.error("Informe a data de recebimento."); return; }
    const m = Number(metragem);
    if (!(m > 0)) { toast.error("Informe a metragem recebida."); return; }
    reposicao.mutate(
      { item_id: original.id, data, metragem: m },
      { onSuccess: () => { toast.success("Reposição recebida — troca concluída"); onClose(); } },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Receber reposição</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Reposição da troca de <b>{original.artigo} · {original.variante}</b> (OC {original.oc_numero ?? "—"}).
            Ao confirmar, a troca fica concluída (badge "Trocado") e o valor/parcelas sobem de volta.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data recebida</Label>
              <DateField value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Metragem recebida (m)</Label>
              <Input type="number" value={metragem} onChange={(e) => setMetragem(e.target.value)} placeholder="metros" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={reposicao.isPending}>Confirmar recebimento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Ban } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type CqItem = {
  id: string;
  oc_numero: string | null;
  artigo: string;
  variante: string;
  cq_observacao: string | null;
  cq_ok: boolean;
  cq_alertar_estilo: boolean;
  cq_estilo_ok: boolean;
  cq_pendente_troca: boolean;
};

type OcEmbed = {
  numero_pedido: string | null;
  ocs_tecido_itens: {
    id: string;
    cancelado: boolean | null;
    cq_observacao: string | null;
    cq_ok: boolean | null;
    cq_alertar_estilo: boolean | null;
    cq_estilo_ok: boolean | null;
    cq_pendente_troca: boolean | null;
    artigos: { nome: string } | null;
    variantes_tecido: { nome_variante: string | null; codigo_variante: string | null } | null;
  }[];
};

const vName = (v?: { nome_variante: string | null; codigo_variante: string | null } | null) =>
  v ? v.nome_variante || v.codigo_variante || "—" : "—";

function useFlatCqItems() {
  const { data: ocs = [], ...rest } = useQuery({
    queryKey: ["cq-tecido"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido")
        .select(
          "id, numero_pedido, ocs_tecido_itens!oc_tecido_id(id, cancelado, cq_observacao, cq_ok, cq_alertar_estilo, cq_estilo_ok, cq_pendente_troca, artigos(nome), variantes_tecido(nome_variante, codigo_variante))",
        )
        .eq("status", "recebido")
        .eq("is_rolo", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OcEmbed[];
    },
  });

  const items = useMemo<CqItem[]>(() => {
    const out: CqItem[] = [];
    for (const oc of ocs) {
      for (const it of oc.ocs_tecido_itens ?? []) {
        if (it.cancelado) continue;
        out.push({
          id: it.id,
          oc_numero: oc.numero_pedido,
          artigo: it.artigos?.nome ?? "—",
          variante: vName(it.variantes_tecido),
          cq_observacao: it.cq_observacao,
          cq_ok: !!it.cq_ok,
          cq_alertar_estilo: !!it.cq_alertar_estilo,
          cq_estilo_ok: !!it.cq_estilo_ok,
          cq_pendente_troca: !!it.cq_pendente_troca,
        });
      }
    }
    return out;
  }, [ocs]);

  return { items, ...rest };
}

function useCqUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any> }) => {
      const { error } = await supabase.from("ocs_tecido_itens").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cq-tecido"] });
      qc.invalidateQueries({ queryKey: ["cq-oc"] });
      qc.invalidateQueries({ queryKey: ["alertas-tecido"] });
      // cancelar uma variante mexe em estoque/consumo/prévia
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar CQ"),
  });
}

// ───────────────────────── CQ de Tecido (conferência) ─────────────────────────
// estiloReadOnly: "Estilo ok" só é editável na página Alertas, não no CQ da OC.
function CqItemCard({ item, estiloReadOnly = false, showOc = true }: { item: CqItem; estiloReadOnly?: boolean; showOc?: boolean }) {
  const update = useCqUpdate();
  const [obs, setObs] = useState(item.cq_observacao ?? "");

  const setFlag = (patch: Partial<CqItem>) => update.mutate({ id: item.id, patch });
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
          {item.cq_alertar_estilo && !item.cq_estilo_ok && (
            <Badge className="bg-amber-500 hover:bg-amber-500">Alerta estilo</Badge>
          )}
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
          <Switch checked={item.cq_ok} onCheckedChange={(v) => setFlag({ cq_ok: v })} />
          CQ ok
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Switch checked={item.cq_alertar_estilo} onCheckedChange={(v) => setFlag({ cq_alertar_estilo: v })} />
          Alertar estilo
        </label>
        <label className={`flex items-center gap-2 text-sm ${estiloReadOnly ? "opacity-60" : "cursor-pointer"}`}>
          <Switch checked={item.cq_estilo_ok} disabled={estiloReadOnly} onCheckedChange={(v) => setFlag({ cq_estilo_ok: v })} />
          Estilo ok{estiloReadOnly && <span className="text-xs text-muted-foreground">(só em Alertas)</span>}
        </label>
      </div>
    </Card>
  );
}

// Seção de CQ dentro da OC (Encomendado/Recebido). "Estilo ok" read-only aqui.
export function OcCqSection({ ocId }: { ocId: string }) {
  const { data: items = [] } = useQuery({
    queryKey: ["cq-oc", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido_itens")
        .select("id, cancelado, variante_tecido_id, cq_observacao, cq_ok, cq_alertar_estilo, cq_estilo_ok, artigos(nome), variantes_tecido(nome_variante, codigo_variante)")
        .eq("oc_tecido_id", ocId);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((it) => !it.cancelado && it.variante_tecido_id)
        .map((it): CqItem => ({
          id: it.id,
          oc_numero: null,
          artigo: it.artigos?.nome ?? "—",
          variante: vName(it.variantes_tecido),
          cq_observacao: it.cq_observacao,
          cq_ok: !!it.cq_ok,
          cq_alertar_estilo: !!it.cq_alertar_estilo,
          cq_estilo_ok: !!it.cq_estilo_ok,
          cq_pendente_troca: !!it.cq_pendente_troca,
        }));
    },
  });

  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">CQ de Tecido</h3>
      {items.map((it) => (
        <CqItemCard key={it.id} item={it} estiloReadOnly showOc={false} />
      ))}
    </div>
  );
}

// ───────────────────────── Alertas (estilo) ─────────────────────────
export function AlertasList() {
  const { items, isLoading } = useFlatCqItems();
  const update = useCqUpdate();
  const [confirmCancel, setConfirmCancel] = useState<CqItem | null>(null);
  const alertas = items.filter((i) => i.cq_alertar_estilo && !i.cq_estilo_ok);

  if (isLoading) return <p className="text-sm text-muted-foreground py-12 text-center">Carregando…</p>;
  if (alertas.length === 0)
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        Nenhum alerta de estilo pendente.
      </p>
    );

  return (
    <div className="space-y-3">
      {alertas.map((it) => (
        <Card key={it.id} className="p-3 border-amber-500/50 bg-amber-500/5 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{it.artigo}</span>
                <span className="text-muted-foreground">· {it.variante}</span>
                <Badge variant="outline">OC {it.oc_numero ?? "—"}</Badge>
                {it.cq_pendente_troca && <Badge className="bg-orange-500 hover:bg-orange-500">Troca pendente</Badge>}
              </div>
              {it.cq_observacao && (
                <p className="text-sm text-muted-foreground mt-1">{it.cq_observacao}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch
                checked={it.cq_pendente_troca}
                onCheckedChange={(v) => update.mutate({ id: it.id, patch: { cq_pendente_troca: v } })}
              />
              Pendente para troca
            </label>
            <Button size="sm" variant="outline" onClick={() => update.mutate({ id: it.id, patch: { cq_estilo_ok: true } })}>
              <Check className="h-4 w-4 mr-1" /> Estilo OK
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setConfirmCancel(it)}
            >
              <Ban className="h-4 w-4 mr-1" /> Cancelar variante
            </Button>
          </div>
        </Card>
      ))}

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta variante?</AlertDialogTitle>
            <AlertDialogDescription>
              A variante "{confirmCancel?.variante}" da OC {confirmCancel?.oc_numero ?? "—"} será marcada
              como cancelada: deixa de contar no estoque, no consumo e na prévia, e influencia tudo que usa
              essa variante. (Pode ser revertida na OC.)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmCancel) update.mutate({ id: confirmCancel.id, patch: { cancelado: true } });
                setConfirmCancel(null);
              }}
            >
              Cancelar variante
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

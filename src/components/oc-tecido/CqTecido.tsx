import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type CqItem = {
  id: string;
  oc_numero: string | null;
  artigo: string;
  variante: string;
  cq_observacao: string | null;
  cq_ok: boolean;
  cq_alertar_estilo: boolean;
  cq_estilo_ok: boolean;
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
          "id, numero_pedido, ocs_tecido_itens!oc_tecido_id(id, cancelado, cq_observacao, cq_ok, cq_alertar_estilo, cq_estilo_ok, artigos(nome), variantes_tecido(nome_variante, codigo_variante))",
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
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CqItem> }) => {
      const { error } = await supabase.from("ocs_tecido_itens").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cq-tecido"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar CQ"),
  });
}

// ───────────────────────── CQ de Tecido (conferência) ─────────────────────────
function CqItemCard({ item }: { item: CqItem }) {
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
          <Badge variant="outline">OC {item.oc_numero ?? "—"}</Badge>
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
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Switch checked={item.cq_estilo_ok} onCheckedChange={(v) => setFlag({ cq_estilo_ok: v })} />
          Estilo ok
        </label>
      </div>
    </Card>
  );
}

export function CqTecidoList() {
  const { items, isLoading } = useFlatCqItems();
  if (isLoading) return <p className="text-sm text-muted-foreground py-12 text-center">Carregando…</p>;
  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        Nenhum tecido recebido para conferir.
      </p>
    );
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <CqItemCard key={it.id} item={it} />
      ))}
    </div>
  );
}

// ───────────────────────── Alertas (estilo) ─────────────────────────
export function AlertasList() {
  const { items, isLoading } = useFlatCqItems();
  const update = useCqUpdate();
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
        <Card key={it.id} className="p-3 border-amber-500/50 bg-amber-500/5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div>
                  <span className="font-medium">{it.artigo}</span>
                  <span className="text-muted-foreground"> · {it.variante}</span>
                  <Badge variant="outline" className="ml-2">OC {it.oc_numero ?? "—"}</Badge>
                </div>
                {it.cq_observacao && (
                  <p className="text-sm text-muted-foreground mt-1">{it.cq_observacao}</p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => update.mutate({ id: it.id, patch: { cq_estilo_ok: true } })}
            >
              <Check className="h-4 w-4 mr-1" /> Estilo OK
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

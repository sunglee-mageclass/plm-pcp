import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type OcItem = { artigo: { nome: string | null } | null; cancelado: boolean | null };
type OcRow = { id: string; numero_pedido: string | null; status: string | null; is_rolo: boolean | null; itens: OcItem[] | null };

/**
 * "Aplicar OC" (Fase C, atribuição): escolhe OCs reais cujo consumo é DESTACADO no Resumo
 * como "coberto por estas OCs". NÃO altera a "falta" (a OC já está no previsto do estoque).
 */
export function OcAplicadaPicker({ colecaoId }: { colecaoId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  // OCs de tecido da loja + ROLOS (estoque físico) p/ escolher — o rolo credita cobertura
  // pelo SEU SALDO (dono, ago/2026), no mesmo seletor, rotulado como "Rolo".
  const { data: ocs = [] } = useQuery({
    queryKey: ["plan-tecido-ocs-lista"],
    queryFn: async () =>
      ((await supabase
        .from("ocs_tecido")
        .select("id, numero_pedido, status, is_rolo, itens:ocs_tecido_itens(cancelado, artigo:artigo_id(nome))")
        .order("data_pedido", { ascending: false })).data ?? []) as unknown as OcRow[],
  });
  // tecidos (artigos) que cada OC contém — distinct, ignorando itens cancelados
  const tecidosDaOc = (oc: OcRow) =>
    [...new Set((oc.itens ?? []).filter((i) => !i.cancelado && i.artigo?.nome).map((i) => i.artigo!.nome as string))];

  // seleção já aplicada (persistida)
  const { data: aplicadas = [] } = useQuery({
    queryKey: ["plan-tecido-oc-aplicada", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_oc_aplicada" as any).select("oc_tecido_id").eq("colecao_id", colecaoId)).data ?? []) as unknown as { oc_tecido_id: string }[])
        .map((r) => r.oc_tecido_id),
  });

  // ao abrir, pré-marca as já aplicadas
  useEffect(() => {
    if (open) setSel(new Set(aplicadas));
  }, [open, aplicadas]);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("plan_tecido_set_oc_aplicada" as any, {
        _colecao_id: colecaoId,
        _oc_ids: [...sel],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OCs aplicadas atualizadas.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["plan-tecido-oc-aplicada", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-oc-aplicada-lista", colecaoId] }); // pool do SlotOcHint — senão a OC recém-aplicada não aparece no card
      qc.invalidateQueries({ queryKey: ["plan-tecido-situacao-ocs", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] }); // cobertura mudou → "a comprar" muda
      qc.invalidateQueries({ queryKey: ["plan-tecido-cobertura", colecaoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar.")),
  });

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const statusLabel = (s: string | null) => (s === "recebido" ? "recebido" : s === "encomendado" ? "encomendado" : (s ?? "—"));

  return (
    <>
      <div className="flex items-center justify-between px-2 pt-1">
        <span className="text-[10px] text-muted-foreground">
          {aplicadas.length > 0 ? `${aplicadas.length} vínculo(s)` : "Nenhum vínculo"}
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] text-primary" onClick={() => setOpen(true)}>
          <Plus className="h-3 w-3" /> vincular OC / rolo
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!salvar.isPending) setOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aplicar OC / Rolo ao plano</DialogTitle>
            <DialogDescription>
              Escolha OCs de tecido ou <b>Rolos</b> (estoque físico). O Resumo destaca quanto cada um
              cobre por variante. Um <b>rolo</b> abate o "a comprar" pelo seu <b>saldo</b> (metragem
              não separada); a OC é informativa (já está no estoque previsto).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto rounded border">
            {ocs.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">Nenhuma OC ou rolo cadastrado.</div>
            ) : (
              ocs.map((oc) => (
                <label key={oc.id} className="flex cursor-pointer items-start gap-2 border-b px-3 py-2 text-xs last:border-b-0">
                  <Checkbox checked={sel.has(oc.id)} onCheckedChange={() => toggle(oc.id)} className="mt-0.5 h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {oc.is_rolo && (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">Rolo</span>
                      )}
                      <span className="flex-1 truncate">{oc.numero_pedido || (oc.is_rolo ? "Rolo s/ nº" : "OC s/ nº")}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{oc.is_rolo ? "estoque" : statusLabel(oc.status)}</span>
                    </span>
                    {tecidosDaOc(oc).length > 0 && (
                      <span className="block truncate text-[10px] text-muted-foreground" title={tecidosDaOc(oc).join(", ")}>
                        {tecidosDaOc(oc).join(" · ")}
                      </span>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={salvar.isPending} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

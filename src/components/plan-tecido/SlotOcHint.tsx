import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";

type OcLite = { id: string; numero_pedido: string | null };

/**
 * Hint de planejamento: quais OCs (das aplicadas na coleção) este card vai usar.
 * Chaveado por SLOT (funciona em qualquer card editável salvo, avançado ou não).
 * NÃO congela custo nem toca modelo_tecido_oc_links — é só orientação no plano.
 */
export function SlotOcHint({
  colecaoId,
  slotId,
  ocsAplicadas,
  selected,
}: {
  colecaoId: string;
  slotId?: string;
  ocsAplicadas: OcLite[];
  selected: string[];
}) {
  const qc = useQueryClient();
  const salvar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc("plan_tecido_set_slot_oc" as any, {
        _colecao_id: colecaoId,
        _slot_id: slotId,
        _oc_ids: ids,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan-tecido-slot-oc", colecaoId] }),
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a OC do card.")),
  });

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    salvar.mutate(next);
  };

  return (
    <div>
      <div className="mb-1 text-[10px] text-muted-foreground">OC (planejamento) — não congela custo</div>
      {!slotId ? (
        <div className="text-[10px] text-muted-foreground">Salve o plano para atribuir OC a este card.</div>
      ) : ocsAplicadas.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">Aplique OCs em "Insumos da coleção" para poder atribuir aqui.</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {ocsAplicadas.map((oc) => {
            const on = selected.includes(oc.id);
            return (
              <button
                key={oc.id}
                type="button"
                disabled={salvar.isPending}
                onClick={() => toggle(oc.id)}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
              >
                {oc.numero_pedido || oc.id.slice(0, 8)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

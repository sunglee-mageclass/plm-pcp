import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";

type OcLite = { id: string; numero_pedido: string | null };

/**
 * Hint de planejamento: quais OCs (das aplicadas na coleção) este modelo vai usar.
 * NÃO congela custo nem toca modelo_tecido_oc_links — é só orientação no plano.
 */
export function ModeloOcHint({
  colecaoId,
  modeloId,
  ocsAplicadas,
  selected,
}: {
  colecaoId: string;
  modeloId: string;
  ocsAplicadas: OcLite[];
  selected: string[];
}) {
  const qc = useQueryClient();
  const salvar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc("plan_tecido_set_modelo_oc" as any, {
        _colecao_id: colecaoId,
        _modelo_id: modeloId,
        _oc_ids: ids,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan-tecido-modelo-oc", colecaoId] }),
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a OC do modelo.")),
  });

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    salvar.mutate(next);
  };

  if (ocsAplicadas.length === 0)
    return <div className="text-[10px] text-muted-foreground">Aplique OCs em "Insumos da coleção" para poder atribuir aqui.</div>;

  return (
    <div>
      <div className="mb-1 text-[10px] text-muted-foreground">OC (planejamento) — não congela custo</div>
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
    </div>
  );
}

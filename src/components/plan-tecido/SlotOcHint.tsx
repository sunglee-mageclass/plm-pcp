import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { X } from "lucide-react";

type OcLite = { id: string; numero_pedido: string | null; tecidos: string[]; categorias?: string[]; artigos?: string[] };

/**
 * OC (planejamento) por card, chaveado por SLOT: dropdown p/ escolher a(s) OC(s) — mostra o nº da OC
 * e os tecidos que ela contém — + chips das escolhidas. NÃO congela custo (só orientação no plano).
 */
export function SlotOcHint({
  colecaoId,
  slotId,
  ocsAplicadas,
  selected,
  categoriaLane,
  slotArtigos = [],
  onEnsureSaved,
}: {
  colecaoId: string;
  slotId?: string;
  ocsAplicadas: OcLite[];
  selected: string[];
  categoriaLane?: string | null;
  /** artigo_id(s) dos tecidos ESCOLHIDOS neste card — filtro primário (mais preciso que a categoria). */
  slotArtigos?: string[];
  onEnsureSaved?: () => Promise<boolean>;
}) {
  const qc = useQueryClient();
  const salvar = useMutation({
    mutationFn: async (ids: string[]) => {
      // garante o plano salvo (o slot precisa existir no banco pro FK; o id é preservado no save)
      if (onEnsureSaved && !(await onEnsureSaved())) return;
      const { error } = await supabase.rpc("plan_tecido_set_slot_oc" as any, { _colecao_id: colecaoId, _slot_id: slotId, _oc_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan-tecido-slot-oc", colecaoId] }),
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a OC do card.")),
  });

  const label = (oc: OcLite) => `${oc.numero_pedido || oc.id.slice(0, 8)}${oc.tecidos.length ? " — " + oc.tecidos.join(" · ") : ""}`;
  const byId = (id: string) => ocsAplicadas.find((o) => o.id === id);
  const add = (id: string) => { if (id && !selected.includes(id)) salvar.mutate([...selected, id]); };
  const remove = (id: string) => salvar.mutate(selected.filter((x) => x !== id));

  // Filtro em CASCATA (do mais preciso ao mais amplo), nunca um gate que trave a adição:
  //  1) OCs que contêm o TECIDO escolhido no card (artigo real) — o mais específico;
  //  2) senão, OCs da CATEGORIA de tecido da lane do card;
  //  3) senão (nada casa), todas as não-escolhidas (senão o dropdown travaria em "todas já escolhidas").
  const naCategoria = (o: OcLite) => !categoriaLane || !o.categorias || o.categorias.length === 0 || o.categorias.includes(categoriaLane);
  const doArtigo = (o: OcLite) => slotArtigos.length > 0 && !!o.artigos && o.artigos.some((a) => slotArtigos.includes(a));
  const naoEscolhidas = ocsAplicadas.filter((o) => !selected.includes(o.id));
  const porArtigo = naoEscolhidas.filter(doArtigo);
  const porCategoria = naoEscolhidas.filter(naCategoria);
  const disponiveis = porArtigo.length ? porArtigo : porCategoria.length ? porCategoria : naoEscolhidas;

  return (
    <div>
      <div className="mb-1 text-[10px] text-muted-foreground">OC</div>
      {!slotId ? (
        <div className="text-[10px] text-muted-foreground">Salve o plano para atribuir OC a este card.</div>
      ) : ocsAplicadas.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">Aplique OCs em "Insumos da coleção" para poder escolher aqui.</div>
      ) : (
        <div className="space-y-1">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map((id) => {
                const oc = byId(id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2 py-0.5 text-[10px]" title={oc ? label(oc) : id}>
                    <span className="max-w-[12rem] truncate">{oc ? label(oc) : id.slice(0, 8)}</span>
                    <button className="text-muted-foreground hover:text-foreground" disabled={salvar.isPending} onClick={() => remove(id)} title="Remover"><X className="h-3 w-3" /></button>
                  </span>
                );
              })}
            </div>
          )}
          <select
            className="w-full rounded border bg-background px-2 py-1 text-xs"
            value=""
            disabled={salvar.isPending || disponiveis.length === 0}
            onChange={(e) => { add(e.target.value); e.currentTarget.value = ""; }}
          >
            <option value="">{disponiveis.length ? "Adicionar OC…" : "Todas as OCs já escolhidas"}</option>
            {disponiveis.map((oc) => (<option key={oc.id} value={oc.id}>{label(oc)}</option>))}
          </select>
        </div>
      )}
    </div>
  );
}

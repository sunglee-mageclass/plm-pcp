import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronRight, X } from "lucide-react";
import { useArtigosTecido, type ArtigoTec } from "@/lib/plan-tecido/useArtigosTecido";
import { OcAplicadaPicker } from "./OcAplicadaPicker";

type PaletaRow = { artigo_id: string; papel: string };

/**
 * "Insumos da coleção": tecidos e forros que a coleção usa (dois dropdowns — só tecido / só forro,
 * classificados pela categoria do artigo) + as OCs aplicadas. Alimenta o topo dos dropdowns dos
 * cards (soft). Salva na hora.
 */
export function PaletaColecao({ colecaoId }: { colecaoId: string }) {
  const qc = useQueryClient();
  const { artigoMap, tecidoArtigos, forroArtigos } = useArtigosTecido();
  const [addTec, setAddTec] = useState("");
  const [addFor, setAddFor] = useState("");

  const { data: paleta = [] } = useQuery({
    queryKey: ["plan-tecido-paleta", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_paleta" as any).select("artigo_id, papel").eq("colecao_id", colecaoId)).data ?? []) as unknown as PaletaRow[]),
  });

  const salvar = useMutation({
    mutationFn: async (itens: PaletaRow[]) => {
      const { error } = await supabase.rpc("plan_tecido_set_paleta" as any, { _colecao_id: colecaoId, _itens: itens });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-tecido-paleta", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-paleta-papel", colecaoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a paleta.")),
  });

  const add = (artigoId: string, papel: "tecido" | "forro") => {
    if (!artigoId || paleta.some((p) => p.artigo_id === artigoId && p.papel === papel)) return;
    salvar.mutate([...paleta, { artigo_id: artigoId, papel }]);
  };
  const remove = (p: PaletaRow) =>
    salvar.mutate(paleta.filter((x) => !(x.artigo_id === p.artigo_id && x.papel === p.papel)));

  const chips = (papel: "tecido" | "forro") => paleta.filter((p) => p.papel === papel);
  const nome = (id: string) => artigoMap.get(id)?.nome ?? "—";
  const emUso = (arts: ArtigoTec[], papel: string) => new Set(chips(papel as "tecido" | "forro").map((p) => p.artigo_id));

  const linhaAdd = (label: string, papel: "tecido" | "forro", opcoes: ArtigoTec[], val: string, setVal: (s: string) => void) => {
    const usados = emUso(opcoes, papel);
    return (
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">{label}</span>
          {chips(papel).length === 0 && <span className="text-[11px] text-muted-foreground">nenhum</span>}
          {chips(papel).map((p) => (
            <span key={`${p.artigo_id}-${p.papel}`} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]">
              <span className="max-w-[10rem] truncate">{nome(p.artigo_id)}</span>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => remove(p)} title="Remover"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <select
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs"
            value={val}
            onChange={(e) => { setVal(""); add(e.target.value, papel); }}
          >
            <option value="">Adicionar {papel}…</option>
            {opcoes.filter((a) => !usados.has(a.id)).map((a) => (
              <option key={a.id} value={a.id}>{a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <Collapsible defaultOpen className="rounded-lg border">
      <CollapsibleTrigger className="flex min-h-[44px] w-full items-center gap-2 px-3 text-sm font-medium [&[data-state=open]>svg]:rotate-90">
        <ChevronRight className="h-4 w-4 transition-transform" />
        Insumos da coleção
        <span className="ml-auto text-[10px] text-muted-foreground">{paleta.length} item(ns)</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t p-3">
        {linhaAdd("Tecidos", "tecido", tecidoArtigos, addTec, setAddTec)}
        {linhaAdd("Forros", "forro", forroArtigos, addFor, setAddFor)}
        <div className="border-t pt-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">OCs aplicadas</div>
          <OcAplicadaPicker colecaoId={colecaoId} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

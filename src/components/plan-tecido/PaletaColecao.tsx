import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronRight, X } from "lucide-react";
import { OcAplicadaPicker } from "./OcAplicadaPicker";

type PaletaRow = { artigo_id: string; papel: string };
type ArtigoRow = { id: string; nome: string; unidade_medida: string | null };

/**
 * "Insumos da coleção" (bloco no topo do Plan. Tecido): pré-seleção SOFT de tecidos/forros que a
 * coleção usa + as OCs aplicadas (cobertura). A paleta alimenta o topo dos dropdowns dos cards
 * (não trava — "ver todos" + artigo já usado sempre aparece). Salva na hora.
 */
export function PaletaColecao({ colecaoId }: { colecaoId: string }) {
  const qc = useQueryClient();
  const [addArtigo, setAddArtigo] = useState("");
  const [addPapel, setAddPapel] = useState<"tecido" | "forro">("tecido");

  const { data: paleta = [] } = useQuery({
    queryKey: ["plan-tecido-paleta", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_paleta" as any).select("artigo_id, papel").eq("colecao_id", colecaoId)).data ?? []) as unknown as PaletaRow[]),
  });

  const { data: artigos = [] } = useQuery({
    queryKey: ["plan-tecido-artigos-lista"],
    queryFn: async () =>
      ((await supabase.from("artigos").select("id, nome, unidade_medida").order("nome")).data ?? []) as ArtigoRow[],
  });
  const nomeArtigo = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a.nome])), [artigos]);

  const salvar = useMutation({
    mutationFn: async (itens: PaletaRow[]) => {
      const { error } = await supabase.rpc("plan_tecido_set_paleta" as any, { _colecao_id: colecaoId, _itens: itens });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-tecido-paleta", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-paleta-ids", colecaoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a paleta.")),
  });

  const add = () => {
    if (!addArtigo) return;
    if (paleta.some((p) => p.artigo_id === addArtigo && p.papel === addPapel)) { setAddArtigo(""); return; }
    salvar.mutate([...paleta, { artigo_id: addArtigo, papel: addPapel }]);
    setAddArtigo("");
  };
  const remove = (p: PaletaRow) =>
    salvar.mutate(paleta.filter((x) => !(x.artigo_id === p.artigo_id && x.papel === p.papel)));

  return (
    <Collapsible defaultOpen className="rounded-lg border">
      <CollapsibleTrigger className="flex min-h-[44px] w-full items-center gap-2 px-3 text-sm font-medium [&[data-state=open]>svg]:rotate-90">
        <ChevronRight className="h-4 w-4 transition-transform" />
        Insumos da coleção
        <span className="ml-auto text-[10px] text-muted-foreground">{paleta.length} tecido(s)/forro(s)</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t p-3">
        {/* Tecidos & forros da coleção */}
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">Tecidos &amp; forros</div>
          <div className="flex flex-wrap gap-1">
            {paleta.length === 0 && <span className="text-[11px] text-muted-foreground">Nenhum ainda — os cards mostram todos os artigos.</span>}
            {paleta.map((p) => (
              <span key={`${p.artigo_id}-${p.papel}`} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]">
                <span className={`rounded px-1 text-[9px] font-bold ${p.papel === "forro" ? "bg-sky-600 text-white" : "bg-primary text-primary-foreground"}`}>{p.papel === "forro" ? "FOR" : "TEC"}</span>
                <span className="max-w-[10rem] truncate">{nomeArtigo[p.artigo_id] ?? "—"}</span>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => remove(p)} title="Remover"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <select className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" value={addArtigo} onChange={(e) => setAddArtigo(e.target.value)}>
              <option value="">Adicionar artigo…</option>
              {artigos.map((a) => (<option key={a.id} value={a.id}>{a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}</option>))}
            </select>
            <select className="rounded border bg-background px-2 py-1 text-xs" value={addPapel} onChange={(e) => setAddPapel(e.target.value as "tecido" | "forro")}>
              <option value="tecido">Tecido</option>
              <option value="forro">Forro</option>
            </select>
            <Button size="sm" variant="outline" className="text-xs" disabled={!addArtigo || salvar.isPending} onClick={add}>+ Adicionar</Button>
          </div>
        </div>

        {/* OCs aplicadas (cobertura — Fase C) */}
        <div className="border-t pt-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">OCs aplicadas</div>
          <OcAplicadaPicker colecaoId={colecaoId} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { semearArvore, mergeArvore, type SeedInput } from "@/lib/plan-tecido/engine";
import type { PtArvore } from "@/lib/plan-tecido/types";
import { ModelCard } from "@/components/plan-tecido/ModelCard";
import { ResumoPanel } from "@/components/plan-tecido/ResumoPanel";

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido/$colecaoId")({
  component: PlanTecidoPanel,
});

type Nome = { id: string; nome: string };

function PlanTecidoPanel() {
  const { colecaoId } = Route.useParams();
  const qc = useQueryClient();
  const [arvore, setArvore] = useState<PtArvore | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmSair, setConfirmSair] = useState(false);

  const { data: colecao } = useQuery({
    queryKey: ["plan-tecido-colecao", colecaoId],
    queryFn: async () => (await supabase.from("colecoes").select("id, nome, tipo").eq("id", colecaoId).maybeSingle()).data as any,
  });

  // buckets do plano (PV: colecao_pv_itens por subcoleção×linha; Orçamento: colecao_semana_categorias por subcoleção×categoria)
  const { data: seed } = useQuery({
    queryKey: ["plan-tecido-seed", colecaoId],
    enabled: !!colecao,
    queryFn: async (): Promise<SeedInput> => {
      const tipo = (colecao.tipo === "poder_venda" ? "poder_venda" : "orcamento") as SeedInput["tipo"];
      if (tipo === "poder_venda") {
        const rows = ((await supabase.from("colecao_pv_itens" as any).select("subcolecao_id, linha_id, qtd_semanas").eq("colecao_id", colecaoId)).data ?? []) as any[];
        const buckets = rows.map((r) => ({ subcolecao_id: r.subcolecao_id, linha_id: r.linha_id, categoria_id: null,
          qtd: Object.values((r.qtd_semanas ?? {}) as Record<string, number>).reduce((s, n) => s + (Number(n) || 0), 0) }));
        return { colecao_id: colecaoId, tipo, buckets };
      }
      const rows = ((await supabase.from("colecao_semana_categorias" as any).select("subcolecao_id, categoria_id, qtd").eq("colecao_id", colecaoId)).data ?? []) as any[];
      const buckets = rows.map((r) => ({ subcolecao_id: r.subcolecao_id, linha_id: null, categoria_id: r.categoria_id, qtd: Number(r.qtd) || 0 }));
      return { colecao_id: colecaoId, tipo, buckets };
    },
  });

  const { data: salvo } = useQuery({
    queryKey: ["plan-tecido-arvore", colecaoId],
    queryFn: async () => ((await supabase.rpc("plan_tecido_arvore" as any, { _colecao_id: colecaoId })).data ?? null) as PtArvore | null,
  });

  // nomes p/ rótulos da árvore (subcoleção/linha/categoria)
  const { data: subNomes = [] } = useQuery({
    queryKey: ["plan-tecido-subnomes", colecaoId],
    queryFn: async () => ((await supabase.from("colecao_subcolecoes" as any).select("id, nome").eq("colecao_id", colecaoId)).data ?? []) as unknown as Nome[],
  });
  const { data: linhaNomes = [] } = useQuery({
    queryKey: ["plan-tecido-linha-nomes"],
    queryFn: async () => ((await supabase.from("linhas").select("id, nome")).data ?? []) as Nome[],
  });
  const { data: catNomes = [] } = useQuery({
    queryKey: ["plan-tecido-cat-nomes"],
    queryFn: async () => ((await supabase.from("categorias_produto").select("id, nome")).data ?? []) as Nome[],
  });
  const nameOf = (arr: Nome[], id: string | null | undefined) => (id ? arr.find((x) => x.id === id)?.nome ?? null : null);

  useEffect(() => {
    if (seed && salvo !== undefined && arvore === null) setArvore(mergeArvore(semearArvore(seed), salvo));
  }, [seed, salvo, arvore]);

  const salvarMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("salvar_plan_tecido" as any, { _colecao_id: colecaoId, _arvore: arvore });
      if (error) throw error;
    },
    onSuccess: () => { setDirty(false); toast.success("Planejamento de tecido salvo."); qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] }); },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar.")),
  });

  const patch = (next: PtArvore) => { setArvore(next); setDirty(true); };
  const voltar = () => { if (dirty) setConfirmSair(true); else history.back(); };

  if (!arvore) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="flex min-h-screen flex-col max-sm:pb-24">
      <div className="flex items-center gap-2 border-b p-3">
        <span className="text-xs text-muted-foreground">Estilo &amp; Engenharia › Plan. Tecido › <b className="text-foreground">{colecao?.nome}</b></span>
        {dirty && <span className="ml-auto text-xs text-warning">● alterações não salvas</span>}
        <Button className="max-sm:hidden" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>{dirty ? "Salvar" : "Salvo"}</Button>
      </div>

      <div className="flex flex-1 gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-2">
          {arvore.subcolecoes.map((sub, si) => (
            <Collapsible key={sub.id ?? si} defaultOpen>
              <CollapsibleTrigger className="flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 text-sm font-medium [&[data-state=open]>svg]:rotate-90">
                <ChevronRight className="h-4 w-4 transition-transform" /> {nameOf(subNomes, sub.subcolecao_id) ?? "Sem subcoleção"}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                {sub.linhas.map((ln, li) => (
                  <div key={ln.id ?? li} className="mb-2">
                    <div className="mb-1 px-1 text-xs text-muted-foreground">
                      {ln.linha_id ? (nameOf(linhaNomes, ln.linha_id) ?? "Linha") : ln.categoria_id ? (nameOf(catNomes, ln.categoria_id) ?? "Categoria") : "Sem classificação"}
                    </div>
                    <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                      {ln.slots.map((slot, sli) => (
                        <ModelCard key={slot.id ?? sli} slot={slot} onChange={(ns) => {
                          const next = structuredClone(arvore) as PtArvore;
                          next.subcolecoes[si].linhas[li].slots[sli] = ns;
                          patch(next);
                        }} />
                      ))}
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
        <div className="hidden w-56 shrink-0 md:block"><ResumoPanel arvore={arvore} /></div>
      </div>

      <MobileActionBar>
        <Button variant="ghost" size="sm" onClick={voltar}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
        <Button className="ml-auto" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>{dirty ? "Salvar" : "Salvo"}</Button>
      </MobileActionBar>

      <AlertDialog open={confirmSair} onOpenChange={setConfirmSair}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>Há alterações não salvas no planejamento de tecido.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={() => history.back()}>Descartar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

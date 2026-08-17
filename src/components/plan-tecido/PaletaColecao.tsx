import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronRight, X, Clock, Home } from "lucide-react";
import { useArtigosTecido, type ArtigoTec } from "@/lib/plan-tecido/useArtigosTecido";
import { fmtInt } from "@/lib/format";
import { OcAplicadaPicker } from "./OcAplicadaPicker";

type PaletaRow = { artigo_id: string; papel: string };

/**
 * "Insumos da coleção": tecidos e forros da coleção (adicionados à mão OU já usados pelos cards) +
 * as OCs (aplicadas manualmente OU geradas pelo Fazer pedido), com status (encomendado × em casa).
 */
export function PaletaColecao({ colecaoId, emUso = [] }: { colecaoId: string; emUso?: PaletaRow[] }) {
  const qc = useQueryClient();
  const { artigoMap, tecidoArtigos, forroArtigos } = useArtigosTecido();
  const [addTec, setAddTec] = useState("");
  const [addFor, setAddFor] = useState("");

  const { data: paleta = [] } = useQuery({
    queryKey: ["plan-tecido-paleta", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_paleta" as any).select("artigo_id, papel").eq("colecao_id", colecaoId)).data ?? []) as unknown as PaletaRow[]),
  });

  // OCs que cobrem a coleção (aplicadas + geradas) agregadas por OC, com status
  const { data: ocsCobertura = [] } = useQuery({
    queryKey: ["plan-tecido-cobertura-ocs", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data } = await supabase.rpc("plan_tecido_cobertura_ocs" as any, { _colecao_id: colecaoId });
      const byOc = new Map<string, { numero_pedido: string | null; status: string | null; m: number }>();
      for (const r of (data ?? []) as { oc_tecido_id: string; numero_pedido: string | null; status: string | null; coberto_m: number }[]) {
        const cur = byOc.get(r.oc_tecido_id) ?? { numero_pedido: r.numero_pedido, status: r.status, m: 0 };
        cur.m += Number(r.coberto_m) || 0;
        byOc.set(r.oc_tecido_id, cur);
      }
      return [...byOc.values()];
    },
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

  const manuais = (papel: string) => paleta.filter((p) => p.papel === papel);
  // "em uso" pelos cards, que NÃO estão na paleta manual (read-only)
  const usados = (papel: string) => {
    const man = new Set(manuais(papel).map((p) => p.artigo_id));
    return emUso.filter((p) => p.papel === papel && !man.has(p.artigo_id));
  };
  const nome = (id: string) => artigoMap.get(id)?.nome ?? "—";
  const totalItens = useMemo(() => {
    const s = new Set<string>();
    for (const p of [...paleta, ...emUso]) s.add(`${p.artigo_id}|${p.papel}`);
    return s.size;
  }, [paleta, emUso]);

  const linhaAdd = (label: string, papel: "tecido" | "forro", opcoes: ArtigoTec[], val: string, setVal: (s: string) => void) => {
    const jaTem = new Set([...manuais(papel), ...emUso.filter((p) => p.papel === papel)].map((p) => p.artigo_id));
    return (
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">{label}</span>
          {manuais(papel).length === 0 && usados(papel).length === 0 && <span className="text-[11px] text-muted-foreground">nenhum</span>}
          {manuais(papel).map((p) => (
            <span key={`m-${p.artigo_id}`} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]">
              <span className="max-w-[10rem] truncate">{nome(p.artigo_id)}</span>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => remove(p)} title="Remover"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {usados(papel).map((p) => (
            <span key={`u-${p.artigo_id}`} className="inline-flex items-center gap-1 rounded-full border border-dashed bg-background px-2 py-0.5 text-[11px] text-muted-foreground" title="Já usado por um card da coleção">
              <span className="max-w-[10rem] truncate">{nome(p.artigo_id)}</span>
              <span className="text-[9px]">em uso</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <select className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" value={val}
            onChange={(e) => { setVal(""); add(e.target.value, papel); }}>
            <option value="">Adicionar {papel}…</option>
            {opcoes.filter((a) => !jaTem.has(a.id)).map((a) => (
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
        <span className="ml-auto text-[10px] text-muted-foreground">{totalItens} item(ns)</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t p-3">
        {linhaAdd("Tecidos", "tecido", tecidoArtigos, addTec, setAddTec)}
        {linhaAdd("Forros", "forro", forroArtigos, addFor, setAddFor)}
        <div className="border-t pt-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">OCs</div>
          {/* OCs vinculadas à coleção (acompanhamento), com status (encomendado × em casa).
              Cobrem o "a comprar" só com card vinculado ou se geradas pelo Fazer pedido (opção B). */}
          {ocsCobertura.length > 0 && (
            <div className="mb-2 space-y-0.5">
              {ocsCobertura.map((o, i) => (
                <div key={i} className="flex items-center gap-1 text-[11px]" title={o.status === "recebido" ? "Em casa (recebido)" : "Encomendado"}>
                  {o.status === "recebido" ? <Home className="h-3 w-3 text-emerald-600" /> : <Clock className="h-3 w-3 text-amber-600" />}
                  <span className="flex-1 truncate">{o.numero_pedido || "OC"}</span>
                  <span className="text-muted-foreground">{fmtInt(o.m)} m · {o.status === "recebido" ? "em casa" : "encomendado"}</span>
                </div>
              ))}
            </div>
          )}
          <OcAplicadaPicker colecaoId={colecaoId} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

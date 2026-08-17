import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { semAcento } from "@/lib/busca";
import { ocSearchValue } from "@/lib/plan-tecido/oc-busca";
import { OcHoverInfo } from "@/components/plan-tecido/OcPreview";
import { OcOrigemBadge } from "@/components/plan-tecido/OcOrigemBadge";

type OcItem = { artigo: { nome: string | null } | null; cancelado: boolean | null };
type OcRow = {
  id: string; numero_pedido: string | null; status: string | null; is_rolo: boolean | null;
  itens: OcItem[] | null; empresa: { nome_fantasia: string | null } | null;
};

/**
 * "Vincular OC / Rolo" (Fase C): liga OCs/rolos reais à coleção para ACOMPANHAMENTO no Resumo.
 * Cobertura do "A comprar" segue USO REAL (decisão do dono ago/2026, opção B): uma OC aplicada só
 * abate o "A comprar" quando há um card desta coleção vinculado a ela (ou quando a OC foi gerada
 * pelo Fazer pedido desta coleção); um rolo abate sempre pelo seu SALDO (estoque físico).
 */
export function OcAplicadaPicker({ colecaoId }: { colecaoId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");

  // OCs de tecido da loja + ROLOS (estoque físico) p/ escolher — o rolo credita cobertura
  // pelo SEU SALDO (dono, ago/2026), no mesmo seletor, rotulado como "Rolo".
  const { data: ocs = [] } = useQuery({
    queryKey: ["plan-tecido-ocs-lista"],
    queryFn: async () =>
      ((await supabase
        .from("ocs_tecido")
        .select("id, numero_pedido, status, is_rolo, empresa:empresa_id(nome_fantasia), itens:ocs_tecido_itens(cancelado, artigo:artigo_id(nome))")
        .order("data_pedido", { ascending: false })).data ?? []) as unknown as OcRow[],
  });
  // tecidos (artigos) que cada OC contém — distinct, ignorando itens cancelados
  const tecidosDaOc = (oc: OcRow) =>
    [...new Set((oc.itens ?? []).filter((i) => !i.cancelado && i.artigo?.nome).map((i) => i.artigo!.nome as string))];

  // Busca ÚNICA por tecido/artigo, nº da OC ou fornecedor (dono — muitas OCs do mesmo tecido,
  // achar mais rápido). Client-side, sem acento (mesmo padrão de entrada-saida.oc-tecido.tsx).
  const ocsFiltradas = useMemo(() => {
    const q = semAcento(busca.trim());
    if (!q) return ocs;
    return ocs.filter((oc) =>
      ocSearchValue({ numero_pedido: oc.numero_pedido, fornecedor: oc.empresa?.nome_fantasia ?? null, tecidos: tecidosDaOc(oc) }).includes(q),
    );
  }, [ocs, busca]);

  // OCs GERADAS pelo "Fazer pedido" DESTA coleção (plan_tecido_ocs) → selo "do plano" no seletor;
  // as demais (avulsas/de outra coleção) recebem "já existia" (decisão do dono 17/ago/2026).
  // ⚠️ MESMA queryKey do ResumoPanel → OBRIGATÓRIO o MESMO formato (string[] de ids) — cachear um
  // Set aqui envenenava o `.includes` do Resumo e derrubava a tela (bug de queryKey compartilhada,
  // ver CLAUDE.md). O Set é derivado localmente.
  const { data: geradas = [] } = useQuery<string[]>({
    queryKey: ["plan-tecido-ocs-geradas", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_ocs" as any).select("oc_tecido_id").eq("colecao_id", colecaoId)).data ?? []) as unknown as { oc_tecido_id: string }[])
        .map((r) => r.oc_tecido_id),
  });
  const geradasSet = new Set(geradas);

  // seleção já aplicada (persistida)
  const { data: aplicadas = [] } = useQuery({
    queryKey: ["plan-tecido-oc-aplicada", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_oc_aplicada" as any).select("oc_tecido_id").eq("colecao_id", colecaoId)).data ?? []) as unknown as { oc_tecido_id: string }[])
        .map((r) => r.oc_tecido_id),
  });

  // ao abrir, pré-marca as já aplicadas e limpa a busca da vez anterior
  useEffect(() => {
    if (open) { setSel(new Set(aplicadas)); setBusca(""); }
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
            <DialogTitle>Vincular OC / Rolo ao plano</DialogTitle>
            <DialogDescription>
              Escolha OCs de tecido ou <b>Rolos</b> (estoque físico). O selo mostra a origem:{" "}
              <b>do plano</b> (gerada pelo Fazer pedido desta coleção) ou <b>já existia</b> (avulsa /
              de outra coleção). Uma <b>OC aplicada</b> é acompanhamento: só abate o "a comprar"
              quando há um <b>card desta coleção vinculado</b> a ela (ou quando foi <b>do plano</b>).
              Um <b>rolo</b> abate o "a comprar" pelo seu <b>saldo</b> (metragem não separada).
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por tecido, nº da OC ou fornecedor…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded border">
            {ocs.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">Nenhuma OC ou rolo cadastrado.</div>
            ) : ocsFiltradas.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">Nenhuma OC encontrada para "{busca}".</div>
            ) : (
              ocsFiltradas.map((oc) => (
                <label key={oc.id} className="flex cursor-pointer items-start gap-2 border-b px-3 py-2 text-xs last:border-b-0">
                  <Checkbox checked={sel.has(oc.id)} onCheckedChange={() => toggle(oc.id)} className="mt-0.5 h-4 w-4" />
                  <OcHoverInfo ocId={oc.id} owned={geradasSet.has(oc.id)} isRolo={oc.is_rolo} className="mt-0.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <OcOrigemBadge owned={geradasSet.has(oc.id)} isRolo={oc.is_rolo} />
                        <span className="flex-1 truncate">{oc.numero_pedido || (oc.is_rolo ? "Rolo s/ nº" : "OC s/ nº")}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{oc.is_rolo ? "estoque" : statusLabel(oc.status)}</span>
                      </span>
                      {tecidosDaOc(oc).length > 0 && (
                        <span className="block truncate text-[10px] text-muted-foreground" title={tecidosDaOc(oc).join(", ")}>
                          {tecidosDaOc(oc).join(" · ")}
                        </span>
                      )}
                    </span>
                  </OcHoverInfo>
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

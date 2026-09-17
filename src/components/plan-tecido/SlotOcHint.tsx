import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { X, Plus, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OcRoloCombobox } from "./OcRoloCombobox";

type OcLite = {
  id: string; numero_pedido: string | null; is_rolo?: boolean; tecidos: string[];
  categorias?: string[]; artigos?: string[]; fornecedor?: string | null;
  /** OC comprada pelo Fazer pedido DESTA coleção (plan_tecido_ocs) → selo "comprado"; senão "existente". */
  owned?: boolean;
};

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-tecido-slot-oc", colecaoId] });
      // O hint de slot (plan_tecido_slot_oc) É fonte de COBERTURA na prévia (has_card=true no
      // _plan_tecido_previa_pedido_core) — atribuir/remover OC do card muda o "a comprar" e a
      // Demanda/Sobra por OC. Sem estas invalidações o painel do Resumo só atualizava ao refocar a
      // janela (bug ago/2026: simétrico ao desvincular do Resumo, que já invalida a prévia). O pool
      // do dropdown (oc-aplicada-lista) também lista os hints de slot → mantê-lo em dia.
      qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-situacao-ocs", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-oc-aplicada-lista", colecaoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a OC do card.")),
  });

  const label = (oc: OcLite) => `${oc.is_rolo ? "Rolo " : ""}${oc.numero_pedido || (oc.is_rolo ? "s/ nº" : "OC s/ nº")}${oc.tecidos.length ? " — " + oc.tecidos.join(" · ") : ""}`;
  const byId = (id: string) => ocsAplicadas.find((o) => o.id === id);
  const add = (id: string) => { if (id && !selected.includes(id)) salvar.mutate([...selected, id]); };
  const remove = (id: string) => salvar.mutate(selected.filter((x) => x !== id));

  // Card COM tecido escolhido → filtra ESTRITO pelo TECIDO (artigo real da variante); NÃO cai pra
  // categoria, senão mostrava OC de outro tecido da MESMA categoria (ex.: Fiore num card de Malha
  // Tessa — ambos "Malha"). Sem OC do tecido, o dropdown fica vazio com mensagem honesta (não some
  // pra outro tecido). Card SEM tecido → filtra pela categoria da lane (fallback nas não-escolhidas).
  const naCategoria = (o: OcLite) => !categoriaLane || !o.categorias || o.categorias.length === 0 || o.categorias.includes(categoriaLane);
  const doArtigo = (o: OcLite) => !!o.artigos && o.artigos.some((a) => slotArtigos.includes(a));
  const naoEscolhidas = ocsAplicadas.filter((o) => !selected.includes(o.id));
  const disponiveis = slotArtigos.length > 0
    ? naoEscolhidas.filter(doArtigo)
    : (naoEscolhidas.filter(naCategoria).length ? naoEscolhidas.filter(naCategoria) : naoEscolhidas);
  const vazioMsg = naoEscolhidas.length === 0
    ? "Todas as OCs já escolhidas"
    : slotArtigos.length > 0 ? "Nenhuma OC deste tecido" : "Nenhuma OC desta categoria";

  const semDisponiveis = disponiveis.length === 0;

  return (
    <div>
      {/* Rótulo "OC" + botão "+" que É O PRÓPRIO trigger do dropdown (1 clique abre a LISTA direto, sem
          passo intermediário). O combobox padrão fica de fora — só o "+" aciona o popover. */}
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">OC</span>
        {slotId && ocsAplicadas.length > 0 && (
          <OcRoloCombobox
            options={disponiveis}
            onSelect={add}
            disabled={salvar.isPending}
            placeholder="Adicionar OC / Rolo…"
            emptyMessage={vazioMsg}
            trigger={
              <button
                type="button"
                disabled={salvar.isPending || semDisponiveis}
                aria-label="Adicionar OC"
                title={semDisponiveis ? vazioMsg : "Adicionar OC / Rolo"}
                className="flex h-4 w-4 items-center justify-center rounded border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
              </button>
            }
          />
        )}
      </div>
      {!slotId ? (
        <div className="text-[10px] text-muted-foreground">Salve o plano para atribuir OC a este card.</div>
      ) : ocsAplicadas.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">Nenhuma OC/rolo vinculada à coleção — use "vincular OC / rolo" no Resumo (ou gere pelo Fazer pedido).</div>
      ) : (
        <div className="space-y-1">
          {/* OCs escolhidas viram UM chip de altura fixa (1 linha) com a lista no popover — N chips
              empilhados variavam a altura do card e desalinhavam as variantes no Modo Plano (dono
              set/2026, mesmo padrão do chip de vínculos do Dev). Remover cada OC fica no popover. */}
          {selected.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex max-w-full min-w-0 items-center gap-1 whitespace-nowrap rounded-full border border-primary bg-primary/10 px-2 py-0.5 text-[10px] hover:bg-primary/15">
                  <span className="truncate">
                    {selected.length === 1
                      ? (byId(selected[0]) ? label(byId(selected[0])!) : "OC s/ nº")
                      : `${selected.length} OCs no plano`}
                  </span>
                  <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <div className="mb-1 text-[10px] font-medium text-muted-foreground">OCs / rolos deste card</div>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {selected.map((id) => {
                    const oc = byId(id);
                    return (
                      <div key={id} className="flex items-center gap-1.5 rounded border bg-muted/40 px-2 py-1 text-[11px]">
                        <span className="min-w-0 flex-1 truncate" title={oc ? label(oc) : id}>{oc ? label(oc) : "OC s/ nº"}</span>
                        <button className="shrink-0 text-muted-foreground hover:text-destructive" disabled={salvar.isPending} onClick={() => remove(id)} title="Remover"><X className="h-3 w-3" /></button>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}

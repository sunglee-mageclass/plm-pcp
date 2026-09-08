import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { semAcento } from "@/lib/busca";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Dialog de destino do "Replicar card(s)" do Produto Acabado — espelha
 * `ReplicarImportadoDialog` (só troca queryKeys/rótulos; revenda não tem etapas/câmbio/foto).
 * Dropdowns PESQUISÁVEIS Coleção → Subcoleção. Ao confirmar, `onConfirmar(colecaoId, subId|null)`.
 * A RPC `replicar_produtos_acabados` só replica produtos JÁ MATERIALIZADOS (`modelo_id` não-nulo);
 * os sem card são ignorados por ela — aqui contamos e avisamos (`nIgnorados`) ANTES.
 */
type Opcao = { id: string; nome: string };

const SEM_SUB = "__sem__";

function ComboBusca({
  valor, opcoes, placeholder, buscaPlaceholder, vazio, onEscolher,
}: {
  valor: string | null;
  opcoes: Opcao[];
  placeholder: string;
  buscaPlaceholder: string;
  vazio: string;
  onEscolher: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const sel = opcoes.find((o) => o.id === valor);
  const filtradas = useMemo(() => {
    const q = semAcento(termo.trim().toLowerCase());
    if (!q) return opcoes;
    return opcoes.filter((o) => semAcento(o.nome.toLowerCase()).includes(q));
  }, [opcoes, termo]);

  return (
    <Popover open={aberto} onOpenChange={(o) => { setAberto(o); if (!o) setTermo(""); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={aberto} className="w-full justify-between font-normal">
          <span className="truncate">{sel ? sel.nome : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="border-b p-2">
          <Input placeholder={buscaPlaceholder} value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus />
        </div>
        <div className="max-h-56 overflow-auto py-1">
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{vazio}</div>
          ) : (
            filtradas.map((o) => (
              <button key={o.id} type="button"
                onClick={() => { onEscolher(o.id); setAberto(false); setTermo(""); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted ${valor === o.id ? "bg-muted" : ""}`}>
                <Check className={`h-4 w-4 shrink-0 ${valor === o.id ? "opacity-100" : "opacity-0"}`} />
                <span className="truncate">{o.nome}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ReplicarAcabadoDialog({
  open, onOpenChange, nEleg, nIgnorados, colecaoAtualId, replicando, onConfirmar,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nEleg: number;
  nIgnorados: number;
  colecaoAtualId: string;
  replicando: boolean;
  onConfirmar: (colecaoId: string, subcolecaoId: string | null) => void;
}) {
  const [colId, setColId] = useState<string>(colecaoAtualId);
  const [subId, setSubId] = useState<string>(SEM_SUB);

  const { data: colecoes = [] } = useQuery({
    queryKey: ["produto-acabado-replicar-colecoes"],
    enabled: open,
    queryFn: async () =>
      ((await supabase.from("colecoes").select("id, nome").order("created_at", { ascending: false })).data ?? []) as Opcao[],
  });

  const { data: subs = [] } = useQuery({
    queryKey: ["produto-acabado-replicar-subs", colId],
    enabled: open && !!colId,
    queryFn: async () =>
      ((await supabase.from("colecao_subcolecoes" as any).select("id, nome, ordem").eq("colecao_id", colId).order("ordem")).data ?? []) as unknown as Opcao[],
  });

  const colNome = useMemo(() => colecoes.find((c) => c.id === colId)?.nome ?? "—", [colecoes, colId]);
  const subNome = subId === SEM_SUB ? "Sem subcoleção" : (subs.find((s) => s.id === subId)?.nome ?? "—");

  const subOpcoes: Opcao[] = [{ id: SEM_SUB, nome: "Sem subcoleção" }, ...subs];
  const trocarColecao = (id: string) => { setColId(id); setSubId(SEM_SUB); };

  return (
    <Dialog open={open} onOpenChange={(o) => !replicando && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Replicar {nEleg} card(s)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Coleção de destino</Label>
            <ComboBusca
              valor={colId} opcoes={colecoes}
              placeholder="— escolha —" buscaPlaceholder="buscar coleção…" vazio="Nenhuma coleção encontrada."
              onEscolher={trocarColecao}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Subcoleção de destino</Label>
            <ComboBusca
              valor={subId} opcoes={subOpcoes}
              placeholder="Sem subcoleção" buscaPlaceholder="buscar subcoleção…" vazio="Nenhuma subcoleção encontrada."
              onEscolher={setSubId}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {nEleg} card(s) → <b>{colNome}</b> › <b>{subNome}</b>. Copia variantes e grade;
            <b> mantém a mesma REF</b> — nasce como nova versão do original.
            {nIgnorados > 0 && <> · <span className="text-amber-600">{nIgnorados} ignorado(s)</span> — sem card no Planejamento.</>}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={replicando}>Cancelar</Button>
          <Button
            disabled={replicando || !colId || nEleg === 0}
            onClick={() => onConfirmar(colId, subId === SEM_SUB ? null : subId)}
          >
            {replicando ? "Replicando…" : `Replicar (${nEleg})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

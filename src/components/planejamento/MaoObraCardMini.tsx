import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { brl } from "@/lib/format";
import type { MaoObraEditorLinha, CategoriaServicoOpt } from "./MaoObraEditor";
import { MoReprovarDialog } from "./MoReprovarDialog";

/**
 * Editor de MO ENXUTO para os CARDS de Produto Acabado / Importado (set/2026, pedido do dono).
 * Versão compacta do `MaoObraEditor`: lista de serviços (nome · valor · estado ✓/✗) + um ícone "+"
 * que abre um DIALOG de escolha de serviço (em vez do dropdown inline), SEM campo de observações.
 * Mesma fonte de dados `modelo_servico_mo` (chaveada por modelo_id) e as MESMAS regras de
 * multi-instância (o mesmo serviço pode repetir; aprovar/reprovar é POR INSTÂNCIA/id).
 *
 * Controlado: `linhas` é rascunho local (persiste no Salvar do card via `onChangeLinhas`);
 * aprovar/reprovar é imediato (`onAprovar`/`onReprovar` por id — só em linha já persistida).
 */
export function MaoObraCardMini({
  linhas, categorias, podeVerCustos, podeAprovar,
  onChangeLinhas, onAprovar, onReprovar, pendingLinhaId, linhasPersistidas,
}: {
  linhas: MaoObraEditorLinha[];
  categorias: CategoriaServicoOpt[];
  podeVerCustos: boolean;
  podeAprovar: boolean;
  onChangeLinhas: (linhas: MaoObraEditorLinha[]) => void;
  onAprovar: (linhaId: string) => void;
  onReprovar: (linhaId: string, motivo: string) => void;
  pendingLinhaId?: string | null;
  linhasPersistidas?: Set<string>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState<string>("");
  const [repro, setRepro] = useState<{ linhaId: string } | null>(null);

  const disponiveis = categorias.filter((c) => c.ativo !== false);
  const nomeCat = (id: string | null) => id == null ? "Geral (legado)" : (categorias.find((c) => c.id === id)?.nome ?? "Serviço");

  const setValorAt = (idx: number, v: number | null) =>
    onChangeLinhas(linhas.map((l, i) => (i === idx ? { ...l, valor: v } : l)));
  const removerAt = (idx: number) =>
    onChangeLinhas(linhas.filter((_, i) => i !== idx));
  const confirmarAdd = () => {
    if (!addSel) return;
    const padrao = categorias.find((c) => c.id === addSel)?.valor_padrao ?? null;
    onChangeLinhas([...linhas, { categoria_terceirizado_id: addSel, valor: padrao != null && padrao > 0 ? padrao : null, aprovado: null }]);
    setAddSel(""); setAddOpen(false);
  };

  const total = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Serviços de mão de obra</span>
        <Button type="button" variant="outline" size="iconSm" aria-label="Adicionar serviço" title="Adicionar serviço"
          disabled={disponiveis.length === 0} onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {linhas.length === 0 && <p className="text-xs text-muted-foreground">Nenhum serviço. Use o + para adicionar.</p>}

      {linhas.map((l, idx) => {
        const linhaId = l.id ?? null;
        const estado = l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente";
        const rowPending = pendingLinhaId !== undefined && pendingLinhaId != null && pendingLinhaId === linhaId;
        const persistida = linhaId != null && (linhasPersistidas === undefined || linhasPersistidas.has(linhaId));
        return (
          <div key={linhaId ?? `nova-${idx}`} className="flex flex-wrap items-center gap-2 rounded-md border p-1.5">
            <span className="min-w-[6rem] flex-1 truncate text-xs font-medium">{nomeCat(l.categoria_terceirizado_id)}</span>
            {podeVerCustos && (
              <div className="w-24">
                <MoneyInput value={l.valor || ""} onChange={(e) => { const v = e.target.value; setValorAt(idx, v === "" ? null : Number(v)); }} placeholder="0,00" className="h-7 text-xs" />
              </div>
            )}
            <StatusBadge
              tone={estado === "aprovada" ? "success" : estado === "reprovada" ? "danger" : "warning"}
              className="gap-1 rounded-full px-1.5 py-0.5 text-[10px] normal-case tracking-normal"
            >
              {estado === "aprovada" ? <Check className="h-3 w-3" /> : estado === "reprovada" ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {estado}
            </StatusBadge>
            {podeAprovar && (
              <span className="flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="iconSm" aria-label="Aprovar" title={persistida ? "Aprovar" : "Salve antes de aprovar"} className="text-emerald-700" disabled={rowPending || !persistida} onClick={() => linhaId && onAprovar(linhaId)}><Check className="h-3.5 w-3.5" /></Button>
                <Button type="button" variant="outline" size="iconSm" aria-label="Reprovar" title={persistida ? "Reprovar" : "Salve antes de reprovar"} className="text-red-700" disabled={rowPending || !persistida} onClick={() => linhaId && setRepro({ linhaId })}><X className="h-3.5 w-3.5" /></Button>
              </span>
            )}
            {podeVerCustos && (podeAprovar || l.aprovado === true) && (
              <Button type="button" variant="ghost" size="iconSm" aria-label="Remover" title="Remover" onClick={() => removerAt(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </div>
        );
      })}

      {podeVerCustos && linhas.length > 0 && (
        <p className="text-right text-[11px] text-muted-foreground">Total: <span className="tabular-nums font-medium">{brl(total)}</span></p>
      )}

      {/* Dialog de escolha de serviço (o "+" simplifica a view do card) */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setAddSel(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Adicionar serviço</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Select value={addSel} onValueChange={setAddSel}>
              <SelectTrigger><SelectValue placeholder="Selecione um serviço…" /></SelectTrigger>
              <SelectContent>
                {disponiveis.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setAddOpen(false); setAddSel(""); }}>Cancelar</Button>
              <Button type="button" disabled={!addSel} onClick={confirmarAdd}>Adicionar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MoReprovarDialog
        open={!!repro}
        onOpenChange={(o) => !o && setRepro(null)}
        onConfirm={(motivo) => { if (repro) { onReprovar(repro.linhaId, motivo); setRepro(null); } }}
      />
    </div>
  );
}

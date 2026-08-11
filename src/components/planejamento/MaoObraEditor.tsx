import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { brl } from "@/lib/format";
import type { MoLinha } from "@/lib/mao-obra";
import { MoReprovarDialog } from "./MoReprovarDialog";

export type MaoObraEditorLinha = MoLinha & { valor: number | null };
export type CategoriaServicoOpt = { id: string; nome: string; ativo?: boolean };

/**
 * Editor de MO POR SERVIÇO (Planejamento). VALOR é rascunho local (persiste no Salvar da página
 * via `onChangeLinhas`); Aprovar/Reprovar é imediato (`onAprovar`/`onReprovar`, gated no servidor).
 * A linha "Geral (legado)" tem `categoria_terceirizado_id = null` (some quando o usuário
 * adiciona serviços reais — o estado-completo do Salvar a apaga). Categorias INATIVAS só aparecem
 * como linhas HISTÓRICAS já adicionadas (o dropdown de adicionar lista só as ativas), então o
 * payload do Salvar preserva o histórico em vez de tentar apagá-lo.
 */
export function MaoObraEditor({
  linhas, categorias, podeVerCustos, podeAprovar,
  onChangeLinhas, onAprovar, onReprovar,
}: {
  linhas: MaoObraEditorLinha[];
  categorias: CategoriaServicoOpt[];
  podeVerCustos: boolean;
  podeAprovar: boolean;
  onChangeLinhas: (linhas: MaoObraEditorLinha[]) => void;
  onAprovar: (categoriaId: string | null) => void;
  onReprovar: (categoriaId: string | null, motivo: string) => void;
}) {
  const [addSel, setAddSel] = useState<string>("");
  const [repro, setRepro] = useState<{ categoriaId: string | null } | null>(null);

  const usados = useMemo(() => new Set(linhas.map((l) => l.categoria_terceirizado_id).filter(Boolean) as string[]), [linhas]);
  const disponiveis = categorias.filter((c) => c.ativo !== false && !usados.has(c.id));
  const nomeCat = (id: string | null) => id == null ? "Geral (legado)" : (categorias.find((c) => c.id === id)?.nome ?? "Serviço");

  const setValor = (id: string | null, v: number | null) =>
    onChangeLinhas(linhas.map((l) => (l.categoria_terceirizado_id === id ? { ...l, valor: v } : l)));
  const remover = (id: string | null) =>
    onChangeLinhas(linhas.filter((l) => l.categoria_terceirizado_id !== id));
  const adicionar = () => {
    if (!addSel) return;
    onChangeLinhas([...linhas, { categoria_terceirizado_id: addSel, valor: null, aprovado: null }]);
    setAddSel("");
  };

  return (
    <div className="grid gap-2">
      {linhas.length === 0 && <p className="text-xs text-muted-foreground">Nenhum serviço de mão de obra. Adicione abaixo.</p>}
      {linhas.map((l) => {
        const id = l.categoria_terceirizado_id;
        const estado = l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente";
        return (
          <div key={id ?? "legado"} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <span className="min-w-[8rem] flex-1 truncate text-sm font-medium">{nomeCat(id)}</span>
            {podeVerCustos && (
              <div className="w-32">
                <MoneyInput value={l.valor ?? ""} onChange={(e) => { const v = e.target.value; setValor(id, v === "" ? null : Number(v)); }} placeholder="R$" />
              </div>
            )}
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              estado === "aprovada" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : estado === "reprovada" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>
              {estado === "aprovada" ? <Check className="h-3 w-3" /> : estado === "reprovada" ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {estado}
            </span>
            {l.aprovado === false && l.motivo_reprovacao && (
              <span className="w-full text-xs text-red-700 dark:text-red-300">Motivo: {l.motivo_reprovacao}</span>
            )}
            {podeAprovar && (
              <span className="ml-auto flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="iconSm" aria-label="Aprovar" title="Aprovar" className="text-emerald-700" onClick={() => onAprovar(id)}><Check className="h-4 w-4" /></Button>
                <Button type="button" variant="outline" size="iconSm" aria-label="Reprovar" title="Reprovar" className="text-red-700" onClick={() => setRepro({ categoriaId: id })}><X className="h-4 w-4" /></Button>
              </span>
            )}
            {/* Remover é edição de VALOR (força re-envio do estado completo). Só p/ quem vê custos —
                senão um usuário só-aprovador (valores mascarados=null) zeraria os demais no Salvar.
                E só aparece onde o servidor DEIXA remover: linha já APROVADA (livre) OU quem tem a
                permissão de aprovar (o BEFORE DELETE gate barra remover linha pendente/reprovada sem
                `producao_servico_aprovacao` → sem esta guarda o botão levava a um 42501 e save parcial). */}
            {podeVerCustos && (podeAprovar || l.aprovado === true) && <Button type="button" variant="ghost" size="iconSm" aria-label="Remover" title="Remover" className={podeAprovar ? "" : "ml-auto"} onClick={() => remover(id)}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        );
      })}
      {podeVerCustos && disponiveis.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1">
            <Label className="text-xs">Adicionar serviço</Label>
            <Select value={addSel} onValueChange={setAddSel}>
              <SelectTrigger><SelectValue placeholder="Selecione um serviço…" /></SelectTrigger>
              <SelectContent>
                {disponiveis.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!addSel} onClick={adicionar}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
        </div>
      )}
      {podeVerCustos && linhas.length > 0 && (
        <p className="text-xs text-muted-foreground">Total aprovado: {brl(linhas.reduce((s, l) => s + (l.aprovado === true ? Number(l.valor) || 0 : 0), 0))}</p>
      )}

      <MoReprovarDialog
        open={!!repro}
        onOpenChange={(o) => !o && setRepro(null)}
        onConfirm={(motivo) => { if (repro) { onReprovar(repro.categoriaId, motivo); setRepro(null); } }}
      />
    </div>
  );
}

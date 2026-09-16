import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { brl } from "@/lib/format";
import type { MoLinha } from "@/lib/mao-obra";
import { MoReprovarDialog } from "./MoReprovarDialog";

export type MaoObraEditorLinha = MoLinha & { valor: number | null };
export type CategoriaServicoOpt = { id: string; nome: string; ativo?: boolean; valor_padrao?: number | null };

/**
 * Editor de MO POR SERVIÇO (Planejamento). VALOR é rascunho local (persiste no Salvar da página
 * via `onChangeLinhas`); Aprovar/Reprovar é imediato (`onAprovar`/`onReprovar` por INSTÂNCIA, gated
 * no servidor). MULTI-INSTÂNCIA (set/2026): o mesmo serviço pode ser adicionado N vezes — a
 * identidade de uma linha é o seu `id` (não mais o serviço). O dropdown de adicionar NÃO esconde
 * mais os serviços usados; "Geral (legado)" (`categoria_terceirizado_id = null`) segue possível
 * como linha antiga. As operações locais são por ÍNDICE do array (a lista inteira é reenviada no
 * Salvar; o servidor casa por `id` e insere as novas).
 */
export function MaoObraEditor({
  linhas, categorias, podeVerCustos, podeAprovar,
  onChangeLinhas, onAprovar, onReprovar, pendingLinhaId, linhasPersistidas,
}: {
  linhas: MaoObraEditorLinha[];
  categorias: CategoriaServicoOpt[];
  podeVerCustos: boolean;
  podeAprovar: boolean;
  onChangeLinhas: (linhas: MaoObraEditorLinha[]) => void;
  // Aprovar/reprovar POR INSTÂNCIA — recebe o `id` da linha (a RPC `aprovar_servico_mo` agora
  // chaveia por id). Uma linha ainda-não-persistida (sem id) não pode ser aprovada — vê `linhasPersistidas`.
  onAprovar: (linhaId: string) => void;
  onReprovar: (linhaId: string, motivo: string) => void;
  // Id da linha com aprovar/reprovar EM VOO (mutation `isPending` do chamador) — desabilita os 2
  // botões DAQUELA linha (guard de duplo-clique). `undefined` = nada pendente.
  pendingLinhaId?: string | null;
  // Ids de linha JÁ PERSISTIDAS no banco (`modelo_servico_mo`). Aprovar/reprovar é RPC imediata que
  // exige a linha existir; numa linha recém-adicionada (só no rascunho, sem id) daria "não
  // encontrada". Só habilita os botões nas linhas persistidas; as novas pedem Salvar antes.
  // `undefined` = chamador não informou (retrocompat) → considera todas persistidas.
  linhasPersistidas?: Set<string>;
}) {
  const [addSel, setAddSel] = useState<string>("");
  const [repro, setRepro] = useState<{ linhaId: string } | null>(null);

  // Multi-instância: o dropdown lista TODOS os serviços ativos (repetir é permitido). Categorias
  // inativas não entram como opção nova, mas linhas históricas nelas continuam editáveis.
  const disponiveis = categorias.filter((c) => c.ativo !== false);
  const nomeCat = (id: string | null) => id == null ? "Geral (legado)" : (categorias.find((c) => c.id === id)?.nome ?? "Serviço");

  const setValorAt = (idx: number, v: number | null) =>
    onChangeLinhas(linhas.map((l, i) => (i === idx ? { ...l, valor: v } : l)));
  const removerAt = (idx: number) =>
    onChangeLinhas(linhas.filter((_, i) => i !== idx));
  const adicionar = () => {
    if (!addSel) return;
    // Sugestão: pré-preenche o valor com o `valor_padrao` do serviço (M.O. sugerida por serviço).
    // Fica editável; só afeta a linha NOVA (sem id — o servidor gera no Salvar).
    const padrao = categorias.find((c) => c.id === addSel)?.valor_padrao ?? null;
    onChangeLinhas([...linhas, { categoria_terceirizado_id: addSel, valor: padrao != null && padrao > 0 ? padrao : null, aprovado: null }]);
    setAddSel("");
  };

  return (
    <div className="grid gap-2">
      {linhas.length === 0 && <p className="text-xs text-muted-foreground">Nenhum serviço de mão de obra. Adicione abaixo.</p>}
      {linhas.map((l, idx) => {
        const linhaId = l.id ?? null;
        const estado = l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente";
        // Só linha persistida (com id no baseline do servidor) pode ser aprovada/reprovada.
        const persistida = linhaId != null && (linhasPersistidas === undefined || linhasPersistidas.has(linhaId));
        return (
          <div key={linhaId ?? `nova-${idx}`} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <span className="min-w-[8rem] flex-1 truncate text-sm font-medium">{nomeCat(l.categoria_terceirizado_id)}</span>
            {podeVerCustos && (
              <div className="w-32">
                {/* `l.valor || ""` (não `??`): 0 e vazio são o MESMO valor de negócio aqui —
                    linha recém-adicionada (`valor: null`) OU já persistida com 0 nascem/permanecem
                    com o campo VAZIO + placeholder "0,00". `moLinhasEqual` espelha essa equivalência
                    na comparação de dirty. */}
                <MoneyInput value={l.valor || ""} onChange={(e) => { const v = e.target.value; setValorAt(idx, v === "" ? null : Number(v)); }} placeholder="0,00" data-colab-path={`mo:${linhaId ?? `nova-${idx}`}`} />
              </div>
            )}
            <StatusBadge
              tone={estado === "aprovada" ? "success" : estado === "reprovada" ? "danger" : "warning"}
              className="gap-1 rounded-full px-2 py-0.5 normal-case tracking-normal"
            >
              {estado === "aprovada" ? <Check className="h-3 w-3" /> : estado === "reprovada" ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {estado}
            </StatusBadge>
            {l.aprovado === false && l.motivo_reprovacao && (
              <span className="w-full text-xs text-red-700 dark:text-red-300">Motivo: {l.motivo_reprovacao}</span>
            )}
            {podeAprovar && (() => {
              const rowPending = pendingLinhaId !== undefined && pendingLinhaId != null && pendingLinhaId === linhaId;
              const bloqTitulo = !persistida ? "Salve o modelo antes de aprovar este serviço" : undefined;
              return (
                <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                  <span className="flex gap-1">
                    <Button type="button" variant="outline" size="iconSm" aria-label="Aprovar" title={bloqTitulo ?? "Aprovar"} className="text-emerald-700" disabled={rowPending || !persistida} onClick={() => linhaId && onAprovar(linhaId)}><Check className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="iconSm" aria-label="Reprovar" title={bloqTitulo ?? "Reprovar"} className="text-red-700" disabled={rowPending || !persistida} onClick={() => linhaId && setRepro({ linhaId })}><X className="h-4 w-4" /></Button>
                  </span>
                  {!persistida && <span className="text-[11px] text-muted-foreground">Salve para aprovar</span>}
                </span>
              );
            })()}
            {/* Remover é edição de VALOR (força re-envio do estado completo). Só p/ quem vê custos —
                senão um usuário só-aprovador (valores mascarados=null) zeraria os demais no Salvar.
                E só onde o servidor DEIXA remover: linha já APROVADA (livre) OU quem tem a permissão
                de aprovar (o BEFORE DELETE gate barra remover linha pendente/reprovada sem
                `producao_servico_aprovacao`). */}
            {podeVerCustos && (podeAprovar || l.aprovado === true) && <Button type="button" variant="ghost" size="iconSm" aria-label="Remover" title="Remover" className={podeAprovar ? "" : "ml-auto"} onClick={() => removerAt(idx)}><Trash2 className="h-4 w-4" /></Button>}
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
        onConfirm={(motivo) => { if (repro) { onReprovar(repro.linhaId, motivo); setRepro(null); } }}
      />
    </div>
  );
}

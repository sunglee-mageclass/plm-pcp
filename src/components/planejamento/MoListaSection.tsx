import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, X, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { brl } from "@/lib/format";
import type { MoLinha } from "@/lib/mao-obra";
import { MoReprovarDialog } from "./MoReprovarDialog";

/**
 * Seção EXPANDIDA de mão de obra por serviço, SEMPRE VISÍVEL no card completo da lista do
 * Planejamento (spec 2026-08-11, Task 2 — decisão do dono: seção, não popover). Abaixo do
 * badge agregado já existente. Só LÊ + aprova/reprova por linha (sem editar valor/adicionar/
 * remover serviço — isso é só no editor completo `MaoObraEditor`, dentro do card aberto).
 *
 * Paridade de comportamento com o `MaoObraEditor`: os botões Aprovar/Reprovar aparecem p/
 * TODA linha quando `podeAprovarMaoObra` — inclusive uma linha já aprovada (o editor não
 * esconde os botões nesse caso; não inventar um "Desfazer" que o editor não tem). Reprovar
 * abre o MESMO `MoReprovarDialog` (motivo obrigatório) usado pelo editor.
 *
 * Densidade: linhas `py-1 text-xs`, botões `size="iconSm"` (32px, padrão de tabela compacta).
 * >3 serviços trunca com "+N" expansível — evita dobrar a altura do card.
 *
 * `pendingCategoriaId` (opcional): categoria da linha com um aprovar/reprovar EM VOO (mutation
 * `isPending`, resolvida pelo chamador a partir das `variables` da mutation compartilhada da
 * lista) — desabilita os 2 botões DAQUELA linha, evitando 2 requests por duplo-clique.
 * `undefined` = nada pendente (não dá p/ usar `null` de sentinela — é um `categoria_
 * terceirizado_id` válido pra "Geral (legado)").
 */
export function MoListaSection({
  linhas, podeVerCustos, podeAprovarMaoObra, onAprovar, onReprovar, pendingCategoriaId,
}: {
  linhas: MoLinha[];
  podeVerCustos: boolean;
  podeAprovarMaoObra: boolean;
  onAprovar: (categoriaId: string | null) => void;
  onReprovar: (categoriaId: string | null, motivo: string) => void;
  pendingCategoriaId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  // `undefined` = dialog fechado; `categoria_terceirizado_id` (pode ser `null`, linha
  // "Geral (legado)") = dialog aberto p/ aquela linha — por isso não dá p/ usar `null` como
  // sentinela de "fechado".
  const [reproAlvo, setReproAlvo] = useState<string | null | undefined>(undefined);
  const listaId = useId();

  if (linhas.length === 0) return null;

  const visiveis = expanded ? linhas : linhas.slice(0, 3);
  const ocultos = linhas.length - visiveis.length;

  return (
    <div id={listaId} className="grid min-w-0 gap-1" onClick={(e) => e.stopPropagation()}>
      {visiveis.map((l) => {
        const id = l.categoria_terceirizado_id;
        const estado = l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente";
        return (
          // `min-w-0` + `flex-wrap` são CRÍTICOS aqui: o card completo (5 colunas) só dá ~180px
          // de largura útil pra linha — nome + valor + badge + 2 botões não cabem numa linha só
          // pra serviço com nome longo ("Geral (legado)") + badge "reprovada". Sem `min-w-0` no
          // item de grid, a linha estoura a largura do card (que tem `overflow-hidden`) e o
          // botão Reprovar some visualmente sem aviso nenhum. Sem `flex-wrap` (+ o nome preso
          // em `flex-1` puro), o nome é espremido até 0px de largura pra caber o resto — mesmo
          // bug, disfarçado (o serviço vira invisível em vez do botão). `min-w-[3.5rem]` no nome
          // garante um mínimo legível; o que não couber quebra pra 2ª linha (badge/botões).
          <div key={id ?? "legado"} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded border px-1.5 py-1 text-xs">
            <span className="min-w-[3.5rem] flex-1 truncate" title={l.nome ?? undefined}>{l.nome || "Serviço"}</span>
            {podeVerCustos && <span className="shrink-0 text-[11px] text-muted-foreground">{l.valor != null ? brl(l.valor) : "—"}</span>}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <StatusBadge
                    tone={estado === "aprovada" ? "success" : estado === "reprovada" ? "danger" : "warning"}
                    className="gap-0.5 rounded-full px-1.5 py-0.5"
                  >
                    {estado === "aprovada" ? <Check className="h-2.5 w-2.5" /> : estado === "reprovada" ? <X className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                    {estado}
                  </StatusBadge>
                </TooltipTrigger>
                {estado === "reprovada" && l.motivo_reprovacao && (
                  <TooltipContent className="max-w-[220px]"><p className="text-xs">Motivo: {l.motivo_reprovacao}</p></TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {podeAprovarMaoObra && (() => {
              // Guard de duplo-clique: enquanto ESTA linha tem um aprovar/reprovar em voo
              // (`pendingCategoriaId` resolvido pelo chamador a partir da mutation
              // compartilhada), os 2 botões da linha ficam desabilitados — sem isso, 2 cliques
              // rápidos disparavam 2 requests (`aprovar_servico_mo` não é idempotente por si só
              // contra corrida cliente-side).
              const rowPending = pendingCategoriaId !== undefined && pendingCategoriaId === id;
              return (
                <span className="ml-auto flex shrink-0 gap-1">
                  <Button type="button" variant="outline" size="iconSm" aria-label="Aprovar" title="Aprovar" className="text-emerald-700" disabled={rowPending} onClick={() => onAprovar(id)}><Check className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="outline" size="iconSm" aria-label="Reprovar" title="Reprovar" className="text-red-700" disabled={rowPending} onClick={() => setReproAlvo(id)}><X className="h-3.5 w-3.5" /></Button>
                </span>
              );
            })()}
          </div>
        );
      })}
      {linhas.length > 3 && (
        <button type="button" className="text-left text-[11px] text-muted-foreground hover:underline"
          aria-expanded={expanded} aria-controls={listaId}
          onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostrar menos" : `+${ocultos} serviço${ocultos > 1 ? "s" : ""}`}
        </button>
      )}
      <MoReprovarDialog
        open={reproAlvo !== undefined}
        onOpenChange={(o) => !o && setReproAlvo(undefined)}
        onConfirm={(motivo) => { if (reproAlvo !== undefined) { onReprovar(reproAlvo, motivo); setReproAlvo(undefined); } }}
      />
    </div>
  );
}

import { useId, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, X, AlertTriangle } from "lucide-react";
import { brl } from "@/lib/format";
import type { MoLinha } from "@/lib/mao-obra";
import { MoReprovarDialog } from "./MoReprovarDialog";

/**
 * Linha(s) de mão de obra por serviço no card TABULADO da lista do Planejamento (redesenho
 * set/2026; era a seção "caixa com borda" da spec 2026-08-11). Só LÊ + aprova/reprova por linha
 * (sem editar valor/adicionar/remover serviço — isso é só no editor completo `MaoObraEditor`,
 * dentro do card aberto).
 *
 * Formato tabulado (decisão do dono): valor + botões ✓/✗; **o ESTADO é o botão aceso** — nenhum
 * aceso = pendente · ✓ verde aceso = aprovada · ✗ vermelho aceso = reprovada (sem badge de texto
 * nem bolinha; `title`/tooltip reforça, não depende só de cor). 1 serviço → uma linha "Mão de
 * obra | valor ✓/✗". 2+ serviços → cabeçalho "Mão de obra · N serviços" + uma linha por serviço
 * (nome à esquerda). >3 trunca com "+N" expansível.
 *
 * Paridade com o `MaoObraEditor`: botões aparecem p/ TODA linha quando `podeAprovarMaoObra`
 * (inclusive já aprovada — o editor não esconde). Reprovar abre o MESMO `MoReprovarDialog`.
 * `pendingCategoriaId` desabilita os 2 botões DAQUELA linha (guard de duplo-clique); `undefined`
 * = nada pendente (`null` é `categoria_terceirizado_id` válido de "Geral (legado)").
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
  const [reproAlvo, setReproAlvo] = useState<string | null | undefined>(undefined);
  const listaId = useId();

  if (linhas.length === 0) return null;

  const multi = linhas.length > 1;
  const visiveis = expanded ? linhas : linhas.slice(0, 3);
  const ocultos = linhas.length - visiveis.length;

  // Uma linha de serviço: [rótulo] · [valor + ✓/✗]. rótulo = "Mão de obra" (1 serviço) ou o nome
  // do serviço (multi). Estado do serviço = qual botão está aceso.
  const linhaServico = (l: MoLinha) => {
    const id = l.categoria_terceirizado_id;
    const estado = l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente";
    const rowPending = pendingCategoriaId !== undefined && pendingCategoriaId === id;
    const tip = estado === "aprovada" ? "Aprovada" : estado === "reprovada" ? `Reprovada${l.motivo_reprovacao ? ` — ${l.motivo_reprovacao}` : ""}` : "Pendente";
    return (
      <div key={id ?? "legado"} className="flex min-w-0 items-center gap-1.5 px-2.5 py-[5px]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={multi ? (l.nome ?? undefined) : tip}>{multi ? (l.nome || "Serviço") : "Mão de obra"}</span>
        {podeVerCustos && <span className="shrink-0 tabular-nums">{l.valor != null ? brl(l.valor) : "—"}</span>}
        {podeAprovarMaoObra ? (
          <span className="flex shrink-0 gap-1">
            <button type="button" aria-label="Aprovar" title={rowPending ? "Processando…" : "Aprovar"} disabled={rowPending}
              onClick={() => onAprovar(id)}
              className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-[5px] border text-xs ${estado === "aprovada" ? "border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "border-input text-emerald-700 hover:bg-muted"} disabled:opacity-50`}>
              <Check className="h-3 w-3" />
            </button>
            <button type="button" aria-label="Reprovar" title={rowPending ? "Processando…" : "Reprovar"} disabled={rowPending}
              onClick={() => setReproAlvo(id)}
              className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-[5px] border text-xs ${estado === "reprovada" ? "border-red-500/50 bg-red-50 text-red-700 dark:bg-red-950/40" : "border-input text-red-700 hover:bg-muted"} disabled:opacity-50`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          // Sem permissão de aprovar: mostra o estado por um ícone (não só cor).
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-[5px] ${estado === "aprovada" ? "text-emerald-700" : estado === "reprovada" ? "text-red-700" : "text-amber-600"}`}>
              {estado === "aprovada" ? <Check className="h-3.5 w-3.5" /> : estado === "reprovada" ? <X className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            </span>
          </TooltipTrigger><TooltipContent className="max-w-[220px]"><p className="text-xs">{tip}</p></TooltipContent></Tooltip></TooltipProvider>
        )}
      </div>
    );
  };

  return (
    <div id={listaId} className="min-w-0 text-xs" onClick={(e) => e.stopPropagation()}>
      {multi && (
        <div className="flex items-center px-2.5 pt-[5px] pb-0.5">
          <span className="text-muted-foreground">Mão de obra</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{linhas.length} serviços</span>
        </div>
      )}
      {visiveis.map(linhaServico)}
      {linhas.length > 3 && (
        <button type="button" className="px-2.5 py-0.5 text-left text-[11px] text-muted-foreground hover:underline"
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

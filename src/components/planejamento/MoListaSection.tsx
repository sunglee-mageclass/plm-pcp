import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Check, X, AlertTriangle } from "lucide-react";
import { brl } from "@/lib/format";
import { somaTotal, type MoLinha } from "@/lib/mao-obra";
import { MoReprovarDialog } from "./MoReprovarDialog";

/**
 * Linha(s) de mão de obra por serviço no card TABULADO da lista do Planejamento. Só LÊ + aprova/
 * reprova por INSTÂNCIA (sem editar valor/adicionar/remover — isso é no editor completo
 * `MaoObraEditor`, dentro do card aberto).
 *
 * Comportamento (decisão do dono, set/2026 — multi-instância):
 *  • 1 serviço → linha "Mão de obra | valor ✓/✗": aprova/reprova DIRETO no card (sem popover).
 *  • 2+ serviços → linha "Mão de obra | SOMA TOTAL + selo N serviços"; ao passar o MOUSE, abre um
 *    popover (HoverCard) com uma linha por instância p/ aprovar/reprovar INDIVIDUALMENTE.
 * O ESTADO é o botão aceso — nenhum aceso = pendente · ✓ verde = aprovada · ✗ vermelho = reprovada
 * (tooltip/ícone reforça, não depende só de cor).
 *
 * MULTI-INSTÂNCIA: a chave é o `id` da linha (o mesmo serviço pode repetir); linha nova ainda sem
 * id não tem botão (só o estado — pede Salvar antes). `pendingLinhaId` desabilita os 2 botões
 * DAQUELA instância (guard de duplo-clique).
 */
export function MoListaSection({
  linhas, podeVerCustos, podeAprovarMaoObra, onAprovar, onReprovar, pendingLinhaId,
}: {
  linhas: MoLinha[];
  podeVerCustos: boolean;
  podeAprovarMaoObra: boolean;
  onAprovar: (linhaId: string) => void;
  onReprovar: (linhaId: string, motivo: string) => void;
  pendingLinhaId?: string | null;
}) {
  const [reproAlvo, setReproAlvo] = useState<string | undefined>(undefined);

  if (linhas.length === 0) return null;

  const multi = linhas.length > 1;
  const total = somaTotal(linhas);
  // Estado agregado (p/ o multi, cor do selo): reprovada se alguma reprovou; pendente se alguma
  // pendente; senão aprovada.
  const estadoAgg = linhas.some((l) => l.aprovado === false) ? "reprovada"
    : linhas.some((l) => l.aprovado == null) ? "pendente" : "aprovada";

  // Uma linha de instância: [rótulo] · [valor + ✓/✗]. Usada tanto na linha única (card) quanto
  // dentro do popover (multi).
  const linhaServico = (l: MoLinha, idx: number, rotulo: string) => {
    const linhaId = l.id ?? null;
    const estado = l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente";
    const rowPending = pendingLinhaId !== undefined && pendingLinhaId != null && pendingLinhaId === linhaId;
    const podeBotao = podeAprovarMaoObra && linhaId != null;
    const tip = estado === "aprovada" ? "Aprovada" : estado === "reprovada" ? `Reprovada${l.motivo_reprovacao ? ` — ${l.motivo_reprovacao}` : ""}` : "Pendente";
    return (
      <div key={linhaId ?? `nova-${idx}`} className="flex min-w-0 items-center gap-1.5 px-2.5 py-[5px]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={multi ? (l.nome ?? undefined) : tip}>{rotulo}</span>
        {podeVerCustos && <span className="shrink-0 tabular-nums">{l.valor != null ? brl(l.valor) : "—"}</span>}
        {podeBotao ? (
          <span className="flex shrink-0 gap-1">
            <button type="button" aria-label="Aprovar" title={rowPending ? "Processando…" : "Aprovar"} disabled={rowPending}
              onClick={() => linhaId && onAprovar(linhaId)}
              className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-[5px] border text-xs ${estado === "aprovada" ? "border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "border-input text-emerald-700 hover:bg-muted"} disabled:opacity-50`}>
              <Check className="h-3 w-3" />
            </button>
            <button type="button" aria-label="Reprovar" title={rowPending ? "Processando…" : "Reprovar"} disabled={rowPending}
              onClick={() => linhaId && setReproAlvo(linhaId)}
              className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-[5px] border text-xs ${estado === "reprovada" ? "border-red-500/50 bg-red-50 text-red-700 dark:bg-red-950/40" : "border-input text-red-700 hover:bg-muted"} disabled:opacity-50`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-[5px] ${estado === "aprovada" ? "text-emerald-700" : estado === "reprovada" ? "text-red-700" : "text-amber-600"}`}>
              {estado === "aprovada" ? <Check className="h-3.5 w-3.5" /> : estado === "reprovada" ? <X className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            </span>
          </TooltipTrigger><TooltipContent className="max-w-[220px]"><p className="text-xs">{tip}</p></TooltipContent></Tooltip></TooltipProvider>
        )}
      </div>
    );
  };

  // 1 serviço: aprova direto no card (linha "Mão de obra | valor ✓/✗").
  if (!multi) {
    return (
      <div className="min-w-0 text-xs" onClick={(e) => e.stopPropagation()}>
        {linhaServico(linhas[0], 0, "Mão de obra")}
        <MoReprovarDialog
          open={reproAlvo !== undefined}
          onOpenChange={(o) => !o && setReproAlvo(undefined)}
          onConfirm={(motivo) => { if (reproAlvo !== undefined) { onReprovar(reproAlvo, motivo); setReproAlvo(undefined); } }}
        />
      </div>
    );
  }

  // 2+ serviços: linha compacta com a SOMA TOTAL; popover ao hover p/ aprovar cada instância.
  const corSelo = estadoAgg === "aprovada" ? "text-emerald-700" : estadoAgg === "reprovada" ? "text-red-700" : "text-amber-600";
  return (
    <div className="min-w-0 text-xs" onClick={(e) => e.stopPropagation()}>
      <HoverCard openDelay={80} closeDelay={120}>
        <HoverCardTrigger asChild>
          <div className="flex min-w-0 cursor-default items-center gap-1.5 px-2.5 py-[5px]">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">Mão de obra</span>
            <span className={`shrink-0 text-[11px] ${corSelo}`}>{linhas.length} serviços</span>
            {podeVerCustos && <span className="shrink-0 tabular-nums font-medium">{brl(total)}</span>}
          </div>
        </HoverCardTrigger>
        <HoverCardContent align="end" className="w-72 p-0" onClick={(e) => e.stopPropagation()}>
          <div className="border-b px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
            Mão de obra · {linhas.length} serviços {podeVerCustos && <span className="float-right tabular-nums">{brl(total)}</span>}
          </div>
          <div className="max-h-64 overflow-y-auto py-0.5">
            {linhas.map((l, i) => linhaServico(l, i, l.nome || "Serviço"))}
          </div>
        </HoverCardContent>
      </HoverCard>
      <MoReprovarDialog
        open={reproAlvo !== undefined}
        onOpenChange={(o) => !o && setReproAlvo(undefined)}
        onConfirm={(motivo) => { if (reproAlvo !== undefined) { onReprovar(reproAlvo, motivo); setReproAlvo(undefined); } }}
      />
    </div>
  );
}

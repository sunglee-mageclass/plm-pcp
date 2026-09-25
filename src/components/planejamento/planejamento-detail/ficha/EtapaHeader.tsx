// Selo da etapa no HEADER do Sheet unificado (decisão travada 5: Nome → REF → selo) + "Mover para…" + a linha
// "Próxima: X — falta: Y" (chave ligada). Reusa `EtapaKanbanBadge` da F2 em modo visual dentro de um botão
// gatilho do Popover (o Radix cuida de abrir/fechar e do foco). Destinos bloqueados ficam esmaecidos e
// anotados, mas clicáveis: com a chave ligada o servidor decide e responde com o toast (paridade com o board).
import { useState } from "react";
import { ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EtapaKanbanBadge } from "@/components/shared/EtapaKanbanBadge";
import { ModoColunaBadge } from "@/components/admin/ModoColunaBadge";
import { cn } from "@/lib/utils";
import type { EtapaSelo } from "@/lib/kanban-auto-ui";
import type { OpcaoMover } from "./etapa-kanban";

export function EtapaHeader({ selo, podeMover, opcoes, onMover, movendo, proxima, sujo, carregando }: {
  selo: EtapaSelo;
  podeMover: boolean;
  opcoes: OpcaoMover[];
  onMover: (para: string) => void;
  movendo: boolean;
  proxima: { coluna: string; falta: string } | null;
  /** Há alteração não salva — as regras olham o estado SALVO. */
  sujo: boolean;
  /** M6, fix round 1 — `podeMover` é falso por CARGA (config/condições ainda não chegaram) ou por
   *  ERRO nelas — o selo vira só leitura com um `title` explicando o motivo, em vez de silenciar
   *  a diferença entre "não pode mover" (fora do kanban/sem permissão) e "ainda não sei". Omitido/
   *  `undefined` = não aplica (selo permanece do jeito de sempre). */
  carregando?: "carregando" | "erro" | false;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div data-testid="etapa-header" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {podeMover ? (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="etapa-mover-gatilho"
              aria-label={`Mover para… (etapa: ${selo.label})`}
              disabled={movendo}
              className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
            >
              <EtapaKanbanBadge selo={selo} testId="etapa-kanban-selo-header" className="cursor-pointer hover:bg-muted" />
              {movendo
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-1" data-testid="etapa-mover-menu">
            <p className="px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground">Mover para…</p>
            {sujo && (
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">As regras olham o que já está salvo — salve antes de mover.</p>
            )}
            <div className="max-h-72 overflow-y-auto">
              {opcoes.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  data-testid={`etapa-mover-${o.key}`}
                  disabled={movendo}
                  onClick={() => { setAberto(false); onMover(o.key); }}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50 max-sm:min-h-11",
                    o.bloqueada && "text-muted-foreground",
                  )}
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    {/* M6: ícone do MODO da coluna-destino (Zap=automática, Hand=manual…) — reusa o
                        badge da F2 (Config da Loja), não duplica ícone/rótulo. */}
                    <ModoColunaBadge modo={o.modo ?? null} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </span>
                  {o.nota && <span className="w-full whitespace-normal break-words text-xs text-muted-foreground opacity-80">{o.nota}</span>}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : carregando && selo.fase === "kanban" ? (
        // M6: quando a etapa está no kanban mas ainda não dá pra mover por CARGA/ERRO das regras
        // (config/condições), um `title` no WRAPPER explica — `EtapaKanbanBadge` (F2, não editar
        // aqui) sempre define o próprio `title` a partir de `tituloSelo`, então a dica fica num
        // `span` por fora em vez de tentar sobrescrever a da F2.
        <span title={carregando === "erro" ? "Não foi possível carregar as regras — recarregue" : "Carregando as regras do quadro…"}>
          <EtapaKanbanBadge selo={selo} testId="etapa-kanban-selo-header" />
        </span>
      ) : (
        <EtapaKanbanBadge selo={selo} testId="etapa-kanban-selo-header" />
      )}
      {proxima && (
        <span data-testid="etapa-proxima" className="inline-flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
          Próxima: <b className="font-semibold text-foreground">{proxima.coluna}</b> — falta:{" "}
          <b className="font-semibold text-[var(--tone-warning-fg)]">{proxima.falta}</b>
        </span>
      )}
    </div>
  );
}

// (F4a T1: o selo + Popover "Mover para…" agora vivem em `shared/MoverEtapaMenu`; aqui fica só o wrapper e a linha "Próxima".)
// Selo da etapa no HEADER do Sheet unificado (decisão travada 5: Nome → REF → selo) + "Mover para…" + a linha
// "Próxima: X — falta: Y" (chave ligada). Reusa `EtapaKanbanBadge` da F2 em modo visual dentro de um botão
// gatilho do Popover (o Radix cuida de abrir/fechar e do foco). Destinos bloqueados ficam esmaecidos e
// anotados, mas clicáveis: com a chave ligada o servidor decide e responde com o toast (paridade com o board).
import { ArrowRight } from "lucide-react";
import { MoverEtapaMenu } from "@/components/shared/MoverEtapaMenu";
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
  return (
    <div data-testid="etapa-header" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <MoverEtapaMenu
        selo={selo}
        podeMover={podeMover}
        opcoes={opcoes}
        onMover={onMover}
        movendo={movendo}
        sujo={sujo}
        carregando={carregando}
      />
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

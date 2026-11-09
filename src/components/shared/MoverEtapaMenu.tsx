// Selo da etapa do kanban + "Mover para…" — extraído do `EtapaHeader` (Sheet do Planejamento, F3.1) para ser o
// MESMO componente em PA/PI/PT (F4a T1). Reusa `EtapaKanbanBadge` em modo visual dentro de um botão gatilho do
// Popover (o Radix cuida de abrir/fechar e do foco). Destinos bloqueados ficam esmaecidos e anotados, mas
// clicáveis: com a chave ligada o servidor decide e responde com o toast (paridade com o board).
// A lógica de requisitos NÃO mora aqui: `opcoes` vem pronta de `opcoesMover*` (via `useSeloMover*`).
// Sem `testIdPrefix` os data-testid são os de SEMPRE do Sheet (`etapa-mover-gatilho`, `etapa-mover-menu`,
// `etapa-mover-<key>`, `etapa-kanban-selo-header`); com prefixo ("pa" | "pi" | "pt") viram `<p>-mover-gatilho`,
// `<p>-mover-menu`, `<p>-mover-<key>`, `<p>-kanban-selo`.
import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EtapaKanbanBadge } from "@/components/shared/EtapaKanbanBadge";
import { ModoColunaBadge } from "@/components/admin/ModoColunaBadge";
import { cn } from "@/lib/utils";
import type { EtapaSelo } from "@/lib/kanban-auto-ui";
import type { OpcaoMover } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";

export function MoverEtapaMenu({ selo, podeMover, opcoes, onMover, movendo, sujo, carregando, compacto, testIdPrefix, dentroDeCard }: {
  selo: EtapaSelo;
  podeMover: boolean;
  opcoes: OpcaoMover[];
  onMover: (para: string) => void;
  movendo: boolean;
  /** Há alteração não salva — as regras olham o estado SALVO. */
  sujo?: boolean;
  /** M6, fix round 1 — `podeMover` é falso por CARGA (config/condições ainda não chegaram) ou por
   *  ERRO nelas — o selo vira só leitura com um `title` explicando o motivo, em vez de silenciar
   *  a diferença entre "não pode mover" (fora do kanban/sem permissão) e "ainda não sei". Omitido/
   *  `undefined` = não aplica (selo permanece do jeito de sempre). */
  carregando?: "carregando" | "erro" | false;
  /** Card estreito do canvas: selo compacto. */
  compacto?: boolean;
  /** "pa" | "pi" | "pt" — data-testid por tela. Omitido = testIds do Sheet do Planejamento. */
  testIdPrefix?: string;
  /** Dentro de um card clicável: o clique no gatilho/menu NÃO sobe (nem pelo portal do React) para o card. */
  dentroDeCard?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const p = testIdPrefix;
  const idGatilho = p ? `${p}-mover-gatilho` : "etapa-mover-gatilho";
  const idMenu = p ? `${p}-mover-menu` : "etapa-mover-menu";
  const idSelo = p ? `${p}-kanban-selo` : "etapa-kanban-selo-header";
  const idOpcao = (key: string) => (p ? `${p}-mover-${key}` : `etapa-mover-${key}`);
  const parar = dentroDeCard ? (e: React.SyntheticEvent) => e.stopPropagation() : undefined;

  if (podeMover) {
    return (
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={idGatilho}
            aria-label={`Mover para… (etapa: ${selo.label})`}
            disabled={movendo}
            onClick={parar}
            className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
          >
            <EtapaKanbanBadge selo={selo} compacto={compacto} testId={idSelo} className="cursor-pointer hover:bg-muted" />
            {movendo
              ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          </button>
        </PopoverTrigger>
          {/* F4a fix round 2 (dono 09/nov): o fix 1 limitava a altura so pela var CSS do Radix
              `--radix-popover-content-available-height`. Isso FALHOU (o dono: "so aumentou, sem scroll,
              tenho que mover a pagina inteira"): (a) sem `collisionPadding` o Radix media a altura ate a
              BORDA CRUA da tela — valor enorme, o `max-h` nao limitava nada visivel; (b) se a var nao
              resolve, nao sobra teto nenhum e o popover cresce sem rolar. Correcao: `collisionPadding`
              fixo (o Radix passa a medir com folga), `avoidCollisions`, e um TETO DURO `max-h-[60vh]` que
              SEMPRE vale (independe da var) somado ao `min()` com a var (o menor dos dois). flex-col +
              lista `flex-1 overflow-y-auto` fazem SO a lista rolar, com o cabecalho fixo. */}
        <PopoverContent
          align="start"
          avoidCollisions
          collisionPadding={12}
          className="flex max-h-[min(60vh,var(--radix-popover-content-available-height,60vh))] w-72 max-w-[calc(100vw-2rem)] flex-col p-1"
          data-testid={idMenu}
          onClick={parar}
        >
          <p className="shrink-0 px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground">Mover para…</p>
          {sujo && (
            <p className="shrink-0 px-2 pb-1 text-[11px] text-muted-foreground">As regras olham o que já está salvo — salve antes de mover.</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {opcoes.map((o) => (
              <button
                key={o.key}
                type="button"
                data-testid={idOpcao(o.key)}
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
                  {/* Nit (fix round 2): rótulos longos truncam (`truncate`) — `title` mostra o
                      texto inteiro no hover/toque longo. */}
                  <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
                </span>
                {o.nota && <span className="w-full whitespace-normal break-words text-xs text-muted-foreground opacity-80">{o.nota}</span>}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (carregando && selo.fase === "kanban") {
    // M6 (fix round 1) + Minor (fix round 2): quando a etapa está no kanban mas ainda não dá
    // pra mover por CARGA/ERRO das regras (config/condições), o `title` no WRAPPER explica no
    // hover — `EtapaKanbanBadge` (F2) sempre define o próprio `title` a partir de `tituloSelo`,
    // então essa dica não pode sobrescrevê-lo — MAS um `title` só no hover fica ESCONDIDO. O Minor pede
    // um texto CURTO e VISÍVEL ao lado, com o `Loader2`: "Carregando regras…" enquanto pendente;
    // "erro" fica sem ícone de spinner (não está mais carregando).
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5"
        title={carregando === "erro" ? "Não foi possível carregar as regras — recarregue" : "Carregando as regras do quadro…"}
      >
        <EtapaKanbanBadge selo={selo} compacto={compacto} testId={idSelo} />
        {carregando === "carregando" ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Carregando regras…
          </span>
        ) : (
          <span className="shrink-0 text-xs text-[var(--tone-danger-fg)]">Erro ao carregar as regras</span>
        )}
      </span>
    );
  }

  return <EtapaKanbanBadge selo={selo} compacto={compacto} testId={idSelo} />;
}

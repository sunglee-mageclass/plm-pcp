import { Pin, Rocket, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { tituloSelo, type EtapaSelo } from "@/lib/kanban-auto-ui";

/**
 * Selo da ETAPA do kanban de Desenvolvimento (decisão 5 do dono). Reutilizável: card da lista do
 * Planejamento (F2) e header do Sheet unificado (F3 — com `onClick` abre o "Mover para…").
 * Estados vêm de `etapaDoModelo` (puro): "Planejamento" (antes da Ordem de Criação) · "Lançado" · a coluna
 * do Dev; com a chave ligada soma "automática" (anda sozinho) ou "fixado" (coluna manual).
 */
export function EtapaKanbanBadge({ selo, className, onClick, testId = "etapa-kanban-selo", compacto = false }: {
  selo: EtapaSelo;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  testId?: string;
  // Card COMPACTO do Planejamento (B1, dono 23/set): menor, e "automática"/"fixado" viram só o ícone (o `title` tem a frase).
  compacto?: boolean;
}) {
  const lancado = selo.fase === "lancado";
  const cls = cn(
    "inline-flex max-w-full min-w-0 items-center rounded-full border font-medium leading-tight",
    compacto ? "gap-1 px-1.5 py-0.5 text-[10px]" : "gap-1.5 px-2 py-0.5 text-[11px]",
    lancado ? "border-transparent bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]" : "bg-card text-foreground",
    onClick && "cursor-pointer hover:bg-muted",
    className,
  );
  const conteudo = (
    <>
      {lancado ? (
        <Rocket className="h-3 w-3 shrink-0" />
      ) : (
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: selo.color ?? "var(--muted-foreground)" }} />
      )}
      <span className="min-w-0 truncate">{selo.label}</span>
      {selo.modo === "automatica" && (compacto ? (
        <span role="img" aria-label="automática" className="inline-flex shrink-0 text-muted-foreground"><Zap className="h-3 w-3" /></span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-0.5 font-normal text-muted-foreground"><Zap className="h-3 w-3" />automática</span>
      ))}
      {selo.modo === "fixado" && (compacto ? (
        <span role="img" aria-label="fixado" className="inline-flex shrink-0 text-muted-foreground"><Pin className="h-3 w-3" /></span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-0.5 font-normal text-muted-foreground"><Pin className="h-3 w-3" />fixado</span>
      ))}
    </>
  );
  const titulo = tituloSelo(selo);
  const dataCompacto = compacto ? "true" : undefined;
  return onClick ? (
    <button type="button" data-testid={testId} data-compacto={dataCompacto} className={cls} title={titulo} onClick={onClick}>{conteudo}</button>
  ) : (
    <span data-testid={testId} data-compacto={dataCompacto} className={cls} title={titulo}>{conteudo}</span>
  );
}

const SELO_PLANEJAMENTO: EtapaSelo = { fase: "planejamento", key: null, label: "Planejamento", color: null, modo: "off" };
const SELO_ETAPA: EtapaSelo = { fase: "kanban", key: "em_pilotagem", label: "Em Pilotagem", color: "var(--kanban-violet)", modo: "off" };
const SELO_AUTOMATICA: EtapaSelo = { ...SELO_ETAPA, modo: "automatica" };
const SELO_FIXADO: EtapaSelo = { fase: "kanban", key: "stand_by", label: "Stand By", color: "var(--muted-foreground)", modo: "fixado" };
const SELO_LANCADO: EtapaSelo = { fase: "lancado", key: null, label: "Lançado", color: null, modo: "off" };

/** Legenda dos estados do selo (mockup "Cards do Planejamento com a etapa"). */
export function EtapaKanbanLegenda({ ligado, className }: { ligado: boolean; className?: string }) {
  const itens: { id: string; selo: EtapaSelo; texto: string }[] = [
    { id: "plan", selo: SELO_PLANEJAMENTO, texto: "antes da Ordem de Criação" },
    ...(ligado
      ? [
          { id: "auto", selo: SELO_AUTOMATICA, texto: "anda sozinho pelos campos salvos" },
          { id: "fix", selo: SELO_FIXADO, texto: "fixado numa coluna manual" },
        ]
      : [{ id: "etapa", selo: SELO_ETAPA, texto: "etapa no Desenvolvimento" }]),
    { id: "lanc", selo: SELO_LANCADO, texto: "modelo lançado" },
  ];
  return (
    <div
      data-testid="etapa-kanban-legenda"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground", className)}
    >
      <span className="font-semibold text-foreground">Selo da etapa</span>
      {itens.map((i) => (
        <span key={i.id} className="inline-flex items-center gap-1.5">
          <EtapaKanbanBadge selo={i.selo} testId="etapa-kanban-selo-exemplo" />
          {i.texto}
        </span>
      ))}
    </div>
  );
}

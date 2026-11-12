import { Hand, Zap } from "lucide-react";
import { EtapaKanbanBadge } from "@/components/shared/EtapaKanbanBadge";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { ServicoAtrasoBadge } from "@/components/shared/ServicoAtrasoBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ETAPA_PL_FILTRO_LANCADO, ETAPA_PL_FORA, type EtapaSeloPl } from "@/lib/etapas-pl-ui";
import type { EtapaSelo } from "@/lib/kanban-auto-ui";
import type { Atraso } from "@/lib/servico-atraso";

// Card do PRODUTO no board das Etapas PL (Onda 3, Task 8). 1 card por produto (o board antigo tinha 1 por bloco de serviço).
// SEM campos editáveis: a edição mora no Sheet de Serviços (a rota abre ao clicar — `onAbrir`; este componente NÃO abre Sheet).
// Desktop: arrastável (HTML5 nativo, igual ao KanbanCard do Desenvolvimento). Mobile: `moverOpts` liga o "Mover para…".

/** Produto como o board enxerga (a rota monta a partir de `modelos` com `status_etapa_pl` não nulo). */
export type ProdutoPlBoard = {
  id: string;
  nome: string | null;
  ref: string | null;
  /** `modelos.status_etapa_pl` cru (null/órfão = o board põe na 1ª coluna). */
  status_etapa_pl: string | null;
  /** `modelos.lancado` — vai para a coluna terminal "Finalizado" (derivado: volta ao fluxo se reverter). */
  lancado?: boolean | null;
  /** Fontes de foto na ordem de capa (foto do modelo → desenho técnico → croqui). */
  fotoFontes: (string | null | undefined)[];
  /** Pior atraso entre os blocos de serviço / peças de foto do produto (`atrasosDoProduto`); null = sem alerta. */
  atrasoServico?: Atraso;
  atrasoPecaFoto?: Atraso;
};

/** Uma opção do "Mover para…" (mobile). `nota` = "fixa aqui", "falta 1 dado"…; `bloqueada` esmaece a opção. */
export type MoverOptPl = { key: string; label: string; nota?: string; bloqueada?: boolean; modo?: "automatica" | "manual" | null };

/** Selo da lib PL → o do `EtapaKanbanBadge` (que é do Dev: exige `fase`). */
function seloParaBadge(s: EtapaSeloPl): EtapaSelo {
  return { fase: s.key === ETAPA_PL_FILTRO_LANCADO ? "lancado" : "kanban", key: s.key, label: s.label, color: s.color, modo: s.modo };
}

/** Tooltip do selo (o do Dev diz "Etapa do Desenvolvimento", errado aqui). */
function tituloSeloPl(s: EtapaSeloPl): string {
  if (s.key === ETAPA_PL_FILTRO_LANCADO) return "Produto lançado.";
  if (s.key === ETAPA_PL_FORA) return "Este produto não está no kanban das Etapas PL.";
  const base = `Etapa PL: ${s.label}`;
  if (s.modo === "automatica") return `${base} — anda sozinho conforme os dados salvos.`;
  if (s.modo === "fixado") return `${base} — fixado numa coluna manual: não anda sozinho.`;
  return base;
}

export function EtapaPlCard({
  produto, selo, onAbrir, draggable: isDraggable = false, dragging = false, onDragStartCard, onDragEndCard, moverOpts, onMover,
}: {
  produto: ProdutoPlBoard;
  selo: EtapaSeloPl;
  /** Clique no card: a rota abre o Sheet de Serviços. */
  onAbrir: (produtoId: string) => void;
  draggable?: boolean;
  dragging?: boolean;
  onDragStartCard?: () => void;
  onDragEndCard?: () => void;
  /** Mobile: opções do "Mover para…" (sem isto o Select não aparece). */
  moverOpts?: MoverOptPl[];
  onMover?: (paraKey: string) => void;
}) {
  const temAtraso = !!produto.atrasoServico || !!produto.atrasoPecaFoto;
  return (
    <div
      data-testid="etapa-pl-card"
      data-produto-id={produto.id}
      draggable={isDraggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", produto.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStartCard?.();
      }}
      onDragEnd={() => onDragEndCard?.()}
      className={`w-full rounded-md border bg-card p-2 text-left text-sm shadow-sm transition-shadow hover:shadow-md ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""} ${dragging ? "opacity-50 ring-2 ring-primary" : ""}`}
    >
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-start gap-2"
        onClick={() => onAbrir(produto.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onAbrir(produto.id);
          }
        }}
      >
        <ModeloResumoFoto fontes={produto.fotoFontes} nome={produto.nome} className="h-14 w-14" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-medium">{produto.nome ?? "Sem nome"}</p>
          {produto.ref && <p className="truncate font-mono text-xs text-primary">{produto.ref}</p>}
          <EtapaKanbanBadge selo={seloParaBadge(selo)} titulo={tituloSeloPl(selo)} testId="etapa-pl-selo" compacto />
          {temAtraso && (
            <div className="flex flex-wrap gap-1">
              <ServicoAtrasoBadge atraso={produto.atrasoServico ?? null} tipo="servico" />
              <ServicoAtrasoBadge atraso={produto.atrasoPecaFoto ?? null} tipo="peca_foto" />
            </div>
          )}
        </div>
      </div>
      {/* "Mover para…" = o arraste do desktop, no toque. `key` por status reseta o placeholder ao mover. */}
      {moverOpts && moverOpts.length > 0 && onMover && (
        <Select key={produto.status_etapa_pl ?? "_"} onValueChange={onMover}>
          <SelectTrigger className="mt-2 h-9 text-xs" data-testid="etapa-pl-mover" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="Mover para…" />
          </SelectTrigger>
          <SelectContent>
            {moverOpts.map((o) => (
              <SelectItem key={o.key} value={o.key} className={o.bloqueada ? "text-muted-foreground" : ""}>
                {o.label}
                {o.modo && (
                  <span className="ml-1 inline-flex align-middle text-muted-foreground" role="img" aria-label={o.modo === "manual" ? "manual" : "automática"}>
                    {o.modo === "manual" ? <Hand className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                  </span>
                )}
                {o.nota && <span className="text-xs opacity-70"> · {o.nota}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

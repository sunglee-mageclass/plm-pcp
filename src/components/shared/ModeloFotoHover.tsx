import { type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";

/**
 * Foto do modelo (anexo) na lista de produtos. Dois gatilhos separados por plataforma:
 *
 *  • `ModeloFotoHoverRow` — envolve a LINHA INTEIRA (`<tr>`) como gatilho do HoverCard no
 *    DESKTOP: passar o mouse em qualquer lugar da linha mostra a foto. `HoverCardContent`
 *    renderiza em portal (fora da tabela), então é HTML válido. `asChild` clona no `<tr>`,
 *    preservando o `onClick` da linha (abre o sheet). Escondido no mobile (`md:block`).
 *  • `ModeloFotoIconeMobile` — um ícone de imagem (dentro da célula REF) que abre a foto num
 *    Popover no TOQUE (mobile não tem hover). `stopPropagation` p/ não abrir o sheet junto.
 *    Escondido no desktop (`md:hidden`).
 *
 * Conteúdo LAZY (HoverCardContent/PopoverContent só montam ao abrir → signed URL só é
 * resolvido quando a linha é focada, não p/ todas as linhas no render).
 * `fontes` = hierarquia de capa padrão: [fotos_modelo[0], desenho_tecnico_url, croqui_url].
 * Sem foto → `ModeloResumoFoto` mostra o placeholder (hover/popover ainda abrem).
 */

const fotoDe = (fontes: (string | null | undefined)[], nome?: string | null) => (
  <ModeloResumoFoto fontes={fontes} nome={nome} className="h-40 w-40" />
);

/** Envolve o `<tr>` (children) como gatilho do HoverCard — hover na linha inteira (desktop). */
export function ModeloFotoHoverRow({
  fontes,
  nome,
  children,
}: {
  fontes: (string | null | undefined)[];
  nome?: string | null;
  children: ReactNode;
}) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" side="right" className="hidden w-auto p-1 md:block">
        {fotoDe(fontes, nome)}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Ícone de imagem (na célula REF) que abre a foto num Popover ao toque — só mobile. */
export function ModeloFotoIconeMobile({
  fontes,
  nome,
  className,
}: {
  fontes: (string | null | undefined)[];
  nome?: string | null;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={nome ? `Ver foto de ${nome}` : "Ver foto do modelo"}
          title="Ver foto"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground md:hidden",
            className,
          )}
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1" onClick={(e) => e.stopPropagation()}>
        {fotoDe(fontes, nome)}
      </PopoverContent>
    </Popover>
  );
}

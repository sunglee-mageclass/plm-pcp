import { type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";

/**
 * Mostra a foto do modelo (anexo) ao passar o mouse na linha da lista de produtos.
 * Desktop: HoverCard (hover). Mobile/toque (sem hover): um ícone de imagem ao lado da REF
 * que abre a foto num Popover — espelha o padrão de `OcHoverInfo` (plan-tecido/OcPreview).
 * Conteúdo LAZY (HoverCardContent/PopoverContent só montam ao abrir → o signed URL só é
 * resolvido quando a linha é de fato focada, não p/ todas as linhas no render).
 *
 * `fontes` = hierarquia de capa padrão: [fotos_modelo[0], desenho_tecnico_url, croqui_url].
 * `children` é o gatilho do hover (a célula REF/Nome — precisa aceitar ref/props, ex. <span>).
 * Sem foto → `ModeloResumoFoto` mostra o placeholder (hover/popover ainda abrem).
 */
export function ModeloFotoHover({
  fontes,
  nome,
  children,
  className,
}: {
  fontes: (string | null | undefined)[];
  nome?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const foto = (
    <ModeloResumoFoto fontes={fontes} nome={nome} className="h-40 w-40" />
  );
  return (
    <>
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>{children}</HoverCardTrigger>
        <HoverCardContent align="start" className="hidden w-auto p-1 md:block">
          {foto}
        </HoverCardContent>
      </HoverCard>
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
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground md:hidden",
              className,
            )}
          >
            <ImageIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-1" onClick={(e) => e.stopPropagation()}>
          {foto}
        </PopoverContent>
      </Popover>
    </>
  );
}

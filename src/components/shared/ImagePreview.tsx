import { useState } from "react";
import { ImageIcon, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// SSOT do estilo do lightbox — usado pelo ImagePreview e pelo AnexoThumbZoom (evita
// as duas caixas divergirem de novo, como aconteceu antes deste fix: bg-transparent/
// max-w-5xl duplicado nos dois lugares).
// X sempre visível (disco escuro atrás do ícone branco — contrasta em croqui claro OU
// foto escura); !opacity-100 porque o Close base (dialog.tsx) vem com opacity-70;
// h-9 w-9 = alvo de toque ~36px. max-md:w-screen/h-dvh dá área "fora" ampla no mobile
// pro clique-fora fechar (ver o container onClick dentro do ImagePreview/AnexoThumbZoom).
export const LIGHTBOX_CONTENT_CLASS =
  "max-w-5xl p-1 border-none bg-transparent shadow-none place-items-center max-md:w-screen max-md:h-dvh [&>button]:!text-white [&>button]:top-2 [&>button]:right-2 [&>button]:bg-black/60 [&>button]:rounded-full [&>button]:p-1.5 [&>button]:!opacity-100 [&>button]:h-9 [&>button]:w-9 [&>button]:flex [&>button]:items-center [&>button]:justify-center";

export function ImagePreview({ src, alt, children, className }: {
  src: string;
  alt: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const abrir = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(true);
  };
  // Ao fechar clicando FORA, o Radix desmonta o overlay no pointerdown e o click (pointerup)
  // seguinte "cai" no elemento debaixo (ex.: card clicável). Bloqueia UM click logo após.
  const bloquearProximoClick = () => {
    const block = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener("click", block, { capture: true, once: true });
    window.setTimeout(() => document.removeEventListener("click", block, true), 350);
  };
  return (
    <>
      {/* div (não <button>) p/ não ser desabilitado por um <fieldset disabled>
          ao redor — ex.: CAD travado escondia o zoom da etiqueta de lavagem. */}
      <div
        role="button"
        tabIndex={0}
        onClick={abrir}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") abrir(e); }}
        className={cn("cursor-zoom-in inline-flex", className)}
      >
        {children}
      </div>
      {/* React propaga eventos do PORTAL pela árvore de componentes: um clique no X/imagem do
          lightbox subiria até o onClick de um card ancestral (abria o detalhe ao fechar a
          foto). O wrapper (display:contents, sem impacto no layout) barra aqui. */}
      <div className="contents" onClick={(e) => e.stopPropagation()}>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            onPointerDownOutside={bloquearProximoClick}
            className={LIGHTBOX_CONTENT_CLASS}
          >
            {/* Nome acessível do diálogo (exigido pelo Radix) — só p/ leitor de tela, sem
                impacto visual (sr-only = position:absolute, fora do grid `place-items-center`). */}
            <DialogTitle className="sr-only">{alt || "Visualização de imagem"}</DialogTitle>
            {/* No mobile o Content some quase do tamanho da imagem (área "fora" minúscula —
                tocar fora quase não fechava). Este container preenche o Content
                (max-md:w-screen/h-dvh acima) e captura o toque no espaço vazio; a imagem
                dentro barra a propagação, então tocar NELA não fecha. */}
            <div className="grid place-items-center w-full h-full" onClick={() => setOpen(false)}>
              <img
                src={src}
                alt={alt}
                onClick={(e) => e.stopPropagation()}
                className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl [touch-action:pinch-zoom]"
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

/**
 * Miniatura de anexo (imagem OU PDF) com preview + zoom ao clicar — usada por
 * Croqui/Desenho Técnico/Ficha (Desenvolvimento e Planejamento). Antes vivia
 * duplicada (byte a byte) em `ModeloAnexosSection.tsx` e `criacao.planejamento.tsx`,
 * cada uma com sua própria resolução de signed URL (bucket diferente) — por isso
 * recebe `url` já resolvido em vez de `path`, e o chamador mantém seu próprio hook.
 * Não usa a mesma caixa d'água anti-bubbling do ImagePreview (bloquearProximoClick)
 * porque não fica dentro de um card clicável, só de um form/seção.
 */
export function AnexoThumbZoom({ url, isPdf, onRemove }: {
  url: string | null | undefined;
  isPdf: boolean;
  onRemove?: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  return (
    <div className="relative h-20 w-20 rounded border overflow-hidden bg-muted group">
      <div
        role="button"
        tabIndex={0}
        onClick={() => url && setZoom(true)}
        onKeyDown={(e) => { if (url && (e.key === "Enter" || e.key === " ")) setZoom(true); }}
        className="h-full w-full cursor-zoom-in flex items-center justify-center"
        title="Abrir"
      >
        {!url ? (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        ) : isPdf ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="PDF" className="h-full w-full pointer-events-none" />
        ) : (
          <img src={url} className="h-full w-full object-cover" alt="" />
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-0.5 right-0.5 bg-background/80 rounded p-0.5 opacity-0 group-hover:opacity-100 z-10"
          aria-label="Remover"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className={LIGHTBOX_CONTENT_CLASS}>
          <DialogTitle className="sr-only">Visualização de anexo</DialogTitle>
          {isPdf ? (
            <iframe src={url ?? ""} title="PDF" className="w-full h-[85vh] rounded-md bg-white" />
          ) : (
            <img src={url ?? ""} alt="" className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

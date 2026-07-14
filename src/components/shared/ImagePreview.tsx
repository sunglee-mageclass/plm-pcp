import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
            className="max-w-5xl p-1 border-none bg-transparent shadow-none [&>button]:!text-white [&>button]:top-2 [&>button]:right-2"
          >
            <img
              src={src}
              alt={alt}
              className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl"
            />
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

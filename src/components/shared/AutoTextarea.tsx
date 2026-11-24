// Textarea que CRESCE em altura conforme o conteúdo (mostra tudo sem rolar), até `maxRows` linhas; passando disso rola.
// Usada nas células de texto GRANDE das grades "Lista tipo Excel" dos cadastros (nome, composição, observações).
import { forwardRef, useCallback, useLayoutEffect, useRef, type ComponentProps } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Ajusta a altura do textarea ao conteúdo (teto de `maxRows` linhas). */
function ajustarAlturaTextarea(el: HTMLTextAreaElement | null, maxRows = 6): void {
  if (!el) return;
  el.style.height = "auto";
  const conteudo = el.scrollHeight;
  if (!conteudo) return; // sem layout (ex.: jsdom): deixa o `rows` mandar
  const cs = window.getComputedStyle(el);
  const linha = parseFloat(cs.lineHeight) || 20;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const borda = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  const teto = linha * maxRows + pad + borda;
  const alvo = conteudo + borda;
  el.style.height = `${Math.min(alvo, teto)}px`;
  el.style.overflowY = alvo > teto ? "auto" : "hidden";
}

type AutoTextareaProps = ComponentProps<typeof Textarea> & { maxRows?: number };

export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  function AutoTextarea(
    { className, onInput, maxRows = 6, rows = 2, value, ...props },
    refExterno,
  ) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    const juntarRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        ref.current = el;
        if (typeof refExterno === "function") refExterno(el);
        else if (refExterno) refExterno.current = el;
      },
      [refExterno],
    );
    // reajusta também quando o valor muda "de fora" (colagem em lote, desfazer, recarga) — não só ao digitar
    useLayoutEffect(() => {
      ajustarAlturaTextarea(ref.current, maxRows);
    }, [value, maxRows]);
    return (
      <Textarea
        ref={juntarRef}
        rows={rows}
        value={value}
        className={cn("resize-none overflow-hidden leading-snug", className)}
        onInput={(e) => {
          ajustarAlturaTextarea(e.currentTarget, maxRows);
          onInput?.(e);
        }}
        {...props}
      />
    );
  },
);

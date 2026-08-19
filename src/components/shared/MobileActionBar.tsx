import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Barra fixa no rodapé SÓ no mobile (<sm) com a(s) ação(ões) primária(s) da página
 * (e o "voltar" onde fizer sentido). No desktop fica escondida — a ação continua no
 * header, na altura do título.
 *
 * É renderizada via PORTAL no body: a sidebar (e outros ancestrais com transform/contain)
 * vira "containing block" de elementos `fixed`, fazendo a barra descolar do fundo do
 * viewport quando o conteúdo rola. O portal garante que ela fique sempre colada embaixo.
 *
 * Padrão de uso:
 *  - No container da página, adicione `max-sm:pb-24` (pra o conteúdo não ficar atrás da barra).
 *  - No botão de ação do header, adicione `max-sm:hidden` (some no mobile).
 *  - Renderize <MobileActionBar> ao final da página com a versão mobile da ação (+ voltar).
 */
export function MobileActionBar({ children, breakpoint = "sm" }: { children: ReactNode; breakpoint?: "sm" | "md" }) {
  if (typeof document === "undefined") return null; // SSR guard
  return createPortal(
    <div
      className={`${breakpoint === "md" ? "md:hidden" : "sm:hidden"} fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-background p-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]`}
    >
      {children}
    </div>,
    document.body,
  );
}

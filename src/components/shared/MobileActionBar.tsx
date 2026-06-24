import type { ReactNode } from "react";

/**
 * Barra fixa no rodapé SÓ no mobile (<sm) com a(s) ação(ões) primária(s) da página
 * (e o "voltar" onde fizer sentido). No desktop fica escondida — a ação continua no
 * header, na altura do título.
 *
 * Padrão de uso:
 *  - No container da página, adicione `max-sm:pb-24` (pra o conteúdo não ficar atrás da barra).
 *  - No botão de ação do header, adicione `max-sm:hidden` (some no mobile).
 *  - Renderize <MobileActionBar> ao final da página com a versão mobile da ação (+ voltar).
 */
export function MobileActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sm:hidden fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-background p-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      {children}
    </div>
  );
}

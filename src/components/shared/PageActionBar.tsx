import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Barra de ações fixa no rodapé para PÁGINAS INTEIRAS de edição/formulário
 * (Config da Loja, CQ, Direcionamento, Identidade…), visível em TODOS os tamanhos.
 *
 * Diferente do `MobileActionBar` (que é só-mobile via `sm:hidden`): aqui a barra
 * fica no rodapé também no desktop — padrão do sistema para telas de edição.
 *
 * Renderizada via PORTAL no body: ancestrais com `transform`/`contain` (ex.: a
 * sidebar) viram "containing block" de elementos `fixed`, o que descolaria a barra
 * do fundo do viewport. O portal garante que ela fique sempre colada embaixo.
 *
 * Uso: no container da página adicione `pb-24` (ou `pb-28`) p/ o conteúdo não
 * ficar atrás da barra; renderize <PageActionBar> ao final com os botões.
 */
export function PageActionBar({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null; // SSR guard
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-background p-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] sm:px-6">
      {children}
    </div>,
    document.body,
  );
}

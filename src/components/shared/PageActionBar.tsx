import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

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
 * ⚠️ Por ser portalada pro `document.body`, ela NÃO herda `var(--sidebar-width)`
 * por CSS normal (a variável é setada no wrapper do `SidebarProvider`, que é
 * ANCESTRAL do body, não descendente — CSS custom property não "vaza pro lado").
 * O portal continua dentro da árvore de CONTEXTO do React (só o DOM de destino
 * muda), então lê o estado ao vivo via `useSidebar()` e aplica o offset esquerdo
 * em classes Tailwind fixas que espelham `SIDEBAR_WIDTH`/`SIDEBAR_WIDTH_ICON`
 * (`16rem`/`3rem` = `left-64`/`left-12`) — só a partir de `md:` (no mobile a
 * sidebar é off-canvas/overlay, a barra fica full-width como já era).
 *
 * Uso: no container da página adicione `pb-24` (ou `pb-28`) p/ o conteúdo não
 * ficar atrás da barra; renderize <PageActionBar> ao final com os botões.
 */
export function PageActionBar({ children }: { children: ReactNode }) {
  const { state } = useSidebar();
  if (typeof document === "undefined") return null; // SSR guard
  return createPortal(
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t bg-background p-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] transition-[left] duration-200 ease-linear sm:px-6",
        state === "collapsed" ? "md:left-12" : "md:left-64",
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

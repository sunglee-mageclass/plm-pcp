import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Renderiza o conteúdo de impressão num PORTAL no <body>. Sem isso, a `.print-area`
 * (position:absolute) fica relativa ao layout (deslocado pela sidebar), saindo
 * torta/à direita na impressão. No body ela ancora na PÁGINA (full-width). Só
 * aparece na impressão (CSS .print-area).
 */
export function PrintArea({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className="print-area">{children}</div>, document.body);
}

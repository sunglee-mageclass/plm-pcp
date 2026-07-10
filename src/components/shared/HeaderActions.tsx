import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renderiza ações da PÁGINA dentro do header STICKY do layout (ao lado do nome do
 * módulo). O layout expõe um slot `#sticky-header-actions`; a página portaliza aqui.
 * Pega o elemento por EFEITO (o slot é do layout, montado antes; no 1º render do
 * filho o DOM ainda não commitou → busca após o mount). Some quando a página desmonta.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setEl(document.getElementById("sticky-header-actions"));
    return () => setEl(null);
  }, []);
  return el ? createPortal(children, el) : null;
}

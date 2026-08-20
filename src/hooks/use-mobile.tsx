import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

// Valor inicial SÍNCRONO (não mais `undefined`→`false` até o 1º useEffect): sem isso o
// 1º paint renderizava SEMPRE o ramo desktop por 1+ frame (dashboard: grids largos +
// recharts) e só depois saltava pros cards do mobile — o "flash" do layout desktop no
// celular. Guarda SSR (`typeof window`) por robustez, mas na prática todos os consumidores
// vivem sob `_authenticated` (`ssr:false`, client-only) — não há hidratação a divergir.
function matchesMobile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(matchesMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

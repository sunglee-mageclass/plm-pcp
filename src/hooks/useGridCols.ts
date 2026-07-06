import { useCallback, useEffect, useState, type RefObject } from "react";
import { useAuth } from "@/hooks/useAuth";

// Classes literais (o Tailwind não pode purgar): mobile sempre 2 colunas;
// desktop (lg) de 4 a 10 conforme a escolha do usuário.
export const GRID_COLS_OPTIONS = [4, 5, 6, 7, 8, 9, 10] as const;
export const GRID_COLS_CLASS: Record<number, string> = {
  4: "grid gap-4 grid-cols-2 lg:grid-cols-4",
  5: "grid gap-4 grid-cols-2 lg:grid-cols-5",
  6: "grid gap-4 grid-cols-2 lg:grid-cols-6",
  7: "grid gap-4 grid-cols-2 lg:grid-cols-7",
  8: "grid gap-4 grid-cols-2 lg:grid-cols-8",
  9: "grid gap-4 grid-cols-2 lg:grid-cols-9",
  10: "grid gap-4 grid-cols-2 lg:grid-cols-10",
};

const MIN = 4;
const MAX = 10;

/**
 * Quantidade de colunas do grid, lembrada POR USUÁRIO (localStorage). Mobile fica
 * fixo em 2; o valor controla só o desktop. Use com GRID_COLS_CLASS[cols].
 *
 * `alwaysReset`: quando true, ignora o localStorage e SEMPRE começa no `fallback` a
 * cada acesso à tela (não persiste a escolha). Usado no Planejamento, que deve abrir
 * sempre com 5 colunas.
 */
export function useGridCols(pageKey: string, fallback = 4, alwaysReset = false) {
  const { user } = useAuth();
  const storageKey = `gridcols:${pageKey}:${user?.id ?? "anon"}`;
  const [cols, setColsState] = useState<number>(fallback);

  // Recarrega a preferência quando o usuário (chave) resolve. Com alwaysReset,
  // volta ao fallback (não lê a preferência salva).
  useEffect(() => {
    if (alwaysReset) { setColsState(fallback); return; }
    if (typeof window === "undefined") return;
    const v = Number(window.localStorage.getItem(storageKey));
    setColsState(Number.isFinite(v) && v >= MIN && v <= MAX ? v : fallback);
  }, [storageKey, fallback, alwaysReset]);

  const setCols = useCallback(
    (n: number) => {
      const c = Math.max(MIN, Math.min(MAX, n));
      setColsState(c);
      if (alwaysReset) return; // escolha vale só na sessão atual; não persiste
      try {
        window.localStorage.setItem(storageKey, String(c));
      } catch {
        /* ignore */
      }
    },
    [storageKey, alwaysReset],
  );

  return [cols, setCols] as const;
}

/**
 * Mede a largura real de cada card (largura do grid / colunas efetivas) e diz se
 * deve ficar "compacto" (só imagem, sem descrições) — porque, com muitas colunas
 * na tela do usuário, os cards ficam estreitos demais. Mobile usa 2 colunas.
 */
export function useCompactCards(ref: RefObject<HTMLElement | null>, cols: number, threshold = 170) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const recompute = () => {
      const w = el.clientWidth;
      if (!w) return;
      const effCols = window.innerWidth < 1024 ? 2 : cols; // lg: usa cols; abaixo: 2
      const gap = 16; // gap-4
      const cardW = (w - (effCols - 1) * gap) / effCols;
      setCompact(cardW < threshold);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cols, threshold]);
  return compact;
}

import { useCallback, useEffect, useState } from "react";
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
 */
export function useGridCols(pageKey: string, fallback = 4) {
  const { user } = useAuth();
  const storageKey = `gridcols:${pageKey}:${user?.id ?? "anon"}`;
  const [cols, setColsState] = useState<number>(fallback);

  // Recarrega a preferência quando o usuário (chave) resolve.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = Number(window.localStorage.getItem(storageKey));
    setColsState(Number.isFinite(v) && v >= MIN && v <= MAX ? v : fallback);
  }, [storageKey, fallback]);

  const setCols = useCallback(
    (n: number) => {
      const c = Math.max(MIN, Math.min(MAX, n));
      setColsState(c);
      try {
        window.localStorage.setItem(storageKey, String(c));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  return [cols, setCols] as const;
}

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook para largura arrastável persistida em localStorage.
 *
 * @param key    Chave de localStorage
 * @param def    Largura padrão (px)
 * @param min    Mínimo (px)
 * @param max    Máximo (px)
 * @param invert Se true, arrastar para a ESQUERDA aumenta a largura (para coluna à direita)
 */
export function useResizableWidth(
  key: string,
  def: number,
  min: number,
  max: number,
  invert = false,
) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return def;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = Number(raw);
        if (!isNaN(parsed)) return Math.min(max, Math.max(min, parsed));
      }
    } catch {
      /* quota/privado: ignora */
    }
    return def;
  });

  const persist = useCallback(
    (w: number) => {
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(key, String(w));
      } catch {
        /* best-effort */
      }
    },
    [key],
  );

  const startXRef = useRef(0);
  const startWRef = useRef(width);
  // Sync ref on every render so closure always has latest value
  startWRef.current = width;

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      const capturedW = startWRef.current;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current;
        const novo = Math.min(
          max,
          Math.max(min, invert ? capturedW - delta : capturedW + delta),
        );
        setWidth(novo);
      };

      const onUp = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current;
        const novo = Math.min(
          max,
          Math.max(min, invert ? capturedW - delta : capturedW + delta),
        );
        setWidth(novo);
        persist(novo);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    // min/max/invert/persist are stable; startXRef/startWRef are refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, invert, persist],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return { width, startDrag };
}

// ─── Colunas da lista de cores ────────────────────────────────────────────────

export type CorCols = { pecas: number; metragem: number };

const COR_DEFAULTS: CorCols = { pecas: 56, metragem: 84 };
const COR_MIN = 40;
const COR_MAX = 200;

/**
 * Hook para as colunas Peças e Metragem da lista de cores,
 * compartilhadas entre todos os mini-cards e persistidas em localStorage.
 */
export function useCorCols(key: string): {
  cols: CorCols;
  startDragPecas: (e: React.PointerEvent) => void;
  startDragMetragem: (e: React.PointerEvent) => void;
} {
  const [cols, setCols] = useState<CorCols>(() => {
    if (typeof window === "undefined") return COR_DEFAULTS;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Partial<CorCols>;
        return {
          pecas: Math.min(COR_MAX, Math.max(COR_MIN, Number(parsed.pecas) || COR_DEFAULTS.pecas)),
          metragem: Math.min(
            COR_MAX,
            Math.max(COR_MIN, Number(parsed.metragem) || COR_DEFAULTS.metragem),
          ),
        };
      }
    } catch {
      /* best-effort */
    }
    return COR_DEFAULTS;
  });

  const colsRef = useRef(cols);
  colsRef.current = cols;

  const persistCols = useCallback(
    (c: CorCols) => {
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(c));
      } catch {
        /* best-effort */
      }
    },
    [key],
  );

  const makeDrag = useCallback(
    (field: keyof CorCols, invert: boolean) =>
      (e: React.PointerEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const capturedW = colsRef.current[field];
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";

        const onMove = (ev: PointerEvent) => {
          const delta = ev.clientX - startX;
          const novo = Math.min(
            COR_MAX,
            Math.max(COR_MIN, invert ? capturedW - delta : capturedW + delta),
          );
          setCols((prev) => ({ ...prev, [field]: novo }));
        };

        const onUp = (ev: PointerEvent) => {
          const delta = ev.clientX - startX;
          const novo = Math.min(
            COR_MAX,
            Math.max(COR_MIN, invert ? capturedW - delta : capturedW + delta),
          );
          setCols((prev) => {
            const next = { ...prev, [field]: novo };
            persistCols(next);
            return next;
          });
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
    [persistCols],
  );

  const startDragPecas = useCallback(
    (e: React.PointerEvent) => makeDrag("pecas", true)(e),
    [makeDrag],
  );
  const startDragMetragem = useCallback(
    (e: React.PointerEvent) => makeDrag("metragem", true)(e),
    [makeDrag],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return { cols, startDragPecas, startDragMetragem };
}

import { useCallback, useRef, useState } from "react";

/** Serializa de forma estável o bastante para comparar estados de formulário. */
export function serializeSnapshot(v: unknown): string {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return String(v);
  }
}

/** Dois estados de formulário são equivalentes (nenhuma alteração)? */
export function snapshotsEqual(a: unknown, b: unknown): boolean {
  return serializeSnapshot(a) === serializeSnapshot(b);
}

/**
 * Detecta alterações não salvas comparando o estado atual do formulário com um
 * instantâneo (baseline). O baseline é tirado na primeira renderização e sempre
 * que `markClean()`/`reset()` é chamado.
 *
 * Uso típico:
 *   const { dirty, markClean } = useDirtySnapshot({ nome, preco, cor });
 *   // após salvar com sucesso: markClean();
 *
 * Dados assíncronos (o formulário é semeado depois de uma query): chame
 * `reset(valorCarregado)` no mesmo ponto em que o estado é semeado, para que o
 * baseline reflita os dados carregados (e não o formulário vazio inicial).
 *
 * Telas que já rastreiam um booleano `dirty` próprio não precisam deste hook —
 * passam o próprio `dirty` direto para `useUnsavedGuard`.
 */
export function useDirtySnapshot<T>(value: T) {
  const baseline = useRef<string | null>(null);
  if (baseline.current === null) baseline.current = serializeSnapshot(value);
  const [, force] = useState(0);

  const markClean = useCallback(() => {
    baseline.current = serializeSnapshot(value);
    force((n) => n + 1);
  }, [value]);

  const reset = useCallback((next?: T) => {
    baseline.current = serializeSnapshot(next === undefined ? value : next);
    force((n) => n + 1);
  }, [value]);

  const dirty = serializeSnapshot(value) !== baseline.current;
  return { dirty, markClean, reset };
}

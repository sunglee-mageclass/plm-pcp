import { useCallback, useRef, useState } from "react";

/**
 * `JSON.stringify` com as chaves de OBJETO em ordem alfabética, em qualquer profundidade. A ordem das chaves de um objeto não
 * é significativa (o Postgres `jsonb` a reordena ao gravar — o servidor devolve o mesmo valor em outra ordem, e isso não é
 * "alteração"). Arrays PRESERVAM a ordem (é significativa: ordem das colunas do kanban etc.), nenhuma chave é descartada e o
 * resto da semântica do `JSON.stringify` (undefined omitido, `toJSON`, números) é o de sempre — só o objeto simples é copiado
 * com as chaves ordenadas (pelo `replacer`, que roda DEPOIS do `toJSON` e em cada nível). Pode lançar (ciclo): quem chama trata.
 */
export function stringifyEstavel(v: unknown): string {
  return JSON.stringify(v, (_chave, valor) => {
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      const proto = Object.getPrototypeOf(valor);
      if (proto === Object.prototype || proto === null) {
        const ordenado: Record<string, unknown> = {};
        for (const k of Object.keys(valor).sort()) ordenado[k] = (valor as Record<string, unknown>)[k];
        return ordenado;
      }
    }
    return valor;
  });
}

/** Serializa de forma estável o bastante para comparar estados de formulário (chaves de objeto em ordem; arrays intactos). */
export function serializeSnapshot(v: unknown): string {
  try {
    return stringifyEstavel(v ?? null);
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

  // markClean/reset só forçam re-render se o baseline REALMENTE mudou. Isso torna as
  // duas idempotentes e evita loop infinito quando chamadas dentro de um effect cujas
  // dependências trocam de identidade a cada render (ex.: `query = {}` como default).
  const markClean = useCallback(() => {
    const s = serializeSnapshot(value);
    if (baseline.current !== s) {
      baseline.current = s;
      force((n) => n + 1);
    }
  }, [value]);

  const reset = useCallback((next?: T) => {
    const s = serializeSnapshot(next === undefined ? value : next);
    if (baseline.current !== s) {
      baseline.current = s;
      force((n) => n + 1);
    }
  }, [value]);

  const dirty = serializeSnapshot(value) !== baseline.current;
  return { dirty, markClean, reset };
}

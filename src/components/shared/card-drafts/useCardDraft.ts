import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCardDraftsRegistry } from "./CardDraftsProvider";

/**
 * Rascunho por card ("Salvar por card", Onda 2 da Camada intermediária): estado local + campos tocados.
 * `salvarFn` recebe SÓ os campos tocados (e a base de onde o rascunho partiu); a tela decide como gravar.
 * Registra-se no `CardDraftsProvider` (se houver) para a barra "Salvar todos (N)" e a guarda da página.
 */
export function useCardDraft<T extends Record<string, any>>(opts: {
  id: string;
  base: T;
  salvarFn: (mudancas: Partial<T>, base: T) => Promise<void>;
  onSalvo?: () => void;
}) {
  const { id, base, salvarFn, onSalvo } = opts;
  const [valor, setValor] = useState<T>(base);
  const [tocados, setTocados] = useState<Set<keyof T>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const baseRef = useRef(base);
  // re-ancora quando a base do servidor muda E o card está limpo (refetch/realtime; Task 5 refina o merge sujo)
  useEffect(() => {
    baseRef.current = base;
    if (tocados.size === 0) setValor(base);
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useCallback((campo: keyof T, v: T[keyof T]) => {
    setValor((old) => ({ ...old, [campo]: v }));
    setTocados((old) => {
      const n = new Set(old);
      if (Object.is(v, baseRef.current[campo])) n.delete(campo);
      else n.add(campo);
      return n;
    });
  }, []);

  const descartar = useCallback(() => { setValor(baseRef.current); setTocados(new Set()); }, []);

  const salvar = useCallback(async () => {
    if (tocados.size === 0) return;
    const mudancas: Partial<T> = {};
    for (const k of tocados) mudancas[k] = valor[k];
    setSalvando(true);
    try {
      await salvarFn(mudancas, baseRef.current);
      setTocados(new Set());
      onSalvo?.();
    } finally { setSalvando(false); }
  }, [tocados, valor, salvarFn, onSalvo]);

  const dirty = tocados.size > 0;
  const api = useMemo(() => ({ dirty, salvar, descartar }), [dirty, salvar, descartar]);
  const reg = useCardDraftsRegistry();
  useEffect(() => { reg?.registrar(id, api); return () => reg?.desregistrar(id); }, [id, api, reg]);

  return { valor, dirty, patch, salvar, descartar, salvando, conflitos: [] as Array<keyof T> };
}

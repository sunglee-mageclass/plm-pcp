import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCardDraftsRegistry } from "./CardDraftsProvider";

/**
 * Rascunho por card ("Salvar por card", Onda 2 da Camada intermediária): estado local + campos tocados.
 * `salvarFn` recebe SÓ os campos tocados (e a base de onde o rascunho partiu); a tela decide como gravar.
 * Registra-se no `CardDraftsProvider` (se houver) para a barra "Salvar todos (N)" e a guarda da página.
 *
 * `base` deve ser ESTÁVEL entre renders enquanto o servidor não mudar (memoize o objeto na tela): uma identidade nova
 * a cada render re-ancora o card limpo toda vez.
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
  // Espelho síncrono do `valor`: o `salvar` o relê ao terminar para saber o que a pessoa editou com o salvar em voo.
  const valorRef = useRef<T>(base);
  const aplicaValor = useCallback((v: T) => { valorRef.current = v; setValor(v); }, []);

  // re-ancora quando a base do servidor muda E o card está limpo (refetch/realtime; Task 5 refina o merge sujo)
  useEffect(() => {
    baseRef.current = base;
    if (tocados.size === 0) aplicaValor(base);
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useCallback((campo: keyof T, v: T[keyof T]) => {
    aplicaValor({ ...valorRef.current, [campo]: v });
    setTocados((old) => {
      const n = new Set(old);
      if (Object.is(v, baseRef.current[campo])) n.delete(campo);
      else n.add(campo);
      return n;
    });
  }, [aplicaValor]);

  const descartar = useCallback(() => { aplicaValor(baseRef.current); setTocados(new Set()); }, [aplicaValor]);

  const salvar = useCallback(async () => {
    if (tocados.size === 0) return;
    const mudancas: Partial<T> = {};
    for (const k of tocados) mudancas[k] = valorRef.current[k];
    setSalvando(true);
    try {
      await salvarFn(mudancas, baseRef.current);
      // Sucesso: a base local passa a ser o que foi ENVIADO (só esses campos) — vale mesmo sem refetch da tela.
      baseRef.current = { ...baseRef.current, ...mudancas };
      // Só sai de `tocados` o campo enviado cujo valor atual ainda é o enviado; o editado EM VOO (ou revertido em voo
      // ao valor antigo da base) continua tocado, pois difere da base nova.
      setTocados((old) => {
        const n = new Set(old);
        for (const k of Object.keys(mudancas) as Array<keyof T>) {
          if (Object.is(valorRef.current[k], mudancas[k])) n.delete(k);
          else n.add(k);
        }
        return n;
      });
      onSalvo?.();
    } finally { setSalvando(false); }
  }, [tocados, salvarFn, onSalvo]);

  const dirty = tocados.size > 0;
  // O objeto registrado só muda com `dirty`: os métodos leem a versão mais recente por ref (salvarFn inline na tela
  // não gera re-registro a cada render).
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  const descartarRef = useRef(descartar);
  descartarRef.current = descartar;
  const api = useMemo(() => ({ dirty, salvar: () => salvarRef.current(), descartar: () => descartarRef.current() }), [dirty]);
  const reg = useCardDraftsRegistry();
  // Deps = funções ESTÁVEIS (useCallback no provider), não o `reg` inteiro (recriado a cada mudança de `nSujos`).
  const registrar = reg?.registrar;
  const desregistrar = reg?.desregistrar;
  useEffect(() => { registrar?.(id, api); return () => desregistrar?.(id); }, [id, api, registrar, desregistrar]);

  return { valor, dirty, patch, salvar, descartar, salvando, conflitos: [] as Array<keyof T> };
}

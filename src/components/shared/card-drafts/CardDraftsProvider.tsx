import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type CardApi = { dirty: boolean; salvar: () => Promise<void>; descartar: () => void };
type Registry = {
  registrar: (id: string, api: CardApi) => void;
  desregistrar: (id: string) => void;
  nSujos: number;
  salvarTodos: () => Promise<{ ok: number; erro: number }>;
  descartarTodos: () => void;
};
const Ctx = createContext<Registry | null>(null);
export const useCardDraftsRegistry = () => useContext(Ctx);
export const useCardDrafts = () => {
  const r = useContext(Ctx);
  if (!r) throw new Error("useCardDrafts fora do CardDraftsProvider");
  return r;
};

export function CardDraftsProvider({ children }: { children: React.ReactNode }) {
  const mapa = useRef(new Map<string, CardApi>());
  const [nSujos, setNSujos] = useState(0);
  const recomputa = useCallback(() => {
    let n = 0; mapa.current.forEach((a) => { if (a.dirty) n++; }); setNSujos(n);
  }, []);
  const registrar = useCallback((id: string, api: CardApi) => { mapa.current.set(id, api); recomputa(); }, [recomputa]);
  const desregistrar = useCallback((id: string) => { mapa.current.delete(id); recomputa(); }, [recomputa]);
  const salvarTodos = useCallback(async () => {
    let ok = 0, erro = 0;
    for (const api of mapa.current.values()) {
      if (!api.dirty) continue;
      try { await api.salvar(); ok++; } catch { erro++; }
    }
    recomputa();
    return { ok, erro };
  }, [recomputa]);
  const descartarTodos = useCallback(() => { mapa.current.forEach((a) => a.dirty && a.descartar()); recomputa(); }, [recomputa]);
  const value = useMemo<Registry>(() => ({ registrar, desregistrar, nSujos, salvarTodos, descartarTodos }), [registrar, desregistrar, nSujos, salvarTodos, descartarTodos]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

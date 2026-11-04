import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/** Contexto do "salvar todos", repassado a cada card (ex.: UM prazo comum para esperar prévias, em vez de um por card). */
export type SalvarCtx = { limite?: number };
type CardApi = { dirty: boolean; salvar: (ctx?: SalvarCtx) => Promise<void>; descartar: () => void };
type Registry = {
  registrar: (id: string, api: CardApi) => void;
  desregistrar: (id: string) => void;
  nSujos: number;
  salvarTodos: (ctx?: SalvarCtx) => Promise<{ ok: number; erro: number }>;
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
  // Itera um SNAPSHOT (o Map muda ao vivo quando um card re-registra) e relê cada id antes de agir: só salva/descarta
  // quem ainda existe e continua sujo — nunca visita a mesma chave 2x.
  const salvarTodos = useCallback(async (ctx?: SalvarCtx) => {
    let ok = 0, erro = 0;
    for (const [cid] of Array.from(mapa.current.entries())) {
      const api = mapa.current.get(cid);
      if (!api || !api.dirty) continue;
      try { await api.salvar(ctx); ok++; } catch { erro++; }
    }
    recomputa();
    return { ok, erro };
  }, [recomputa]);
  const descartarTodos = useCallback(() => {
    for (const [cid] of Array.from(mapa.current.entries())) {
      const api = mapa.current.get(cid);
      if (api && api.dirty) api.descartar();
    }
    recomputa();
  }, [recomputa]);
  const value = useMemo<Registry>(() => ({ registrar, desregistrar, nSujos, salvarTodos, descartarTodos }), [registrar, desregistrar, nSujos, salvarTodos, descartarTodos]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

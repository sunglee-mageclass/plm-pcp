// Hook da co-edição ao vivo (Onda 3). NÃO abre canal — usa o canal que o useColabRegistro já abriu
// (`realtime:${chave}`), garantindo "nenhum canal novo". Degrada gracioso sem canal (no-op).
// O hook só TRANSPORTA o `path` que recebe de quem chama (id:/name:/lbl:) — não deriva nem assume prefixo.
// Spec: docs/superpowers/specs/2026-11-18-coedicao-onda3-lock-overlay-design.md
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { criarThrottle, EXPIRACAO_LOCK_MS, HEARTBEAT_MS, THROTTLE_MS, type LockInfo } from "@/lib/colab/coedicao";

type MsgLock = { key?: string; path?: string | null; ts?: number };
type MsgValor = { key?: string; path?: string; valor?: string };
type Canal = NonNullable<ReturnType<typeof supabase.getChannels>[number]>;

const LIMPEZA_MS = 2_000;

export function useCoedicaoAoVivo(o: { chave: string | null; meuKey: string }) {
  const [locks, setLocks] = useState<LockInfo[]>([]);
  const [valorAoVivoPorPath, setValor] = useState<Record<string, string>>({});
  const meuPathRef = useRef<string | null>(null);
  const throttlesRef = useRef<Map<string, ReturnType<typeof criarThrottle<string>>>>(new Map());
  // Canal ao qual JÁ anexei os handlers (o useColabRegistro pode abrir/recriar o canal depois do 1º render).
  const anexadoRef = useRef<Canal | null>(null);

  const canal = useCallback((): Canal | null => {
    if (!o.chave) return null;
    return supabase.getChannels().find((c) => c.topic === `realtime:${o.chave}`) ?? null;
  }, [o.chave]);

  // Assina os eventos do par no canal já aberto (re-tenta a cada ciclo se o canal ainda não existe / foi recriado)
  // + limpa locks expirados periodicamente.
  useEffect(() => {
    if (!o.chave) return;
    anexadoRef.current = null;
    const anexar = () => {
      const ch = canal();
      if (!ch || ch === anexadoRef.current) return;
      anexadoRef.current = ch;
      ch.on("broadcast", { event: "campoLock" }, (msg: { payload: MsgLock }) => {
        const p = msg.payload;
        if (!p?.key || p.key === o.meuKey) return;
        setLocks((prev) => {
          const semEle = prev.filter((l) => l.key !== p.key);
          return p.path ? [...semEle, { key: p.key!, path: p.path, ts: p.ts ?? Date.now() }] : semEle;
        });
      });
      ch.on("broadcast", { event: "valorAoVivo" }, (msg: { payload: MsgValor }) => {
        const p = msg.payload;
        if (!p?.key || p.key === o.meuKey || !p.path) return;
        setValor((prev) => ({ ...prev, [p.path!]: p.valor ?? "" }));
      });
    };
    anexar();
    const limpeza = setInterval(() => {
      anexar();
      const agora = Date.now();
      setLocks((prev) => {
        // `>=` no varredor (a lib usa `>` na resolução): o tick de 10 s já limpa o lock de ts=0, sem esperar o de 12 s.
        // O estado devolve `prev` quando nada expirou = sem re-render.
        const vivos = prev.filter((l) => agora - l.ts < EXPIRACAO_LOCK_MS);
        return vivos.length === prev.length ? prev : vivos;
      });
    }, LIMPEZA_MS);
    return () => { clearInterval(limpeza); anexadoRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.chave, o.meuKey]);

  // Heartbeat: re-anuncia meu lock enquanto houver path ativo.
  useEffect(() => {
    if (!o.chave) return;
    const hb = setInterval(() => {
      const path = meuPathRef.current;
      const ch = canal();
      if (path && ch) void ch.send({ type: "broadcast", event: "campoLock", payload: { key: o.meuKey, path, ts: Date.now() } });
    }, HEARTBEAT_MS);
    return () => clearInterval(hb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.chave, o.meuKey]);

  // Ao trocar de chave/aba: solta throttles pendentes e o lock local.
  useEffect(() => () => {
    for (const t of throttlesRef.current.values()) t.soltar();
    throttlesRef.current.clear();
    meuPathRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.chave, o.meuKey]);

  const anunciarLock = useCallback((path: string | null) => {
    meuPathRef.current = path;
    const ch = canal();
    if (ch) void ch.send({ type: "broadcast", event: "campoLock", payload: { key: o.meuKey, path, ts: Date.now() } });
  }, [canal, o.meuKey]);

  const emitirValor = useCallback((path: string, valor: string) => {
    if (!o.chave) return;
    let t = throttlesRef.current.get(path);
    if (!t) {
      t = criarThrottle<string>((v) => {
        const ch = canal();
        if (ch) void ch.send({ type: "broadcast", event: "valorAoVivo", payload: { key: o.meuKey, path, valor: v } });
      }, THROTTLE_MS);
      throttlesRef.current.set(path, t);
    }
    t.enviar(valor);
  }, [canal, o.chave, o.meuKey]);

  if (!o.chave) return { locks: [] as LockInfo[], valorAoVivoPorPath: {} as Record<string, string>, anunciarLock, emitirValor };
  return { locks, valorAoVivoPorPath, anunciarLock, emitirValor };
}

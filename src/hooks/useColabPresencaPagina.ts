// Presença colaborativa NO NÍVEL DA PÁGINA/CANVAS (set/2026) — versão enxuta do `useColabRegistro`
// para superfícies de LISTA (canvas de cards) onde não há um "registro" único aberto: 1 canal por
// página (ex.: `colab-canvas:planejamento:<colecao>`), presença de quem está na tela + qual campo cada
// aba foca. NÃO tem `postgres_changes` (o "realtime leve" já invalida as listas — ver
// `useRealtimeInvalidation`); é SÓ presença/foco para o ring por campo dos cards.
//
// Reusa o MESMO padrão comprovado do `useColabRegistro`:
//   - presença carrega só o dado ESTÁVEL {nome} (join), propaga bem;
//   - o `campoFocado` (efêmero) trafega por BROADCAST (`self:false`) — o re-track de presença do
//     realtime-js 2.108 não propaga meta editada aos pares (ver cabeçalho do useColabRegistro);
//   - presença POR ABA (`userId::abaId`) p/ 2 abas do mesmo user se verem;
//   - late-joiner re-emite o foco no presence sync; `pedirEco` + visibilitychange cobrem a aba que
//     ficou em background (WS estrangulado perde broadcasts).
// O `campoFocado` aqui codifica o CARD + o campo, ex.: `card-preco:<modeloId>` — o
// `<ColabPresenceOverlay>` acha o elemento por `[data-colab-path]` e desenha o anel.
//
// Retorna o MESMO shape `PresencaColab[]` do useColabRegistro, então o ColabBanner e o overlay
// funcionam sem mudança.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { PresencaColab } from "@/hooks/useColabRegistro";

export function useColabPresencaPagina(o: {
  canal: string | null;          // null = desliga (ex.: enquanto a coleção não resolveu)
  campoFocado?: string | null;   // `<campo>:<id>` do card focado nesta aba (ou null)
}): { presentes: PresencaColab[] } {
  const { user } = useAuth();
  const [presentes, setPresentes] = useState<PresencaColab[]>([]);

  // Chave de presença ÚNICA POR ABA (idêntico ao useColabRegistro) — 2 abas do mesmo user se veem.
  const abaIdRef = useRef<string>("");
  if (!abaIdRef.current) {
    abaIdRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  const presenceKey = user ? `${user.id}::${abaIdRef.current}` : "";

  const { data: meuNome } = useQuery({
    queryKey: ["colab-meu-nome", user?.id],
    enabled: !!user,
    staleTime: Infinity,
    queryFn: async () =>
      (await supabase.from("users").select("nome").eq("id", user!.id).maybeSingle()).data?.nome
      ?? user!.email ?? "Alguém",
  });

  const chave = useMemo(() => (o.canal && user ? o.canal : null), [o.canal, user]);

  const focosRef = useRef<Map<string, string | null>>(new Map());
  const nomesRef = useRef<Map<string, string>>(new Map());
  const meuFocoRef = useRef<string | null>(o.campoFocado ?? null);

  const rebuildRef = useRef<() => void>(() => {});
  rebuildRef.current = () => {
    setPresentes(
      [...nomesRef.current.entries()]
        .filter(([key]) => key !== presenceKey)
        .map(([key, nome]) => ({
          userId: key.split("::")[0],
          nome,
          campoFocado: focosRef.current.get(key) ?? null,
        })),
    );
  };

  useEffect(() => {
    if (!chave || !meuNome) return;
    const remanescente = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
    if (remanescente) void supabase.removeChannel(remanescente);
    focosRef.current = new Map();
    nomesRef.current = new Map();
    const ch = supabase.channel(chave, {
      config: { presence: { key: presenceKey }, broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "campoFocado" }, (msg) => {
      const p = msg.payload as { key?: string; campoFocado?: string | null; pedirEco?: boolean } | undefined;
      if (!p?.key || p.key === presenceKey) return;
      if (p.pedirEco && meuFocoRef.current) {
        void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: meuFocoRef.current } });
      }
      if (p.pedirEco && p.campoFocado == null) return;
      focosRef.current.set(p.key, p.campoFocado ?? null);
      rebuildRef.current();
    });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ nome: string }>();
      const keys = new Set(Object.keys(state));
      nomesRef.current = new Map(Object.entries(state).map(([k, metas]) => [k, metas[0]?.nome ?? "Alguém"]));
      for (const k of [...focosRef.current.keys()]) if (!keys.has(k)) focosRef.current.delete(k);
      rebuildRef.current();
      if (meuFocoRef.current) {
        void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: meuFocoRef.current } });
      }
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void ch.track({ nome: meuNome });
        void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: meuFocoRef.current } });
      }
    });
    return () => { void supabase.removeChannel(ch); setPresentes([]); };
  }, [chave, meuNome, presenceKey]);

  // Emite o foco quando muda (sem recriar o canal).
  useEffect(() => {
    meuFocoRef.current = o.campoFocado ?? null;
    if (!chave || !meuNome) return;
    const ch = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
    if (ch) void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: o.campoFocado ?? null } });
  }, [o.campoFocado, chave, meuNome, presenceKey]);

  // Aba que volta do background re-anuncia o foco + pede eco (perdeu broadcasts em bg).
  useEffect(() => {
    if (!chave || !meuNome) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const ch = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
      if (!ch) return;
      void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: meuFocoRef.current } });
      void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: null, pedirEco: true } });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [chave, meuNome, presenceKey]);

  return { presentes };
}

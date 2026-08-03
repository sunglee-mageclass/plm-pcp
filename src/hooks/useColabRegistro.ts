// Canal colaborativo por registro-agregado (spec 2026-08-03):
// 1) postgres_changes (UPDATE na linha-RAIZ — os bumps de filha garantem o evento)
//    → onMudancaServidor() (a tela re-busca e faz o merge; o próprio eco do meu save
//    é inofensivo: o merge vira no-op).
// 2) presence: quem está na tela + qual campo está focando (SEM conteúdo do rascunho).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PresencaColab = { userId: string; nome: string; campoFocado: string | null };

export function useColabRegistro(o: {
  canal: string | null;
  tabela: "ocs_tecido" | "modelos" | "colecoes";
  registroId: string | null;
  onMudancaServidor: () => void;
  campoFocado?: string | null;
}): { presentes: PresencaColab[] } {
  const { user } = useAuth();
  const [presentes, setPresentes] = useState<PresencaColab[]>([]);
  const onMudancaRef = useRef(o.onMudancaServidor);
  onMudancaRef.current = o.onMudancaServidor;

  // nome de exibição (public.users.nome; cai no e-mail se não achar)
  const { data: meuNome } = useQuery({
    queryKey: ["colab-meu-nome", user?.id],
    enabled: !!user,
    staleTime: Infinity,
    queryFn: async () =>
      (await supabase.from("users").select("nome").eq("id", user!.id).maybeSingle()).data?.nome
      ?? user!.email ?? "Alguém",
  });

  const chave = useMemo(() => (o.canal && o.registroId && user ? o.canal : null), [o.canal, o.registroId, user]);

  useEffect(() => {
    if (!chave || !meuNome) return;
    const ch = supabase.channel(chave, { config: { presence: { key: user!.id } } });
    ch.on("postgres_changes",
      { event: "UPDATE", schema: "public", table: o.tabela, filter: `id=eq.${o.registroId}` },
      () => onMudancaRef.current());
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ nome: string; campoFocado: string | null }>();
      setPresentes(
        Object.entries(state)
          .filter(([uid]) => uid !== user!.id)
          .map(([uid, metas]) => ({ userId: uid, nome: metas[0]?.nome ?? "Alguém", campoFocado: metas[0]?.campoFocado ?? null })),
      );
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") void ch.track({ nome: meuNome, campoFocado: o.campoFocado ?? null });
    });
    return () => { void supabase.removeChannel(ch); setPresentes([]); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, meuNome]);

  // atualiza o campo focado sem recriar o canal
  useEffect(() => {
    if (!chave || !meuNome) return;
    const ch = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
    if (ch) void ch.track({ nome: meuNome, campoFocado: o.campoFocado ?? null });
  }, [o.campoFocado, chave, meuNome]);

  return { presentes };
}

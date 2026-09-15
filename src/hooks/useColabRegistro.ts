// Canal colaborativo por registro-agregado (spec 2026-08-03):
// 1) postgres_changes (UPDATE na linha-RAIZ — os bumps de filha garantem o evento)
//    → onMudancaServidor() (a tela re-busca e faz o merge; o próprio eco do meu save
//    é inofensivo: o merge vira no-op).
// 2) presence: quem está na tela (nome/cor) — SEM conteúdo do rascunho.
// 3) broadcast "campoFocado": qual campo cada aba está focando. Vive FORA da presença de
//    propósito — o re-`track()` do @supabase/realtime-js 2.108 não propaga uma mudança de meta
//    para os OUTROS assinantes de forma confiável (o track até retorna "ok", mas o presence_diff
//    resultante é coalescido/descartado no receptor — comprovado com 2 abas: quem re-trackava via
//    a própria mudança, o par nunca recebia). Broadcast é o canal certo p/ sinal efêmero e de alta
//    frequência como foco de campo/cursor; presença fica só com o dado ESTÁVEL (nome), que propaga
//    bem no join. Late-joiner: ao ver um novo par no presence sync, cada aba re-emite seu foco atual.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PresencaColab = { userId: string; nome: string; campoFocado: string | null };

export type ColabTabela = "ocs_tecido" | "ocs_aviamento" | "ocs_etiqueta" | "modelos" | "colecoes" | "producao_terceirizados" | "controle_qualidade" | "direcionamento_controle";
export type ColabListener = { tabela: ColabTabela; filtroColuna: string; valor: string };

export function useColabRegistro(o: {
  canal: string | null;
  tabela: ColabTabela;
  registroId: string | null;
  onMudancaServidor: () => void;
  campoFocado?: string | null;
  // NOVO: coluna do filtro do postgres_changes (default "id"). PCP/CQ filtram por "cad_id"
  // (há N linhas por cad, sem id de raiz única).
  filtroColuna?: string;
  // NOVO: listeners extra no MESMO canal (ex.: CQ escuta controle_qualidade E o bloco-fonte
  // em producao_terceirizados). Sem presença própria — só reagem com onMudancaServidor.
  tabelasExtra?: ColabListener[];
}): { presentes: PresencaColab[] } {
  const { user } = useAuth();
  const [presentes, setPresentes] = useState<PresencaColab[]>([]);
  const onMudancaRef = useRef(o.onMudancaServidor);
  onMudancaRef.current = o.onMudancaServidor;

  // Chave de presença ÚNICA POR ABA (não por usuário): assim 2 abas do MESMO usuário se veem
  // (útil no uso real de 2 telas abertas e p/ testar sozinho). O filtro abaixo exclui só a PRÓPRIA
  // aba (`presenceKey`), não o usuário — então você vê as OUTRAS abas suas, mas não a si mesmo na
  // aba atual. Formato `userId::abaId` p/ derivar o userId de volta (a cor de presença é por user).
  const abaIdRef = useRef<string>("");
  if (!abaIdRef.current) {
    abaIdRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  const presenceKey = user ? `${user.id}::${abaIdRef.current}` : "";

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

  // Foco por aba, alimentado por broadcast (não por presença). Chave = presenceKey do par.
  // `focosRef` é a fonte da verdade; `nomesRef` guarda o {nome} da presença p/ compor `presentes`.
  const focosRef = useRef<Map<string, string | null>>(new Map());
  const nomesRef = useRef<Map<string, string>>(new Map());
  // último foco EMITIDO por esta aba (p/ re-emitir a um par que acabou de entrar).
  const meuFocoRef = useRef<string | null>(o.campoFocado ?? null);

  // recompõe `presentes` a partir das duas fontes (presença = quem está + nome; broadcast = foco).
  const rebuildRef = useRef<() => void>(() => {});
  rebuildRef.current = () => {
    setPresentes(
      [...nomesRef.current.entries()]
        .filter(([key]) => key !== presenceKey) // exclui só a PRÓPRIA aba, não o usuário inteiro.
        .map(([key, nome]) => ({
          userId: key.split("::")[0], // a cor de presença é por USUÁRIO, não por aba.
          nome,
          campoFocado: focosRef.current.get(key) ?? null,
        })),
    );
  };

  useEffect(() => {
    if (!chave || !meuNome) return;
    // Re-mount rápido do MESMO registro: o leave do canal anterior é assíncrono e
    // supabase.channel() reusa instância por topic — remove o remanescente antes de criar.
    const remanescente = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
    if (remanescente) void supabase.removeChannel(remanescente);
    focosRef.current = new Map();
    nomesRef.current = new Map();
    // Presença/broadcast NÃO passam por RLS (só o postgres_changes acima passa) — o canal em
    // si não é privado por tenant. Inofensivo hoje: o payload é só {nome} (presença) + {campoFocado}
    // (broadcast) e o UUID do registro (dentro de `chave`) é a capability — quem não o conhece não
    // assina. Se um dia precisar de presença tenant-privada de verdade, usar Realtime Authorization
    // (private channels), não confiar em RLS aqui.
    const ch = supabase.channel(chave, {
      config: { presence: { key: presenceKey }, broadcast: { self: false } },
    });
    const col = o.filtroColuna ?? "id";
    ch.on("postgres_changes",
      { event: "*", schema: "public", table: o.tabela, filter: `${col}=eq.${o.registroId}` },
      () => onMudancaRef.current());
    for (const ex of o.tabelasExtra ?? []) {
      ch.on("postgres_changes",
        { event: "*", schema: "public", table: ex.tabela, filter: `${ex.filtroColuna}=eq.${ex.valor}` },
        () => onMudancaRef.current());
    }
    // Foco de campo dos pares chega por broadcast (ver cabeçalho: presença não propaga meta editada).
    ch.on("broadcast", { event: "campoFocado" }, (msg) => {
      const p = msg.payload as { key?: string; campoFocado?: string | null; pedirEco?: boolean } | undefined;
      if (!p?.key || p.key === presenceKey) return;
      // `pedirEco`: um par que acabou de "acordar" (ficou visível) pede que os outros re-anunciem
      // seu foco — respondo com o meu (sem pedirEco, p/ não criar laço). Cobre a perda de broadcast
      // enquanto ESTA aba estava em background.
      if (p.pedirEco && meuFocoRef.current) {
        void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: meuFocoRef.current } });
      }
      // pedirEco sem payload de foco real não altera o mapa (é só um pedido).
      if (p.pedirEco && p.campoFocado == null) return;
      focosRef.current.set(p.key, p.campoFocado ?? null);
      rebuildRef.current();
    });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ nome: string }>();
      const keys = new Set(Object.keys(state));
      // reconstrói o mapa de nomes a partir do estado atual (quem saiu some).
      nomesRef.current = new Map(Object.entries(state).map(([k, metas]) => [k, metas[0]?.nome ?? "Alguém"]));
      // limpa focos de quem já não está presente.
      for (const k of [...focosRef.current.keys()]) if (!keys.has(k)) focosRef.current.delete(k);
      rebuildRef.current();
      // Late-joiner: um par que entrou AGORA não recebeu o broadcast do meu foco atual — re-emito.
      // (broadcast.self=false, então não volta pra mim.) Só quando há foco não-nulo a comunicar.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Invariante: `o.tabela`/`o.registroId`/`user.id` são capturados por closure — seguros
    // porque o chamador codifica o registroId dentro do `canal` (ex.: `colab:oc:${ocId}`).
    // Mudar registroId sem mudar canal quebra silenciosamente — NÃO fazer.
  }, [chave, meuNome, o.filtroColuna, JSON.stringify(o.tabelasExtra ?? [])]);

  // Emite o campo focado por BROADCAST sem recriar o canal (presença não propaga meta editada — ver
  // cabeçalho). No 1º render em que chave/meuNome ficam truthy, o SUBSCRIBED já emitiu; este effect
  // re-emite só quando `campoFocado` muda de fato. (Inline e direto — comprovado no QA.)
  useEffect(() => {
    meuFocoRef.current = o.campoFocado ?? null;
    if (!chave || !meuNome) return;
    const ch = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
    if (ch) void ch.send({ type: "broadcast", event: "campoFocado", payload: { key: presenceKey, campoFocado: o.campoFocado ?? null } });
  }, [o.campoFocado, chave, meuNome, presenceKey]);

  // Aba/janela que estava em BACKGROUND (você olhava o OUTRO dispositivo) tem WebSocket/timers
  // estrangulados e pode ter PERDIDO broadcasts. Ao voltar a ficar visível: (1) re-anuncio meu foco
  // (p/ quem não recebeu) e (2) PEÇO que os pares re-anunciem os deles (`pedirEco`) — perdi enquanto
  // estive em bg. Cobre o cenário real de 2 telas/2 dispositivos alternando o olhar.
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

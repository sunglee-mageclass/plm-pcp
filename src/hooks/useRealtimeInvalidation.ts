// Hook GLOBAL de atualização AO VIVO entre usuários (item 11 do dono, ago/2026).
// Monta UMA vez no layout _authenticated. Abre 1 canal Supabase Realtime por sessão e,
// a cada INSERT/UPDATE/DELETE numa tabela de config/cadastro (ver
// realtime-invalidation-map.ts), invalida as queryKeys mapeadas — assim o que um usuário
// salva (Config da Loja, Cadastro…) reflete NA HORA na tela de outro usuário do mesmo
// tenant, sem refresh.
//
// TENANT-SCOPED por RLS: postgres_changes respeita a policy de SELECT das tabelas-alvo
// (todas `tenant_id = get_user_tenant_id()`), então cada usuário só recebe eventos do
// próprio tenant (super_admin, cujo SELECT é irrestrito em tenant_config, recebe de todos —
// inofensivo: só dispara refetch da query já filtrada por tenant). Sem presença/broadcast
// (isso é do useColabRegistro, por-registro) — aqui é só invalidação.
//
// Custo: 1 canal, 1 assinatura por tabela, SEM polling. Debounce por tabela (250ms)
// coalesce rajadas (ex.: salvar a Config reordena/regrava vários campos num upsert só).

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  REALTIME_INVALIDATION_TABLES,
  matchesTable,
  type RealtimeTable,
} from "@/lib/realtime-invalidation-map";

const DEBOUNCE_MS = 250;

export function useRealtimeInvalidation(): void {
  const { user } = useAuth();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const timers = useRef<Map<RealtimeTable, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!user) return;
    // Chave por tenant (super_admin troca de loja → recria o canal p/ zerar o estado do
    // debounce). tenantId "" (sentinela sem loja) cai no user.id — canal ainda válido,
    // só sem eventos até resolver o tenant.
    const chave = `tenant-sync:${tenantId || user.id}`;

    // Re-mount rápido do MESMO topic: o leave do canal anterior é assíncrono e
    // supabase.channel() reusa instância por topic — remove o remanescente antes de criar
    // (mesmo cuidado do useColabRegistro).
    const remanescente = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
    if (remanescente) void supabase.removeChannel(remanescente);

    const timersMap = timers.current;
    const ch = supabase.channel(chave);
    for (const table of REALTIME_INVALIDATION_TABLES) {
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          const prev = timersMap.get(table);
          if (prev) clearTimeout(prev);
          timersMap.set(
            table,
            setTimeout(() => {
              timersMap.delete(table);
              qc.invalidateQueries({ predicate: (q) => matchesTable(table, q.queryKey) });
            }, DEBOUNCE_MS),
          );
        },
      );
    }
    ch.subscribe();

    return () => {
      for (const t of timersMap.values()) clearTimeout(t);
      timersMap.clear();
      void supabase.removeChannel(ch);
    };
    // qc é estável (mesma instância do QueryClientProvider); recria só ao trocar user/tenant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tenantId]);
}

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { STORAGE_PREFIX, migrarPrefixoStorage } from "@/lib/storage-prefix-migration";

/**
 * Rastreia, POR USUÁRIO e POR TELA, quantas vezes cada filtro foi aplicado.
 * Alimenta a coluna "Mais usados" do FilterButton (ordenação adaptativa).
 *
 * Armazenamento: localStorage (por-dispositivo; chaveado no id do usuário p/ não
 * misturar contas na mesma máquina). É só preferência de UI — não é lógica de
 * auth/tenant (essa nunca vai pra localStorage). Se um dia precisar sincronizar
 * entre dispositivos, troca-se o backend aqui sem tocar nas telas.
 */
const KEY = (uid: string, screen: string) => `${STORAGE_PREFIX}filtros:${uid}:${screen}`;

export function useFilterUsage(screen?: string) {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Carrega no cliente (evita mismatch de hidratação no SSR do Cloudflare).
  useEffect(() => {
    if (!screen || typeof window === "undefined") return;
    migrarPrefixoStorage(); // copia chaves sistrama:* → wish360:* (uma vez, não perde uso)
    try {
      const raw = window.localStorage.getItem(KEY(uid, screen));
      setCounts(raw ? JSON.parse(raw) : {});
    } catch {
      setCounts({});
    }
  }, [screen, uid]);

  const record = useCallback(
    (label: string) => {
      if (!screen || typeof window === "undefined") return;
      setCounts((prev) => {
        const next = { ...prev, [label]: (prev[label] ?? 0) + 1 };
        try {
          window.localStorage.setItem(KEY(uid, screen), JSON.stringify(next));
        } catch {
          /* quota/privado: ignora, o rastreio é best-effort */
        }
        return next;
      });
    },
    [screen, uid],
  );

  return { counts, record };
}

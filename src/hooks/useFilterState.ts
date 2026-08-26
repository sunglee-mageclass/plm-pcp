import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { STORAGE_PREFIX, migrarPrefixoStorage } from "@/lib/storage-prefix-migration";

/**
 * Persiste, POR USUÁRIO e POR TELA, a seleção (array de ids) de UM filtro multi.
 * Espelha `useFilterUsage.ts` (mesmo projeto, mesmo padrão de storage + uid +
 * try/catch + SSR-guard) — só que aqui é a SELEÇÃO, não a contagem de uso.
 *
 * Armazenamento: localStorage (por-dispositivo; chaveado no id do usuário p/ não
 * misturar contas na mesma máquina). É só preferência de UI — não é lógica de
 * auth/tenant (essa nunca vai pra localStorage).
 */
const KEY = (uid: string, screen: string, key: string) =>
  `${STORAGE_PREFIX}filtro-sel:${uid}:${screen}:${key}`;

/**
 * Parse + validação pura (testável sem localStorage/window — o env de teste é node).
 * Corrompido (JSON inválido OU valor não é array de strings) → cai no `initial`
 * sem throw. Array vazio É válido (= "todos"), não cai no fallback.
 */
export function parseFilterSel(raw: string | null, initial: string[]): string[] {
  if (raw === null) return initial;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed;
    }
    return initial;
  } catch {
    return initial;
  }
}

export function useFilterState(
  screen: string,
  key: string,
  initial: string[],
): [string[], (v: string[]) => void] {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const [value, setValue] = useState<string[]>(initial);

  // Hidrata no cliente (evita mismatch de hidratação no SSR do Cloudflare).
  useEffect(() => {
    if (typeof window === "undefined") return;
    migrarPrefixoStorage(); // copia chaves sistrama:* → wish360:* (uma vez, não perde filtro)
    try {
      const raw = window.localStorage.getItem(KEY(uid, screen, key));
      setValue(parseFilterSel(raw, initial));
    } catch {
      setValue(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, key, uid]);

  const setAndPersist = (v: string[]) => {
    setValue(v);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(KEY(uid, screen, key), JSON.stringify(v));
    } catch {
      /* quota/privado: ignora, a persistência é best-effort */
    }
  };

  return [value, setAndPersist];
}

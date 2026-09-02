import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STORAGE_PREFIX, migrarPrefixoStorage } from "@/lib/storage-prefix-migration";

/**
 * Preferências de UI POR USUÁRIO persistidas no BANCO (tabela `user_ui_prefs`) — seguem o login
 * em QUALQUER dispositivo. Substitui o localStorage-only do `useFilterState`. Arquitetura:
 *
 *   BANCO = fonte da verdade  ·  localStorage = ESPELHO/cache (não pisca + fallback offline)
 *
 * - Uma query só carrega TODAS as prefs do usuário no boot (`["user-ui-prefs", uid]`).
 * - Leitura síncrona inicial vem do CACHE localStorage (zero piscar); reconcilia com o banco
 *   quando a query resolve.
 * - Escrita: otimista no cache do React Query + grava no espelho localStorage NA HORA + faz
 *   UPSERT no banco com DEBOUNCE (toggle é frequente — não 1 request/clique).
 *
 * `scope` separa 'filtro' de 'agrupar' (e futuras prefs). `pref_key` = "{screen}:{key}".
 * `value` é sempre `string[]` (seleção do filtro; dimensões ativas do agrupamento).
 */

export type UiPrefScope = "filtro" | "agrupar";

const QK = (uid: string) => ["user-ui-prefs", uid] as const;

// Chave do ESPELHO localStorage. Mantém o mesmo esquema do antigo `useFilterState`
// (prefixo + uid + scope + pref_key), pra a leitura síncrona inicial não piscar e pra a
// migração das chaves legadas casar.
const mirrorKey = (uid: string, scope: UiPrefScope, prefKey: string) =>
  `${STORAGE_PREFIX}uipref:${scope}:${uid}:${prefKey}`;

// Chave legada do filtro (useFilterState): `wish360:filtro-sel:{uid}:{screen}:{key}`.
// `pref_key` novo = "{screen}:{key}", então a legada = PREFIX+"filtro-sel:"+uid+":"+prefKey.
const legacyFiltroKey = (uid: string, prefKey: string) =>
  `${STORAGE_PREFIX}filtro-sel:${uid}:${prefKey}`;

/** Parse + validação pura (idêntica à do filtro): corrompido/!array → `initial`, sem throw. */
export function parseStrArray(raw: string | null, initial: string[]): string[] {
  if (raw === null) return initial;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
    return initial;
  } catch {
    return initial;
  }
}

type PrefRow = { scope: string; pref_key: string; value: unknown };
type PrefMap = Record<string, string[]>; // chave = `${scope}:${pref_key}`

const mapKey = (scope: string, prefKey: string) => `${scope}:${prefKey}`;

function readMirror(uid: string, scope: UiPrefScope, prefKey: string, initial: string[]): string[] {
  if (typeof window === "undefined") return initial;
  try {
    return parseStrArray(window.localStorage.getItem(mirrorKey(uid, scope, prefKey)), initial);
  } catch {
    return initial;
  }
}

function writeMirror(uid: string, scope: UiPrefScope, prefKey: string, value: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(mirrorKey(uid, scope, prefKey), JSON.stringify(value));
  } catch {
    /* quota/privado: best-effort */
  }
}

/**
 * Carrega o mapa de prefs do usuário do banco (uma vez). Também dispara a MIGRAÇÃO das chaves
 * legadas de localStorage → banco (1×/usuário). Sempre chamado por `useUserPref`; a query é
 * compartilhada (mesma queryKey), então monta uma vez só por usuário.
 */
function useUiPrefsQuery() {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const qc = useQueryClient();
  const migratedRef = useRef(false);

  const query = useQuery({
    queryKey: QK(uid),
    enabled: !!user,
    staleTime: 10 * 60 * 1000, // pref muda pouco
    queryFn: async (): Promise<PrefMap> => {
      // `user_ui_prefs` não está no types.ts gerado (sem supabase login) — cast `as any`, padrão
      // do projeto para tabelas novas.
      const { data, error } = await (supabase as any)
        .from("user_ui_prefs")
        .select("scope, pref_key, value");
      if (error) throw error;
      const map: PrefMap = {};
      for (const r of (data ?? []) as PrefRow[]) {
        const v = r.value;
        if (Array.isArray(v) && v.every((s) => typeof s === "string")) {
          map[mapKey(r.scope, r.pref_key)] = v as string[];
        }
      }
      return map;
    },
  });

  // Migração localStorage → banco (uma vez por usuário logado). Semeia no banco o que já existe
  // no localStorage (chaves legadas do filtro `wish360:filtro-sel:*`), sem sobrescrever o que já
  // está no banco.
  useEffect(() => {
    if (!user || migratedRef.current || query.data === undefined) return;
    if (typeof window === "undefined") return;
    migrarPrefixoStorage(); // sistrama:* → wish360:* (idempotente)
    const banco = query.data;
    const aSemear: { scope: UiPrefScope; pref_key: string; value: string[] }[] = [];
    // Só semeia se o banco NÃO tem a chave (guard idempotente): preserva a pref já salva em outro
    // dispositivo (nunca sobrescreve o banco com o localStorage legado deste device).
    const push = (scope: UiPrefScope, prefKey: string, value: string[]) => {
      if (banco[mapKey(scope, prefKey)] !== undefined) return;
      aSemear.push({ scope, pref_key: prefKey, value });
    };
    try {
      const ls = window.localStorage;
      // (a) Filtros legados: `wish360:filtro-sel:{uid}:{screen}:{key}`.
      const legacyFiltroPrefix = `${STORAGE_PREFIX}filtro-sel:${uid}:`;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k || !k.startsWith(legacyFiltroPrefix)) continue;
        const prefKey = k.slice(legacyFiltroPrefix.length); // "{screen}:{key}"
        push("filtro", prefKey, parseStrArray(ls.getItem(k), []));
      }
      // (b) Agrupamentos legados (chaves GLOBAIS antigas, sem prefixo/uid) das 2 telas que já
      // persistiam. pref_key nova = "{screen}:dims" (mesmo esquema do useAgrupamentoState).
      // Desenvolvimento: "desenv-groupby" = "tecido" | "" → ["tecido"] | [].
      const desenv = ls.getItem("desenv-groupby");
      if (desenv !== null) push("agrupar", "desenvolvimento:dims", desenv.includes("tecido") ? ["tecido"] : []);
      // Produto Acabado: "produto-acabado-agrupar" = "grupo,categoria" (+ legados exclusivos).
      const pa = ls.getItem("produto-acabado-agrupar");
      if (pa !== null) {
        const dims =
          pa === "grupo-categoria" ? ["grupo", "categoria"]
          : pa === "grupo" ? ["grupo"]
          : pa === "categoria" ? ["categoria"]
          : pa.split(",").filter((s) => s === "grupo" || s === "categoria");
        push("agrupar", "produto-acabado:dims", dims);
      }
    } catch {
      /* best-effort */
    }
    if (aSemear.length === 0) {
      migratedRef.current = true; // nada a migrar; não revarrer nesta montagem
      return;
    }
    // C2: popular JÁ o mirror NOVO + o cache (sem esperar o banco). Sem isto, no 1º boot pós-deploy
    // a chave de mirror nova ainda não existe → o filtro legado piscaria em branco (e ficaria
    // inacessível offline). Assim o valor migrado está disponível de imediato e no próximo boot.
    for (const s of aSemear) writeMirror(uid, s.scope, s.pref_key, s.value);
    qc.setQueryData<PrefMap>(QK(uid), (prev) => {
      const next = { ...(prev ?? {}) };
      for (const s of aSemear) next[mapKey(s.scope, s.pref_key)] = s.value;
      return next;
    });
    // C1: só marca como migrado APÓS o upsert do banco confirmar. Se falhar (rede/RLS/loja
    // inativa), migratedRef fica false → uma nova montagem retenta (o guard idempotente
    // `banco[mapKey] !== undefined` acima evita re-semear o que já subiu). O mirror/cache acima
    // já garantem que o usuário não perde a preferência no boot atual.
    void (async () => {
      const rows = aSemear.map((s) => ({
        user_id: uid,
        scope: s.scope,
        pref_key: s.pref_key,
        value: s.value,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await (supabase as any)
        .from("user_ui_prefs")
        .upsert(rows, { onConflict: "user_id,scope,pref_key" });
      if (error) {
        console.warn("[useUiPrefs] migração de filtro legado → banco falhou (retenta no reload):", error);
        return;
      }
      migratedRef.current = true;
    })();
  }, [user, uid, query.data, qc]);

  return { uid, query, qc };
}

// Debounce de escrita no banco, POR (uid|scope|pref_key). Coalesce toggles rápidos.
const pendentes = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Hook central de uma pref. Mantém a MESMA forma de `useState`:
 *   const [value, setValue] = useUserPref("filtro", screen, key, initial)
 * O `useFilterState`/`useAgrupamentoState` são wrappers finos por cima deste.
 *
 * ⚠️ `initial` DEVE ser estático (literal como `[]` / `["tecido"]`). Ele é só o fallback quando
 * não há valor no banco NEM no mirror; o `useMemo` do `initialMirror` ignora `initial` nas deps
 * de propósito (call sites passam array literal = nova referência a cada render; incluí-lo daria
 * recomputo/loop). Não computar `initial` dinamicamente — o valor congelaria no 1º render.
 */
export function useUserPref(
  scope: UiPrefScope,
  screen: string,
  key: string,
  initial: string[],
): [string[], (v: string[]) => void] {
  const { uid, query, qc } = useUiPrefsQuery();
  const prefKey = `${screen}:${key}`;
  const mk = mapKey(scope, prefKey);

  // Valor síncrono inicial = espelho localStorage (não pisca). Reconcilia com o banco abaixo.
  const initialMirror = useMemo(
    () => readMirror(uid, scope, prefKey, initial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, scope, prefKey],
  );

  // Fonte da verdade quando o banco resolve; até lá, o espelho.
  const fromBanco = query.data?.[mk];
  const value = fromBanco ?? initialMirror;

  // Quando o banco traz um valor diferente do espelho, atualiza o espelho (mantém em dia p/ o
  // próximo boot). Não muta durante render.
  useEffect(() => {
    if (fromBanco !== undefined) writeMirror(uid, scope, prefKey, fromBanco);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, scope, prefKey, JSON.stringify(fromBanco)]);

  const setValue = (v: string[]) => {
    // 1) otimista no cache do React Query (re-render imediato, sem piscar)
    qc.setQueryData<PrefMap>(QK(uid), (prev) => ({ ...(prev ?? {}), [mk]: v }));
    // 2) espelho localStorage na hora (fonte do "não piscar" no próximo boot + fallback offline)
    writeMirror(uid, scope, prefKey, v);
    // 3) upsert no banco com debounce (coalesce toggles)
    if (uid === "anon") return; // sem usuário: só cache/local
    const dk = `${uid}|${mk}`;
    const anterior = pendentes.get(dk);
    if (anterior) clearTimeout(anterior);
    pendentes.set(
      dk,
      setTimeout(() => {
        pendentes.delete(dk);
        // O mirror local (acima) já é a fonte do "não piscar" e do fallback offline, então uma
        // falha de escrita aqui NÃO perde a preferência na sessão — mas logamos (I2) p/ não
        // depurar às cegas (rede/RLS/loja inativa). Last-write-wins entre abas é aceitável p/ UI.
        void (supabase as any)
          .from("user_ui_prefs")
          .upsert(
            { user_id: uid, scope, pref_key: prefKey, value: v, updated_at: new Date().toISOString() },
            { onConflict: "user_id,scope,pref_key" },
          )
          .then(({ error }: { error: unknown }) => {
            if (error) console.warn("[useUiPrefs] falha ao gravar pref no banco:", error);
          });
      }, 500),
    );
  };

  return [value, setValue];
}

// REPRO de investigação (26/set) — NÃO é teste do produto. Supabase FALSO, em memória, sem rede.
// Cada leitura devolve um objeto NOVO (como o JSON.parse do PostgREST) — a estrutura compartilhada do
// TanStack Query decide se a referência muda. Leituras podem ser SEGURADAS (gate) para simular a janela
// de rede entre "formulário já na tela" e "dado chegou".

type Filtro = { col: string; val: unknown };
export type Chamada = { tabela: string; op: string; filtros: Filtro[]; payload?: unknown; modo?: string };

type Gate = { promessa: Promise<void>; soltar: () => void };
function novoGate(): Gate {
  let soltar!: () => void;
  const promessa = new Promise<void>((r) => { soltar = r; });
  return { promessa, soltar };
}

export function criarFakeSupabase() {
  const linhas: Record<string, Record<string, any>[]> = {};
  const chamadas: Chamada[] = [];
  const gates: Record<string, Gate | null> = {};
  const canais: { nome: string; ouvintes: { tabela: string; cb: (p: unknown) => void }[] }[] = [];

  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  function resolverLeitura(c: Chamada): { data: any; error: null } {
    const rows = (linhas[c.tabela] ?? []).filter((r) => c.filtros.every((f) => r[f.col] === f.val));
    if (c.modo === "single" || c.modo === "maybeSingle") return { data: rows[0] ? clone(rows[0]) : null, error: null };
    return { data: clone(rows), error: null };
  }

  function executar(c: Chamada): Promise<{ data: any; error: null }> {
    chamadas.push(c);
    if (c.op === "select") {
      const g = gates[c.tabela];
      const run = () => resolverLeitura(c);
      return g ? g.promessa.then(run) : Promise.resolve().then(run);
    }
    if (c.op === "upsert" || c.op === "update") {
      const p = c.payload as Record<string, any>;
      const alvo = (linhas[c.tabela] ?? []).find((r) =>
        c.op === "upsert" ? r.tenant_id === p.tenant_id || r.id === p.id : c.filtros.every((f) => r[f.col] === f.val));
      if (alvo) Object.assign(alvo, clone(p));
      else (linhas[c.tabela] ??= []).push(clone(p));
      return Promise.resolve({ data: alvo ? [clone(alvo)] : [], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  function builder(tabela: string) {
    const c: Chamada = { tabela, op: "select", filtros: [] };
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => { c.filtros.push({ col, val }); return b; },
      maybeSingle: () => { c.modo = "maybeSingle"; return b; },
      single: () => { c.modo = "single"; return b; },
      upsert: (payload: unknown) => { c.op = "upsert"; c.payload = payload; return b; },
      update: (payload: unknown) => { c.op = "update"; c.payload = payload; return b; },
      insert: (payload: unknown) => { c.op = "insert"; c.payload = payload; return b; },
      delete: () => { c.op = "delete"; return b; },
      then: (ok: any, err: any) => executar(c).then(ok, err),
    };
    // filtros/ordenações que as telas usam mas que não importam para o repro
    for (const m of ["neq", "not", "in", "is", "order", "limit", "range", "gte", "lte", "gt", "lt", "ilike", "or", "match", "filter", "contains"])
      b[m] = () => b;
    return b;
  }

  const supabase: any = {
    from: (t: string) => builder(t),
    rpc: (nome: string, args?: unknown) => { chamadas.push({ tabela: `rpc:${nome}`, op: "rpc", filtros: [], payload: args }); return Promise.resolve({ data: null, error: null }); },
    channel: (nome: string) => {
      const canal = { nome, ouvintes: [] as { tabela: string; cb: (p: unknown) => void }[] };
      canais.push(canal);
      const ch: any = {
        topic: `realtime:${nome}`,
        on: (_tipo: string, filtro: { table: string }, cb: (p: unknown) => void) => { canal.ouvintes.push({ tabela: filtro.table, cb }); return ch; },
        subscribe: () => ch,
        track: () => Promise.resolve(),
        untrack: () => Promise.resolve(),
        send: () => Promise.resolve(),
        presenceState: () => ({}),
        unsubscribe: () => Promise.resolve(),
      };
      return ch;
    },
    removeChannel: () => Promise.resolve(),
    getChannels: () => [],
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
  };

  return {
    supabase,
    linhas,
    reset() {
      for (const k of Object.keys(linhas)) delete linhas[k];
      chamadas.length = 0;
      for (const k of Object.keys(gates)) delete gates[k];
      canais.length = 0;
    },
    chamadas,
    /** Segura TODAS as próximas leituras da tabela até `soltar()`. */
    segurar(tabela: string) { const g = novoGate(); gates[tabela] = g; return () => { gates[tabela] = null; g.soltar(); }; },
    /** Emite um evento `postgres_changes` (o que o Realtime faz quando OUTRA escrita chega na tabela). */
    emitirRealtime(tabela: string) {
      for (const canal of canais) for (const o of canal.ouvintes) if (o.tabela === tabela) o.cb({ table: tabela });
    },
  };
}

/** Instância ÚNICA compartilhada entre o `vi.mock` do client e o teste (mesmo módulo no cache do vitest). */
export const FAKE = criarFakeSupabase();
